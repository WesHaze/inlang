import { randomUUID } from "node:crypto";
import type {
  BundleNested,
  Match,
  NewBundleNested,
  NewMessageNested,
  NewVariant,
  Pattern,
} from "@inlang/sdk";
import { callOpenRouter, type OpenRouterUsage } from "./openrouterClient.js";
import { serializePattern, validateTranslatedPattern } from "./astSerializer.js";

export type LlmTranslateBundleArgs = {
  bundle: BundleNested;
  sourceLocale: string;
  targetLocales: string[];
  openrouterApiKey?: string;
  model: string;
  context?: string;
  force?: boolean;
};

export type LlmTranslateBundlesArgs = Omit<LlmTranslateBundleArgs, "bundle"> & {
  bundles: BundleNested[];
};

export type LlmTranslateBundlesResult = {
  results: LlmTranslateBundleResult[];
  usage: OpenRouterUsage;
};

export type LlmTranslateBundleResult = {
  data?: NewBundleNested;
  error?: string;
  usage?: OpenRouterUsage;
};

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

const SYSTEM_PROMPT =
  `You are a UI localisation expert. ` +
  `You receive a JSON pattern array. Translate only the "value" field of nodes where "type" is "text". ` +
  `Keep all other node types (expression, markup-start, markup-end, markup-standalone) ` +
  `exactly as given — do not add, remove, reorder, or modify them in any way. ` +
  `Always respond with a JSON object, never a bare array.`;

export async function llmTranslateBundle(
  args: LlmTranslateBundleArgs,
): Promise<LlmTranslateBundleResult> {
  const apiKey = args.openrouterApiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { error: "OPENROUTER_API_KEY is not set" };
  }

  const copy = structuredClone(args.bundle) as NewBundleNested;

  const sourceMessage = copy.messages.find(
    (m: NewMessageNested) => m.locale === args.sourceLocale,
  );
  if (!sourceMessage) {
    return {
      error: `Source locale "${args.sourceLocale}" not found in bundle "${args.bundle.id}"`,
    };
  }

  // Map: variantId → { sourceVariant, targetLocales[] }
  const work = new Map<
    string,
    { sourceVariant: NewVariant; targetLocales: string[] }
  >();

  for (const sourceVariant of sourceMessage.variants) {
    for (const targetLocale of args.targetLocales) {
      if (targetLocale === args.sourceLocale) continue;

      const targetMessage = copy.messages.find(
        (m: NewMessageNested) => m.locale === targetLocale,
      );
      if (targetMessage && !args.force) {
        const existing = findMatchingVariant(
          targetMessage.variants,
          sourceVariant.matches ?? [],
        );
        if (existing && !isEmptyPattern(existing.pattern ?? [])) continue;
      }

      const variantId = sourceVariant.id ?? randomUUID();
      if (!work.has(variantId)) {
        work.set(variantId, {
          sourceVariant,
          targetLocales: [],
        });
      }
      work.get(variantId)!.targetLocales.push(targetLocale);
    }
  }

  // Nothing to translate — return unchanged copy immediately (no API call)
  if (work.size === 0) {
    return { data: copy, usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, thinkingTokens: 0, totalTokens: 0 } };
  }

  const totalUsage: OpenRouterUsage = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
  };

  for (const { sourceVariant, targetLocales } of work.values()) {
    let remainingLocales = [...targetLocales];

    for (let attempt = 0; attempt < MAX_RETRIES && remainingLocales.length > 0; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      }

      const contextLine = args.context ? `\nContext: ${args.context}` : "";
      const localeFormat = remainingLocales.map((l) => `"${l}":[...pattern...]`).join(",");
      const userContent = [
        `Translate from "${args.sourceLocale}" to: ${remainingLocales.join(", ")}.`,
        contextLine,
        `Source pattern (JSON array):`,
        serializePattern(sourceVariant.pattern ?? []),
        ``,
        `Respond with ONLY minified JSON (no whitespace): {${localeFormat}}`,
        `Each value must be the full translated pattern array for that locale.`,
      ]
        .join("\n")
        .trim();

      let response;
      try {
        response = await callOpenRouter({
          model: args.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          apiKey,
          siteUrl: process.env.OPENROUTER_SITE_URL,
          siteName: process.env.OPENROUTER_SITE_NAME,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES - 1) {
          console.warn(
            `[llm-translate] Bundle "${args.bundle.id}": API error (attempt ${attempt + 1}/${MAX_RETRIES}): ${msg}, retrying...`,
          );
          continue;
        }
        return { error: msg };
      }

      totalUsage.promptTokens += response.usage.promptTokens;
      totalUsage.completionTokens += response.usage.completionTokens;
      totalUsage.cachedTokens += response.usage.cachedTokens;
      totalUsage.thinkingTokens += response.usage.thinkingTokens;
      totalUsage.totalTokens += response.usage.totalTokens;

      let translationsMap: Record<string, unknown>;
      try {
        const parsed = JSON.parse(response.content) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          console.warn(
            `[llm-translate] Bundle "${args.bundle.id}" (attempt ${attempt + 1}/${MAX_RETRIES}): LLM response was not a JSON object${attempt < MAX_RETRIES - 1 ? ", retrying..." : ", skipping variant"}`,
          );
          continue;
        }
        translationsMap = parsed as Record<string, unknown>;
      } catch {
        console.warn(
          `[llm-translate] Bundle "${args.bundle.id}" (attempt ${attempt + 1}/${MAX_RETRIES}): failed to parse LLM response as JSON${attempt < MAX_RETRIES - 1 ? ", retrying..." : ", skipping variant"}`,
        );
        continue;
      }

      const nextRemainingLocales: string[] = [];
      for (const targetLocale of remainingLocales) {
        const rawPattern = translationsMap[targetLocale];
        const validation = validateTranslatedPattern(
          sourceVariant.pattern ?? [],
          rawPattern,
        );

        if (!validation.valid) {
          console.warn(
            `[llm-translate] Bundle "${args.bundle.id}" → ${targetLocale} (attempt ${attempt + 1}/${MAX_RETRIES}): ${validation.error}${attempt < MAX_RETRIES - 1 ? ", retrying..." : ", skipping"}`,
          );
          nextRemainingLocales.push(targetLocale);
          continue;
        }

        const targetMessage = copy.messages.find(
          (m: NewMessageNested) => m.locale === targetLocale,
        );

        if (targetMessage) {
          const existingVariant = findMatchingVariant(
            targetMessage.variants,
            sourceVariant.matches ?? [],
          );
          if (existingVariant) {
            existingVariant.pattern = validation.pattern;
          } else {
            const newVariant: NewVariant = {
              id: randomUUID(),
              messageId: targetMessage.id ?? randomUUID(),
              matches: sourceVariant.matches,
              pattern: validation.pattern,
            };
            targetMessage.variants.push(newVariant);
          }
        } else {
          const newMessageId = randomUUID();
          const newVariant: NewVariant = {
            id: randomUUID(),
            messageId: newMessageId,
            matches: sourceVariant.matches,
            pattern: validation.pattern,
          };
          const newMessage: NewMessageNested = {
            ...sourceMessage,
            id: newMessageId,
            locale: targetLocale,
            variants: [newVariant],
          };
          copy.messages.push(newMessage);
        }
      }

      remainingLocales = nextRemainingLocales;
    }
  }

  return { data: copy, usage: totalUsage };
}

