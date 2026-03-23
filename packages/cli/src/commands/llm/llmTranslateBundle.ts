import { randomUUID } from "node:crypto";
import type {
  BundleNested,
  Match,
  NewBundleNested,
  NewMessageNested,
  NewVariant,
  Pattern,
} from "@inlang/sdk";
import {
  callOpenRouter,
  type OpenRouterUsage,
  OPENROUTER_API_KEY_ENV,
  OPENROUTER_SITE_URL_ENV,
  OPENROUTER_SITE_NAME_ENV,
} from "./openrouterClient.js";
import { serializePattern, validateTranslatedPattern } from "./astSerializer.js";

export type LlmTranslateBundleArgs = {
  bundle: BundleNested;
  sourceLocale: string;
  targetLocales: string[];
  openrouterApiKey?: string;
  model: string;
  context?: string;
  force?: boolean;
  quiet?: boolean;
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
  /** true only when at least one variant was actually written */
  translated?: boolean;
  error?: string;
  usage?: OpenRouterUsage;
};

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const LOG_PREFIX = "[llm-translate]";

function emptyUsage(): OpenRouterUsage {
  return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, thinkingTokens: 0, totalTokens: 0 };
}

const SYSTEM_PROMPT =
  `You are a UI localisation expert. ` +
  `You receive a JSON pattern array. Translate only the "value" field of nodes where "type" is "text". ` +
  `Keep all other node types (expression, markup-start, markup-end, markup-standalone) ` +
  `exactly as given — do not add, remove, reorder, or modify them in any way. ` +
  `Always respond with a JSON object, never a bare array.`;

export async function llmTranslateBundle(
  args: LlmTranslateBundleArgs,
): Promise<LlmTranslateBundleResult> {
  const apiKey = args.openrouterApiKey ?? process.env[OPENROUTER_API_KEY_ENV];
  if (!apiKey) {
    return { error: `${OPENROUTER_API_KEY_ENV} is not set` };
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
    return { data: copy, usage: emptyUsage() };
  }

  const totalUsage: OpenRouterUsage = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
  };
  let anyTranslated = false;

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
          siteUrl: process.env[OPENROUTER_SITE_URL_ENV],
          siteName: process.env[OPENROUTER_SITE_NAME_ENV],
        });
      } catch (err) {
        // callOpenRouter already retried internally — propagate immediately.
        return { error: err instanceof Error ? err.message : String(err) };
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
          if (!args.quiet) console.warn(
            `${LOG_PREFIX} Bundle "${args.bundle.id}" (attempt ${attempt + 1}/${MAX_RETRIES}): LLM response was not a JSON object${attempt < MAX_RETRIES - 1 ? ", retrying..." : ", skipping variant"}`,
          );
          continue;
        }
        translationsMap = parsed as Record<string, unknown>;
      } catch {
        if (!args.quiet) console.warn(
          `${LOG_PREFIX} Bundle "${args.bundle.id}" (attempt ${attempt + 1}/${MAX_RETRIES}): failed to parse LLM response as JSON${attempt < MAX_RETRIES - 1 ? ", retrying..." : ", skipping variant"}`,
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
          if (!args.quiet) console.warn(
            `${LOG_PREFIX} Bundle "${args.bundle.id}" → ${targetLocale} (attempt ${attempt + 1}/${MAX_RETRIES}): ${validation.error}${attempt < MAX_RETRIES - 1 ? ", retrying..." : ", skipping"}`,
          );
          nextRemainingLocales.push(targetLocale);
          continue;
        }

        anyTranslated = true;
        applyVariantTranslation(copy, sourceMessage, sourceVariant, targetLocale, validation.pattern);
      }

      remainingLocales = nextRemainingLocales;
    }
  }

  return { data: copy, translated: anyTranslated, usage: totalUsage };
}

