import { randomUUID } from "node:crypto";
import type {
  BundleNested,
  Match,
  NewBundleNested,
  NewMessageNested,
  NewVariant,
  Pattern,
  Variant,
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

export type LlmTranslateBundleResult = {
  data?: NewBundleNested;
  error?: string;
  usage?: OpenRouterUsage;
};

const SYSTEM_PROMPT =
  `You are a UI localisation expert. ` +
  `Translate only the "value" field of nodes where "type" is "text". ` +
  `Return the full JSON array with all other nodes exactly as given — ` +
  `do not add, remove, reorder, or modify non-text nodes in any way.`;

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
    { sourceVariant: Variant; targetLocales: string[] }
  >();

  for (const sourceVariant of args.bundle.messages.find(
    (m) => m.locale === args.sourceLocale,
  )!.variants) {
    for (const targetLocale of args.targetLocales) {
      if (targetLocale === args.sourceLocale) continue;

      const targetMessage = copy.messages.find(
        (m: NewMessageNested) => m.locale === targetLocale,
      );
      if (targetMessage && !args.force) {
        const existing = findMatchingVariant(
          targetMessage.variants,
          sourceVariant.matches,
        );
        if (existing && !isEmptyPattern(existing.pattern ?? [])) continue;
      }

      if (!work.has(sourceVariant.id)) {
        work.set(sourceVariant.id, {
          sourceVariant,
          targetLocales: [],
        });
      }
      work.get(sourceVariant.id)!.targetLocales.push(targetLocale);
    }
  }

  // Nothing to translate — return unchanged copy immediately (no API call)
  if (work.size === 0) {
    return { data: copy };
  }

  const totalUsage: OpenRouterUsage = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
  };

  for (const { sourceVariant, targetLocales } of work.values()) {
    const contextLine = args.context ? `\nContext: ${args.context}` : "";
    const userContent = [
      `Translate from "${args.sourceLocale}" to: ${targetLocales.join(", ")}.`,
      contextLine,
      `Source pattern (JSON array):`,
      serializePattern(sourceVariant.pattern),
      ``,
      `Respond with ONLY a JSON object in this shape:`,
      `{ "locale": [ ...translated pattern array... ] }`,
      `One key per target locale.`,
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
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }

    totalUsage.promptTokens += response.usage.promptTokens;
    totalUsage.completionTokens += response.usage.completionTokens;
    totalUsage.cachedTokens += response.usage.cachedTokens;
    totalUsage.thinkingTokens += response.usage.thinkingTokens;
    totalUsage.totalTokens += response.usage.totalTokens;

    let translationsMap: Record<string, unknown>;
    try {
      translationsMap = JSON.parse(response.content) as Record<string, unknown>;
    } catch {
      console.warn(
        `[llm-translate] Bundle "${args.bundle.id}": failed to parse LLM response as JSON, skipping variant`,
      );
      continue;
    }

    if (
      typeof translationsMap !== "object" ||
      translationsMap === null ||
      Array.isArray(translationsMap)
    ) {
      console.warn(
        `[llm-translate] Bundle "${args.bundle.id}": LLM response was not a JSON object, skipping variant`,
      );
      continue;
    }

    for (const targetLocale of targetLocales) {
      const rawPattern = translationsMap[targetLocale];
      const validation = validateTranslatedPattern(
        sourceVariant.pattern,
        rawPattern,
      );

      if (!validation.valid) {
        console.warn(
          `[llm-translate] Bundle "${args.bundle.id}" → ${targetLocale}: ${validation.error}, skipping`,
        );
        continue;
      }

      const targetMessage = copy.messages.find(
        (m: NewMessageNested) => m.locale === targetLocale,
      );

      if (targetMessage) {
        const existingVariant = findMatchingVariant(
          targetMessage.variants,
          sourceVariant.matches,
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
  }

  return { data: copy, usage: totalUsage };
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