export async function llmTranslateBundles(
  args: LlmTranslateBundlesArgs,
): Promise<LlmTranslateBundlesResult> {
  const apiKey = args.openrouterApiKey ?? process.env.OPENROUTER_API_KEY;
  const emptyUsage = (): OpenRouterUsage => ({
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
  });

  if (!apiKey) {
    return {
      results: args.bundles.map(() => ({ error: "OPENROUTER_API_KEY is not set" })),
      usage: emptyUsage(),
    };
  }

  const copies = args.bundles.map((b) => structuredClone(b) as NewBundleNested);

  // Build work map: `${bundleId}::${variantId}` → work item
  type WorkItem = { copyIdx: number; sourceVariant: NewVariant; targetLocales: string[] };
  const workMap = new Map<string, WorkItem>();

  for (let i = 0; i < copies.length; i++) {
    const copy = copies[i]!;
    const sourceMessage = copy.messages.find((m) => m.locale === args.sourceLocale);
    if (!sourceMessage) continue;

    for (const sourceVariant of sourceMessage.variants) {
      const targetLocales: string[] = [];

      for (const targetLocale of args.targetLocales) {
        if (targetLocale === args.sourceLocale) continue;
        const targetMessage = copy.messages.find((m) => m.locale === targetLocale);
        if (targetMessage && !args.force) {
          const existing = findMatchingVariant(targetMessage.variants, sourceVariant.matches ?? []);
          if (existing && !isEmptyPattern(existing.pattern ?? [])) continue;
        }
        targetLocales.push(targetLocale);
      }

      if (targetLocales.length > 0) {
        const variantId = sourceVariant.id ?? randomUUID();
        workMap.set(`${copy.id}::${variantId}`, { copyIdx: i, sourceVariant, targetLocales });
      }
    }
  }

  if (workMap.size === 0) {
    return { results: copies.map((data) => ({ data })), usage: emptyUsage() };
  }

  const keyEntries: Record<string, { src: Pattern; targetLocales: string[] }> = {};
  for (const [key, { sourceVariant, targetLocales }] of workMap) {
    keyEntries[key] = {
      src: sourceVariant.pattern ?? [],
      targetLocales,
    };
  }

  const contextLine = args.context ? `\nContext: ${args.context}` : "";
  const userContent = [
    `Translate the following keys from "${args.sourceLocale}" to each key's specified target locales.`,
    contextLine,
    `Respond ONLY with minified JSON (no whitespace): {"key":{"locale":[...pattern...]}}`,
    `IMPORTANT: each locale value must be a bare JSON array (not wrapped in an object).`,
    `Keys:`,
    JSON.stringify(keyEntries),
  ]
    .join("\n")
    .trim();

  const accumulatedUsage = emptyUsage();
  let translationsMap: Record<string, Record<string, unknown>> | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));

    let response;
    try {
      response = await callOpenRouter({
        model: args.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        apiKey,
        siteUrl: process.env.OPENROUTER_SITE_URL,
        siteName: process.env.OPENROUTER_SITE_NAME,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[llm-translate] batch API error (attempt ${attempt + 1}/${MAX_RETRIES}): ${error}, retrying...`);
        continue;
      }
      return { results: args.bundles.map(() => ({ error })), usage: accumulatedUsage };
    }

    accumulatedUsage.promptTokens += response.usage.promptTokens;
    accumulatedUsage.completionTokens += response.usage.completionTokens;
    accumulatedUsage.cachedTokens += response.usage.cachedTokens;
    accumulatedUsage.thinkingTokens += response.usage.thinkingTokens;
    accumulatedUsage.totalTokens += response.usage.totalTokens;

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[llm-translate] batch: failed to parse LLM response as JSON (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
        continue;
      }
      return { results: args.bundles.map(() => ({ error: "Failed to parse LLM batch response as JSON after all retries" })), usage: accumulatedUsage };
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[llm-translate] batch: LLM response was not a JSON object (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
        continue;
      }
      return { results: args.bundles.map(() => ({ error: "LLM returned non-object batch response after all retries" })), usage: accumulatedUsage };
    }

    translationsMap = parsed as Record<string, Record<string, unknown>>;
    break;
  }

  if (!translationsMap) {
    return { results: args.bundles.map(() => ({ error: "Failed to get valid LLM batch response" })), usage: accumulatedUsage };
  }

  // Apply translations back to copies
  for (const [key, { copyIdx, sourceVariant, targetLocales }] of workMap) {
    const copy = copies[copyIdx]!;
    const sourceMessage = copy.messages.find((m) => m.locale === args.sourceLocale)!;
    const localeMap = translationsMap[key];
    if (!localeMap) continue;

    for (const targetLocale of targetLocales) {
      const validation = validateTranslatedPattern(sourceVariant.pattern ?? [], localeMap[targetLocale]);
      if (!validation.valid) {
        console.warn(`[llm-translate] Bundle "${copy.id}" → ${targetLocale}: ${validation.error}, skipping`);
        continue;
      }

      const targetMessage = copy.messages.find((m) => m.locale === targetLocale);
      if (targetMessage) {
        const existingVariant = findMatchingVariant(targetMessage.variants, sourceVariant.matches ?? []);
        if (existingVariant) {
          existingVariant.pattern = validation.pattern;
        } else {
          targetMessage.variants.push({
            id: randomUUID(),
            messageId: targetMessage.id ?? randomUUID(),
            matches: sourceVariant.matches,
            pattern: validation.pattern,
          });
        }
      } else {
        const newMessageId = randomUUID();
        copy.messages.push({
          ...sourceMessage,
          id: newMessageId,
          locale: targetLocale,
          variants: [{ id: randomUUID(), messageId: newMessageId, matches: sourceVariant.matches, pattern: validation.pattern }],
        });
      }
    }
  }

  return { results: copies.map((data) => ({ data })), usage: accumulatedUsage };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEmptyPattern(pattern: Pattern): boolean {
  return (
    pattern.length === 0 ||
    (pattern.length === 1 &&
      pattern[0]!.type === "text" &&
      (pattern[0] as { type: "text"; value: string }).value === "")
  );
}

function findMatchingVariant(
  variants: NewVariant[],
  matches: Match[],
): NewVariant | undefined {
  if (matches.length === 0) {
    return variants.find((v: NewVariant) => (v.matches ?? []).length === 0);
  }
  return variants.find((v: NewVariant) => {
    const vMatches = v.matches ?? [];
    if (vMatches.length !== matches.length) return false;
    return matches.every((sourceMatch: Match) =>
      vMatches.some((targetMatch: Match) => {
        if (
          targetMatch.key !== sourceMatch.key ||
          targetMatch.type !== sourceMatch.type
        )
          return false;
        if (
          sourceMatch.type === "literal-match" &&
          targetMatch.type === "literal-match"
        ) {
          return sourceMatch.value === targetMatch.value;
        }
        return true;
      }),
    );
  });
}