export async function llmTranslateBundles(
  args: LlmTranslateBundlesArgs,
): Promise<LlmTranslateBundlesResult> {
  const apiKey = args.openrouterApiKey ?? process.env[OPENROUTER_API_KEY_ENV];

  if (!apiKey) {
    return {
      results: args.bundles.map(() => ({ error: `${OPENROUTER_API_KEY_ENV} is not set` })),
      usage: emptyUsage(),
    };
  }

  const copies = args.bundles.map((b) => structuredClone(b) as NewBundleNested);

  // Build work map: `${bundleId}::${variantId}` → work item
  type WorkItem = { copyIdx: number; sourceVariant: NewVariant; targetLocales: string[] };
  const workMap = new Map<string, WorkItem>();
  const bundleErrors = new Map<number, string>(); // copyIdx → error message

  for (let i = 0; i < copies.length; i++) {
    const copy = copies[i]!;
    const sourceMessage = copy.messages.find((m) => m.locale === args.sourceLocale);
    if (!sourceMessage) {
      bundleErrors.set(i, `Source locale "${args.sourceLocale}" not found in bundle "${copy.id}"`);
      continue;
    }

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
    return {
      results: copies.map((data, i) =>
        bundleErrors.has(i) ? { error: bundleErrors.get(i) } : { data },
      ),
      usage: emptyUsage(),
    };
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
        siteUrl: process.env[OPENROUTER_SITE_URL_ENV],
        siteName: process.env[OPENROUTER_SITE_NAME_ENV],
      });
    } catch (err) {
      // callOpenRouter already retried internally — propagate immediately.
      const error = err instanceof Error ? err.message : String(err);
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
        if (!args.quiet) console.warn(`${LOG_PREFIX} batch: failed to parse LLM response as JSON (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
        continue;
      }
      return { results: args.bundles.map(() => ({ error: "Failed to parse LLM batch response as JSON after all retries" })), usage: accumulatedUsage };
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      if (attempt < MAX_RETRIES - 1) {
        if (!args.quiet) console.warn(`${LOG_PREFIX} batch: LLM response was not a JSON object (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
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
  const translatedIndices = new Set<number>();
  for (const [key, { copyIdx, sourceVariant, targetLocales }] of workMap) {
    const copy = copies[copyIdx]!;
    const sourceMessage = copy.messages.find((m) => m.locale === args.sourceLocale)!;
    const localeMap = translationsMap[key];
    if (!localeMap) continue;

    for (const targetLocale of targetLocales) {
      // When there is only one target locale the LLM sometimes returns the pattern
      // array directly ({ key: [...] }) instead of the nested form ({ key: { locale: [...] } }).
      const rawPattern =
        Array.isArray(localeMap) && targetLocales.length === 1
          ? localeMap
          : (localeMap as Record<string, unknown>)[targetLocale];
      const validation = validateTranslatedPattern(sourceVariant.pattern ?? [], rawPattern);
      if (!validation.valid) {
        if (!args.quiet) console.warn(`${LOG_PREFIX} Bundle "${copy.id}" → ${targetLocale}: ${validation.error}, skipping`);
        continue;
      }

      translatedIndices.add(copyIdx);
      applyVariantTranslation(copy, sourceMessage, sourceVariant, targetLocale, validation.pattern);
    }
  }

  return {
    results: copies.map((data, i) =>
      bundleErrors.has(i)
        ? { error: bundleErrors.get(i) }
        : { data, translated: translatedIndices.has(i) },
    ),
    usage: accumulatedUsage,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes a validated translated pattern into `copy` for `targetLocale`.
 * Creates the message and variant if they don't exist yet.
 */
function applyVariantTranslation(
  copy: NewBundleNested,
  sourceMessage: NewMessageNested,
  sourceVariant: NewVariant,
  targetLocale: string,
  pattern: Pattern,
): void {
  const targetMessage = copy.messages.find((m) => m.locale === targetLocale);
  if (targetMessage) {
    const existingVariant = findMatchingVariant(targetMessage.variants, sourceVariant.matches ?? []);
    if (existingVariant) {
      existingVariant.pattern = pattern;
    } else {
      targetMessage.variants.push({
        id: randomUUID(),
        messageId: targetMessage.id ?? randomUUID(),
        matches: sourceVariant.matches,
        pattern,
      });
    }
  } else {
    const newMessageId = randomUUID();
    copy.messages.push({
      ...sourceMessage,
      id: newMessageId,
      locale: targetLocale,
      variants: [{ id: randomUUID(), messageId: newMessageId, matches: sourceVariant.matches, pattern }],
    });
  }
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
