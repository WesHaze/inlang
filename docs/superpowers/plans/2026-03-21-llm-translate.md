# LLM Translate Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `inlang llm translate` command using OpenRouter, plus a benchmark package to measure token usage across batch sizes and locale strategies.

**Architecture:** New `packages/cli/src/commands/llm/` directory mirrors the existing `machine/` command pattern exactly — a pure `llmTranslateBundle.ts` function (one bundle → one API call) and a thin `translate.ts` CLI wrapper. A private `packages/llm-translate-benchmark/` package holds 1000 fixture keys and the experiment runner.

**Tech Stack:** TypeScript, Commander.js, `@inlang/sdk` (BundleNested, selectBundleNested, upsertBundleNested, saveProjectToDirectory, insertBundleNested, loadProjectInMemory, newProject), native `fetch` (Node 18+), Vitest, consola, `node:crypto` (randomUUID).

**Spec:** `docs/superpowers/specs/2026-03-21-llm-translate-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/cli/src/commands/llm/astSerializer.ts` | Create | Serialize Pattern→JSON; validate translated Pattern against source |
| `packages/cli/src/commands/llm/astSerializer.test.ts` | Create | Unit tests for all 6 validation rules + edge cases |
| `packages/cli/src/commands/llm/openrouterClient.ts` | Create | fetch wrapper, retry, usage extraction |
| `packages/cli/src/commands/llm/llmTranslateBundle.ts` | Create | One bundle → one API call → NewBundleNested |
| `packages/cli/src/commands/llm/llmTranslateBundle.test.ts` | Create | Gated integration test (OPENROUTER_API_KEY) |
| `packages/cli/src/commands/llm/translate.ts` | Create | CLI flags, batch+concurrency orchestration, dry-run, upsert |
| `packages/cli/src/commands/llm/translate.test.ts` | Create | Gated integration test (OPENROUTER_API_KEY) |
| `packages/cli/src/commands/llm/index.ts` | Create | Register `inlang llm` command group |
| `packages/cli/src/main.ts` | Modify | Add `.addCommand(llm)` |
| `packages/llm-translate-benchmark/package.json` | Create | Private benchmark package |
| `packages/llm-translate-benchmark/tsconfig.json` | Create | TypeScript config |
| `packages/llm-translate-benchmark/fixtures/keys.ts` | Create | Generate 1000 NewBundleNested fixture keys |
| `packages/llm-translate-benchmark/benchmark.ts` | Create | Experiment runner, writes runs.json + runs.csv |
| `packages/llm-translate-benchmark/results/runs.json` | Create | Append-only experiment results (starts as `[]`) |

---

## Task 1: `astSerializer.ts` — Pattern serialization and validation

**Files:**
- Create: `packages/cli/src/commands/llm/astSerializer.ts`
- Create: `packages/cli/src/commands/llm/astSerializer.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `packages/cli/src/commands/llm/astSerializer.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  serializePattern,
  validateTranslatedPattern,
} from "./astSerializer.js";
import type { Pattern } from "@inlang/sdk";

// Simple source pattern with text and an expression
const sourceWithExpression: Pattern = [
  { type: "text", value: "Hello " },
  { type: "expression", arg: { type: "variable-reference", name: "name" } },
  { type: "text", value: "!" },
];

// Source with an empty text node between two expressions
const sourceWithEmptyText: Pattern = [
  { type: "expression", arg: { type: "variable-reference", name: "a" } },
  { type: "text", value: "" },
  { type: "expression", arg: { type: "variable-reference", name: "b" } },
];

// Source with markup nodes
const sourceWithMarkup: Pattern = [
  { type: "text", value: "Click " },
  { type: "markup-start", name: "b" },
  { type: "text", value: "here" },
  { type: "markup-end", name: "b" },
];

// Source with markup that has optional fields present
const sourceWithMarkupOptions: Pattern = [
  { type: "markup-standalone", name: "br", options: [], attributes: [] },
];

describe("serializePattern", () => {
  it("returns a JSON string of the pattern array", () => {
    const result = serializePattern([{ type: "text", value: "Hello" }]);
    expect(result).toBe('[{"type":"text","value":"Hello"}]');
  });
});

describe("validateTranslatedPattern", () => {
  it("returns invalid when translated is not an array", () => {
    const result = validateTranslatedPattern(sourceWithExpression, { type: "text", value: "Hi" });
    expect(result.valid).toBe(false);
  });

  it("returns invalid when array length differs", () => {
    const result = validateTranslatedPattern(sourceWithExpression, [
      { type: "text", value: "Hallo" },
    ]);
    expect(result.valid).toBe(false);
    expect((result as any).error).toMatch(/length/);
  });

  it("returns invalid when a non-text node is modified", () => {
    const translated = [
      { type: "text", value: "Hallo " },
      // Changed arg name
      { type: "expression", arg: { type: "variable-reference", name: "WRONG" } },
      { type: "text", value: "!" },
    ];
    const result = validateTranslatedPattern(sourceWithExpression, translated);
    expect(result.valid).toBe(false);
    expect((result as any).error).toMatch(/Non-text node/);
  });

  it("returns invalid when a text node changes its type", () => {
    const translated = [
      { type: "expression", arg: { type: "variable-reference", name: "x" } }, // was "text"
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
      { type: "text", value: "!" },
    ];
    const result = validateTranslatedPattern(sourceWithExpression, translated);
    expect(result.valid).toBe(false);
  });

  it("returns invalid when a non-empty source text node becomes empty", () => {
    const translated = [
      { type: "text", value: "" }, // was "Hello "
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
      { type: "text", value: "!" },
    ];
    const result = validateTranslatedPattern(sourceWithExpression, translated);
    expect(result.valid).toBe(false);
    expect((result as any).error).toMatch(/empty/);
  });

  it("EDGE: allows empty source text node to remain empty in translation", () => {
    const translated = [
      { type: "expression", arg: { type: "variable-reference", name: "a" } },
      { type: "text", value: "" }, // empty in source, allowed to stay empty
      { type: "expression", arg: { type: "variable-reference", name: "b" } },
    ];
    const result = validateTranslatedPattern(sourceWithEmptyText, translated);
    expect(result.valid).toBe(true);
  });

  it("accepts a correctly translated pattern with expression", () => {
    const translated = [
      { type: "text", value: "Hallo " },
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
      { type: "text", value: "!" },
    ];
    const result = validateTranslatedPattern(sourceWithExpression, translated);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.pattern).toEqual(translated);
    }
  });

  it("accepts markup nodes where optional fields differ (undefined vs [])", () => {
    // LLM returns options: [] but source has no options field — should still pass
    const translated = [
      { type: "text", value: "Klik " },
      { type: "markup-start", name: "b", options: [], attributes: [] },
      { type: "text", value: "hier" },
      { type: "markup-end", name: "b", options: [], attributes: [] },
    ];
    const result = validateTranslatedPattern(sourceWithMarkup, translated);
    expect(result.valid).toBe(true);
  });

  it("accepts markup-standalone with options normalised", () => {
    // Source has options: [], attributes: []; translated has undefined — normalised equal
    const translated = [{ type: "markup-standalone", name: "br" }];
    const result = validateTranslatedPattern(sourceWithMarkupOptions, translated);
    expect(result.valid).toBe(true);
  });

  it("EDGE: returns invalid when LLM returns null", () => {
    const result = validateTranslatedPattern(sourceWithExpression, null);
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run tests and confirm they all fail**

```bash
cd /c/Users/Wesse/Desktop/Projects/inlang
pnpm --filter @inlang/cli test -- astSerializer
```

Expected: FAIL — `astSerializer.ts` does not exist yet.

- [ ] **Step 1.3: Create `astSerializer.ts`**

Create `packages/cli/src/commands/llm/astSerializer.ts`:

```typescript
import type { Pattern } from "@inlang/sdk";

export type ValidateResult =
  | { valid: true; pattern: Pattern }
  | { valid: false; error: string };

/**
 * Serializes a Pattern to a JSON string for inclusion in an LLM prompt.
 */
export function serializePattern(pattern: Pattern): string {
  return JSON.stringify(pattern);
}

/**
 * Normalizes markup node optional fields so that `undefined` and `[]` are
 * treated as equivalent during deep-equality checks.
 */
function normalizeNode(node: unknown): unknown {
  if (typeof node !== "object" || node === null) return node;
  const n = node as Record<string, unknown>;
  const type = n["type"];
  if (
    type === "markup-start" ||
    type === "markup-end" ||
    type === "markup-standalone"
  ) {
    return {
      ...n,
      options: Array.isArray(n["options"]) ? n["options"] : [],
      attributes: Array.isArray(n["attributes"]) ? n["attributes"] : [],
    };
  }
  return n;
}

function nodesDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeNode(a)) === JSON.stringify(normalizeNode(b));
}

/**
 * Validates a translated pattern array returned by the LLM against the
 * original source pattern. Returns the validated Pattern on success.
 *
 * Validation rules:
 * 1. Must be an array
 * 2. Length must equal source length
 * 3. Non-text nodes must deep-equal source (markup optional fields normalised)
 * 4. Text node type must remain "text"
 * 5. Non-empty source text nodes must remain non-empty
 * 6. Empty source text nodes may remain empty
 */
export function validateTranslatedPattern(
  source: Pattern,
  translated: unknown,
): ValidateResult {
  // Rule 1: must be an array
  if (!Array.isArray(translated)) {
    return { valid: false, error: "Response is not a JSON array" };
  }

  // Rule 2: length must match
  if (translated.length !== source.length) {
    return {
      valid: false,
      error: `Array length mismatch: expected ${source.length}, got ${translated.length}`,
    };
  }

  for (let i = 0; i < source.length; i++) {
    const src = source[i]!;
    const tgt = translated[i] as Record<string, unknown>;

    if (src.type !== "text") {
      // Rule 3: non-text nodes must be deep-equal (normalised)
      if (!nodesDeepEqual(src, tgt)) {
        return {
          valid: false,
          error: `Non-text node at index ${i} was modified by the LLM`,
        };
      }
      continue;
    }

    // Rule 4: text node type must remain "text"
    if (tgt["type"] !== "text") {
      return {
        valid: false,
        error: `Node at index ${i} changed type from "text" to "${tgt["type"]}"`,
      };
    }

    // Rule 5 + 6: non-empty source text nodes must remain non-empty
    const srcValue = (src as { type: "text"; value: string }).value;
    const tgtValue = tgt["value"];
    if (srcValue !== "" && (typeof tgtValue !== "string" || tgtValue === "")) {
      return {
        valid: false,
        error: `Text node at index ${i} became empty after translation`,
      };
    }
  }

  return { valid: true, pattern: translated as Pattern };
}
```

- [ ] **Step 1.4: Run tests and confirm they pass**

```bash
pnpm --filter @inlang/cli test -- astSerializer
```

Expected: All tests PASS.

- [ ] **Step 1.5: Commit**

```bash
cd /c/Users/Wesse/Desktop/Projects/inlang
git add packages/cli/src/commands/llm/astSerializer.ts packages/cli/src/commands/llm/astSerializer.test.ts
git commit -m "feat(cli): add astSerializer for LLM translate AST validation"
```

---

## Task 2: `openrouterClient.ts` — OpenRouter HTTP wrapper

**Files:**
- Create: `packages/cli/src/commands/llm/openrouterClient.ts`

- [ ] **Step 2.1: Create `openrouterClient.ts`**

Create `packages/cli/src/commands/llm/openrouterClient.ts`:

```typescript
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;

export type OpenRouterMessage = {
  role: "system" | "user";
  content: string;
};

export type OpenRouterUsage = {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;    // prompt_tokens_details.cached_tokens ?? 0
  thinkingTokens: number;  // completion_tokens_details.reasoning_tokens ?? 0
  totalTokens: number;
};

export type OpenRouterResponse = {
  content: string;
  usage: OpenRouterUsage;
};

/**
 * Calls the OpenRouter chat completions endpoint with exponential backoff
 * retry on transient errors (HTTP 429, 5xx).
 *
 * Required env vars used by callers:
 *   OPENROUTER_SITE_URL  → HTTP-Referer header
 *   OPENROUTER_SITE_NAME → X-Title header
 */
export async function callOpenRouter(args: {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  apiKey: string;
  siteUrl?: string;
  siteName?: string;
}): Promise<OpenRouterResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.apiKey}`,
    "Content-Type": "application/json",
  };
  if (args.siteUrl) headers["HTTP-Referer"] = args.siteUrl;
  if (args.siteName) headers["X-Title"] = args.siteName;

  const body = JSON.stringify({
    model: args.model,
    messages: args.messages,
    temperature: args.temperature ?? 0.1,
  });

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, { method: "POST", headers, body });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200);
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const text = await response.text();
      lastError = new Error(`OpenRouter HTTP ${response.status}: ${text}`);
      const isTransient = response.status === 429 || response.status >= 500;
      if (isTransient && attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200);
        continue;
      }
      throw lastError;
    }

    const data = await response.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const u = data?.usage ?? {};

    const usage: OpenRouterUsage = {
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
      cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
      thinkingTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: u.total_tokens ?? 0,
    };

    return { content, usage };
  }

  throw lastError ?? new Error("OpenRouter request failed after all attempts");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 2.2: Confirm TypeScript compiles**

```bash
cd /c/Users/Wesse/Desktop/Projects/inlang
pnpm --filter @inlang/cli... build
```

Expected: Build succeeds (no TS errors). If the `llm/` directory causes import issues, that's fine — it will be resolved when `index.ts` is wired.

- [ ] **Step 2.3: Commit**

```bash
git add packages/cli/src/commands/llm/openrouterClient.ts
git commit -m "feat(cli): add OpenRouter HTTP client with retry"
```

---

## Task 3: `llmTranslateBundle.ts` — Core translation function

**Files:**
- Create: `packages/cli/src/commands/llm/llmTranslateBundle.ts`
- Create: `packages/cli/src/commands/llm/llmTranslateBundle.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Create `packages/cli/src/commands/llm/llmTranslateBundle.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  insertBundleNested,
  loadProjectInMemory,
  newProject,
  selectBundleNested,
} from "@inlang/sdk";
import { llmTranslateBundle } from "./llmTranslateBundle.js";

// These tests require a real OpenRouter API key.
// They will be skipped in CI unless OPENROUTER_API_KEY is set.
const runIf = process.env.OPENROUTER_API_KEY
  ? describe
  : describe.skip;

runIf("llmTranslateBundle (integration)", () => {
  it("translates a simple text bundle from en-gb to nl", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl"] },
      }),
    });

    await insertBundleNested(project.db, {
      id: "greeting",
      messages: [
        {
          id: "greeting_en",
          bundleId: "greeting",
          locale: "en-gb",
          variants: [
            {
              id: "greeting_en_v",
              messageId: "greeting_en",
              pattern: [{ type: "text", value: "Hello World" }],
            },
          ],
        },
      ],
    });

    const [bundle] = await selectBundleNested(project.db).execute();
    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: "openai/gpt-4o-mini",
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.usage).toBeDefined();
    expect(result.usage!.totalTokens).toBeGreaterThan(0);

    const nlMessage = result.data!.messages.find((m) => m.locale === "nl");
    expect(nlMessage).toBeDefined();
    expect(nlMessage!.variants).toHaveLength(1);
    // Pattern should have a translated text node
    const pattern = nlMessage!.variants[0]!.pattern;
    expect(pattern).toHaveLength(1);
    expect(pattern[0]!.type).toBe("text");
    expect((pattern[0] as any).value).not.toBe("");
  }, 20_000);

  it("EDGE: preserves expression nodes (variables) in translated pattern", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl"] },
      }),
    });

    await insertBundleNested(project.db, {
      id: "welcome",
      messages: [
        {
          id: "welcome_en",
          bundleId: "welcome",
          locale: "en-gb",
          variants: [
            {
              id: "welcome_en_v",
              messageId: "welcome_en",
              pattern: [
                { type: "text", value: "Hello " },
                {
                  type: "expression",
                  arg: { type: "variable-reference", name: "name" },
                },
                { type: "text", value: ", welcome back!" },
              ],
            },
          ],
        },
      ],
    });

    const [bundle] = await selectBundleNested(project.db).execute();
    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: "openai/gpt-4o-mini",
    });

    expect(result.error).toBeUndefined();
    const pattern = result.data!.messages.find((m) => m.locale === "nl")!
      .variants[0]!.pattern;

    // Expression node must be preserved exactly
    const expressionNode = pattern.find((n) => n.type === "expression");
    expect(expressionNode).toEqual({
      type: "expression",
      arg: { type: "variable-reference", name: "name" },
    });
  }, 20_000);

  it("skips already-translated variants unless force is true", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl"] },
      }),
    });

    await insertBundleNested(project.db, {
      id: "existing",
      messages: [
        {
          id: "existing_en",
          bundleId: "existing",
          locale: "en-gb",
          variants: [
            {
              id: "existing_en_v",
              messageId: "existing_en",
              pattern: [{ type: "text", value: "Save" }],
            },
          ],
        },
        {
          id: "existing_nl",
          bundleId: "existing",
          locale: "nl",
          variants: [
            {
              id: "existing_nl_v",
              messageId: "existing_nl",
              pattern: [{ type: "text", value: "Opslaan" }],
            },
          ],
        },
      ],
    });

    const [bundle] = await selectBundleNested(project.db).execute();
    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: "openai/gpt-4o-mini",
    });

    // Should return data (unchanged bundle) without calling OpenRouter
    expect(result.data).toBeDefined();
    // The nl variant should still be "Opslaan" (not re-translated)
    const nlPattern = result.data!.messages.find((m) => m.locale === "nl")!
      .variants[0]!.pattern;
    expect((nlPattern[0] as any).value).toBe("Opslaan");
  }, 5_000);

  it("returns error when no API key is provided", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl"] },
      }),
    });

    await insertBundleNested(project.db, {
      id: "test",
      messages: [
        {
          id: "test_en",
          bundleId: "test",
          locale: "en-gb",
          variants: [
            {
              id: "test_en_v",
              messageId: "test_en",
              pattern: [{ type: "text", value: "Test" }],
            },
          ],
        },
      ],
    });

    const [bundle] = await selectBundleNested(project.db).execute();
    // Explicitly pass undefined API key and ensure env var is not set
    const savedKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      openrouterApiKey: undefined,
      model: "openai/gpt-4o-mini",
    });

    process.env.OPENROUTER_API_KEY = savedKey;
    expect(result.error).toMatch(/OPENROUTER_API_KEY/);
  });
});
```

- [ ] **Step 3.2: Run tests to confirm they fail**

```bash
pnpm --filter @inlang/cli test -- llmTranslateBundle
```

Expected: FAIL — `llmTranslateBundle.ts` does not exist yet.

- [ ] **Step 3.3: Create `llmTranslateBundle.ts`**

Create `packages/cli/src/commands/llm/llmTranslateBundle.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type {
  BundleNested,
  NewBundleNested,
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
    (m) => m.locale === args.sourceLocale,
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

  for (const sourceVariant of sourceMessage.variants) {
    for (const targetLocale of args.targetLocales) {
      if (targetLocale === args.sourceLocale) continue;

      const targetMessage = copy.messages.find(
        (m) => m.locale === targetLocale,
      );
      if (targetMessage && !args.force) {
        const existing = findMatchingVariant(
          targetMessage.variants,
          sourceVariant.matches,
        );
        if (existing && !isEmptyPattern(existing.pattern)) continue;
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
      translationsMap = JSON.parse(response.content);
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
        (m) => m.locale === targetLocale,
      );

      if (targetMessage) {
        const existingVariant = findMatchingVariant(
          targetMessage.variants,
          sourceVariant.matches,
        );
        if (existingVariant) {
          existingVariant.pattern = validation.pattern;
        } else {
          targetMessage.variants.push({
            id: randomUUID(),
            messageId: targetMessage.id,
            matches: sourceVariant.matches,
            pattern: validation.pattern,
          } satisfies Variant);
        }
      } else {
        const newMessageId = randomUUID();
        copy.messages.push({
          ...sourceMessage,
          id: newMessageId,
          locale: targetLocale,
          variants: [
            {
              id: randomUUID(),
              messageId: newMessageId,
              matches: sourceVariant.matches,
              pattern: validation.pattern,
            },
          ],
        });
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
  variants: Variant[],
  matches: Variant["matches"],
): Variant | undefined {
  if (matches.length === 0) {
    return variants.find((v) => v.matches.length === 0);
  }
  return variants.find((v) => {
    if (v.matches.length !== matches.length) return false;
    return matches.every((sourceMatch) =>
      v.matches.some((targetMatch) => {
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
```

- [ ] **Step 3.4: Run tests (non-integration tests pass immediately; integration skipped without key)**

```bash
pnpm --filter @inlang/cli test -- llmTranslateBundle
```

Expected: The "returns error when no API key is provided" test PASSES (it deletes the env var). Integration tests are skipped unless `OPENROUTER_API_KEY` is set.

- [ ] **Step 3.5: Commit**

```bash
git add packages/cli/src/commands/llm/llmTranslateBundle.ts packages/cli/src/commands/llm/llmTranslateBundle.test.ts
git commit -m "feat(cli): add llmTranslateBundle core translation function"
```

---

## Task 4: `llm/index.ts` + `llm/translate.ts` — CLI command

**Files:**
- Create: `packages/cli/src/commands/llm/index.ts`
- Create: `packages/cli/src/commands/llm/translate.ts`
- Create: `packages/cli/src/commands/llm/translate.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `packages/cli/src/commands/llm/translate.test.ts`:

```typescript
import { test, expect } from "vitest";
import {
  insertBundleNested,
  loadProjectInMemory,
  newProject,
  selectBundleNested,
} from "@inlang/sdk";
import { llmTranslateCommandAction } from "./translate.js";

test.runIf(process.env.OPENROUTER_API_KEY)(
  "llmTranslateCommandAction translates missing locales end-to-end",
  async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl"] },
      }),
    });

    await insertBundleNested(project.db, {
      id: "hello",
      messages: [
        {
          id: "hello_en",
          bundleId: "hello",
          locale: "en-gb",
          variants: [
            {
              id: "hello_en_v",
              messageId: "hello_en",
              pattern: [{ type: "text", value: "Hello World" }],
            },
          ],
        },
      ],
    });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: "openai/gpt-4o-mini",
      concurrency: 1,
      batchSize: 10,
    });

    const bundles = await selectBundleNested(project.db).execute();
    const messages = bundles[0]?.messages;
    expect(messages?.length).toBe(2);
    expect(messages?.find((m) => m.locale === "nl")).toBeDefined();
  },
  { timeout: 20_000 },
);
```

- [ ] **Step 4.2: Run test to confirm it fails**

```bash
pnpm --filter @inlang/cli test -- translate
```

Expected: FAIL — `translate.ts` does not exist yet.

- [ ] **Step 4.3: Create `translate.ts`**

Create `packages/cli/src/commands/llm/translate.ts`:

```typescript
import { Command } from "commander";
import fs from "node:fs/promises";
import {
  saveProjectToDirectory,
  selectBundleNested,
  upsertBundleNested,
  type InlangProject,
} from "@inlang/sdk";
import { projectOption } from "../../utilities/globalFlags.js";
import { getInlangProject } from "../../utilities/getInlangProject.js";
import { log, logError } from "../../utilities/log.js";
import { llmTranslateBundle } from "./llmTranslateBundle.js";

export const translate = new Command()
  .command("translate")
  .requiredOption(projectOption.flags, projectOption.description)
  .option("--model <id>", "OpenRouter model ID.", "openai/gpt-4o-mini")
  .option("--locale <locale>", "Override source locale from project settings.")
  .option(
    "--targetLocales <locales...>",
    "Target locales for translation (comma-separated).",
  )
  .option("--context <text>", "Inline brand/style instructions for the LLM.")
  .option(
    "--context-file <path>",
    "Path to a markdown file with brand/style instructions (takes precedence over --context).",
  )
  .option(
    "--batch-size <n>",
    "Bundles per parallel batch.",
    (v) => parseInt(v, 10),
    20,
  )
  .option(
    "--concurrency <n>",
    "Number of parallel batches.",
    (v) => parseInt(v, 10),
    4,
  )
  .option("--force", "Overwrite existing translations.", false)
  .option("--dry-run", "Preview what would be translated without writing.", false)
  .option("-q, --quiet", "Suppress per-bundle logging.", false)
  .description("Translate bundles using an LLM via OpenRouter.")
  .action(async (args: { project: string }) => {
    let exitCode = 0;
    try {
      const project = await getInlangProject({ projectPath: args.project });
      const options = translate.opts();

      // Resolve context string
      let context: string | undefined;
      if (options.contextFile) {
        context = await fs.readFile(options.contextFile, "utf8");
      } else if (options.context) {
        context = options.context;
      }

      const settings = await project.settings.get();
      const sourceLocale: string = options.locale ?? settings.baseLocale;
      const targetLocales: string[] = options.targetLocales
        ? options.targetLocales[0]?.split(",")
        : settings.locales.filter((l: string) => l !== sourceLocale);

      await llmTranslateCommandAction({
        project,
        sourceLocale,
        targetLocales,
        model: options.model,
        context,
        concurrency: options.concurrency,
        batchSize: options.batchSize,
        force: options.force,
        dryRun: options.dryRun,
        quiet: options.quiet,
      });

      if (!options.dryRun) {
        await saveProjectToDirectory({ fs, path: args.project, project });
      }
    } catch (error) {
      logError(error);
      exitCode = 1;
    } finally {
      process.exit(exitCode);
    }
  });

export type LlmTranslateCommandActionArgs = {
  project: InlangProject;
  sourceLocale: string;
  targetLocales: string[];
  model: string;
  context?: string;
  concurrency?: number;
  batchSize?: number;
  force?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
};

export async function llmTranslateCommandAction(
  args: LlmTranslateCommandActionArgs,
): Promise<void> {
  const {
    project,
    sourceLocale,
    targetLocales,
    model,
    context,
    concurrency = 4,
    batchSize = 20,
    force = false,
    dryRun = false,
    quiet = false,
  } = args;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!dryRun && !apiKey) {
    throw new Error("OPENROUTER_API_KEY is required unless --dry-run is used.");
  }

  const bundles = await selectBundleNested(project.db).selectAll().execute();

  if (bundles.length === 0) {
    log.warn(
      "No bundles found. Check your project setup with `inlang validate`.",
    );
    return;
  }

  if (dryRun) {
    log.info(
      `Dry run: would translate ${bundles.length} bundle(s) from "${sourceLocale}" to [${targetLocales.join(", ")}] using model "${model}".`,
    );
    return;
  }

  // Chunk bundles into batches; batches run with limited concurrency
  const chunks: typeof bundles[] = [];
  for (let i = 0; i < bundles.length; i += batchSize) {
    chunks.push(bundles.slice(i, i + batchSize));
  }

  let totalTokens = 0;
  let successCount = 0;
  let errorCount = 0;

  await mapWithConcurrency(chunks, concurrency, async (chunk, chunkIdx) => {
    for (const bundle of chunk) {
      const result = await llmTranslateBundle({
        bundle,
        sourceLocale,
        targetLocales,
        model,
        context,
        force,
      });

      if (result.error) {
        errorCount++;
        log.warn(`  [${bundle.id}] error: ${result.error}`);
        continue;
      }

      if (result.data) {
        await upsertBundleNested(project.db, result.data);
        successCount++;

        if (!quiet && result.usage) {
          totalTokens += result.usage.totalTokens;
          log.info(
            `  [chunk ${chunkIdx + 1}/${chunks.length}] ${bundle.id} — ${result.usage.totalTokens} tokens`,
          );
        }
      }
    }
  });

  log.success(
    `LLM translate complete. ${successCount} bundle(s) translated, ${errorCount} error(s). Total tokens: ${totalTokens}.`,
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      results[current] = await mapper(items[current]!, current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker()),
  );
  return results;
}
```

- [ ] **Step 4.4: Create `index.ts`**

Create `packages/cli/src/commands/llm/index.ts`:

```typescript
import { Command } from "commander";
import { translate } from "./translate.js";

export const llm = new Command()
  .command("llm")
  .description("Commands for LLM-powered translations.")
  .argument("[command]")
  .addCommand(translate);
```

- [ ] **Step 4.5: Run tests**

```bash
pnpm --filter @inlang/cli test -- translate
```

Expected: Integration test skipped (no API key in CI). Non-integration parts compile.

- [ ] **Step 4.6: Commit**

```bash
git add packages/cli/src/commands/llm/translate.ts packages/cli/src/commands/llm/translate.test.ts packages/cli/src/commands/llm/index.ts
git commit -m "feat(cli): add llm translate CLI command with concurrency and dry-run"
```

---

## Task 5: Wire `llm` command into `main.ts`

**Files:**
- Modify: `packages/cli/src/main.ts`

- [ ] **Step 5.1: Edit `main.ts`**

In `packages/cli/src/main.ts`, add the import and the `.addCommand(llm)` call:

```typescript
// Add this import alongside the existing ones:
import { llm } from "./commands/llm/index.js";

// In the cli builder, add:
  .addCommand(llm)
// Place it after .addCommand(machine)
```

The file should look like:

```typescript
import { Command } from "commander";
import { machine } from "./commands/machine/index.js";
import { llm } from "./commands/llm/index.js";          // NEW
import { plugin } from "./commands/plugin/index.js";
import { version } from "../package.json";
import { initErrorMonitoring } from "./services/error-monitoring/implementation.js";
import { silenceKnownShutdownNoise } from "./services/error-monitoring/silenceKnownShutdownNoise.js";
import { validate } from "./commands/validate/index.js";
import { capture } from "./telemetry/capture.js";
import { lastUsedProject } from "./utilities/getInlangProject.js";
import { lint } from "./commands/lint/index.js";

initErrorMonitoring();
silenceKnownShutdownNoise();

export const cli = new Command()
  .name("inlang")
  .version(version)
  .description("CLI for inlang.")
  .addCommand(validate)
  .addCommand(machine)
  .addCommand(llm)                                       // NEW
  .addCommand(plugin)
  .addCommand(lint)
  .hook("postAction", async (command) => {
    const name = command.args.filter(
      (arg, i) => !arg.startsWith("-") && !command.args[i - 1]?.startsWith("-"),
    );
    await capture({
      event: `CLI command executed`,
      projectId: await lastUsedProject?.id.get(),
      properties: {
        name: name.join(" "),
        args: command.args.join(" "),
        node_version: process.versions.node,
        platform: process.platform,
        version,
      },
    });
  });
```

- [ ] **Step 5.2: Build and verify `--help` shows the new command**

```bash
pnpm --filter @inlang/cli... build
node packages/cli/dist/main.js --help
```

Expected output includes `llm` in the commands list.

```bash
node packages/cli/dist/main.js llm translate --help
```

Expected: shows all flags (--model, --locale, --targetLocales, --context, --context-file, --batch-size, --concurrency, --force, --dry-run, --quiet).

- [ ] **Step 5.3: Run full CLI test suite**

```bash
pnpm --filter @inlang/cli test
```

Expected: all tests pass (integration tests skip without API key).

- [ ] **Step 5.4: Commit**

```bash
git add packages/cli/src/main.ts
git commit -m "feat(cli): register inlang llm command group in main"
```

---

## Task 6: Benchmark package setup

**Files:**
- Create: `packages/llm-translate-benchmark/package.json`
- Create: `packages/llm-translate-benchmark/tsconfig.json`
- Create: `packages/llm-translate-benchmark/results/runs.json`

- [ ] **Step 6.1: Create `package.json`**

Create `packages/llm-translate-benchmark/package.json`:

```json
{
  "name": "@inlang/llm-translate-benchmark",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "benchmark": "npx tsx benchmark.ts"
  },
  "dependencies": {
    "@inlang/sdk": "workspace:*"
  },
  "devDependencies": {
    "@inlang/tsconfig": "workspace:*",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0"
  }
}
```

- [ ] **Step 6.2: Create `tsconfig.json`**

Create `packages/llm-translate-benchmark/tsconfig.json`:

```json
{
  "extends": "@inlang/tsconfig",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "."
  },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 6.3: Create `results/runs.json`**

Create `packages/llm-translate-benchmark/results/runs.json`:

```json
[]
```

- [ ] **Step 6.4: Install workspace dependencies**

```bash
cd /c/Users/Wesse/Desktop/Projects/inlang
pnpm install
```

Expected: `@inlang/llm-translate-benchmark` is picked up by the workspace (it lives in `packages/`).

- [ ] **Step 6.5: Commit**

```bash
git add packages/llm-translate-benchmark/
git commit -m "feat: add llm-translate-benchmark package skeleton"
```

---

## Task 7: `fixtures/keys.ts` — 1000 fixture keys

**Files:**
- Create: `packages/llm-translate-benchmark/fixtures/keys.ts`

- [ ] **Step 7.1: Create `fixtures/keys.ts`**

Create `packages/llm-translate-benchmark/fixtures/keys.ts`:

```typescript
import type { NewBundleNested } from "@inlang/sdk";

/**
 * Generates 1000 NewBundleNested fixture keys in en-gb covering realistic
 * i18n patterns. Edge cases are marked with an EDGE comment.
 */
export function generateFixtureKeys(): NewBundleNested[] {
  const keys: NewBundleNested[] = [];
  let seq = 0;

  function id(prefix: string): string {
    seq++;
    return `${prefix}_${String(seq).padStart(4, "0")}`;
  }

  function bundle(
    bundleId: string,
    pattern: NewBundleNested["messages"][0]["variants"][0]["pattern"],
  ): NewBundleNested {
    const msgId = `${bundleId}_msg`;
    const varId = `${bundleId}_var`;
    return {
      id: bundleId,
      messages: [
        {
          id: msgId,
          bundleId,
          locale: "en-gb",
          variants: [
            {
              id: varId,
              messageId: msgId,
              pattern,
            },
          ],
        },
      ],
    };
  }

  // ── Simple text (300) ────────────────────────────────────────────────────
  const simpleTexts = [
    "Save changes",
    "Cancel",
    "Delete",
    "Confirm",
    "Submit",
    "Back",
    "Next",
    "Previous",
    "Close",
    "Open",
    "Search",
    "Filter",
    "Sort",
    "Export",
    "Import",
    "Download",
    "Upload",
    "Copy",
    "Paste",
    "Undo",
    "Redo",
    "Select all",
    "Deselect",
    "Refresh",
    "Reload",
    "Reset",
    "Clear",
    "Apply",
    "OK",
    "Yes",
    "No",
    "Maybe",
    "Continue",
    "Finish",
    "Done",
    "Loading",
    "Please wait",
    "Processing",
    "Error",
    "Warning",
    "Info",
    "Success",
    "Failure",
    "Not found",
    "Forbidden",
    "Unauthorised",
    "Timeout",
    "Retry",
    "Ignore",
  ];
  for (let i = 0; i < 300; i++) {
    const text = simpleTexts[i % simpleTexts.length]! + (i >= simpleTexts.length ? ` (${Math.floor(i / simpleTexts.length)})` : "");
    keys.push(bundle(id("simple"), [{ type: "text", value: text }]));
  }

  // ── Single variable (250) ────────────────────────────────────────────────
  const singleVarTemplates: Array<[string, string, string]> = [
    ["Hello, ", "name", "!"],
    ["Welcome back, ", "username", "."],
    ["Signed in as ", "email", "."],
    ["Last updated by ", "user", "."],
    ["Assigned to ", "assignee", "."],
    ["Owned by ", "owner", "."],
    ["Created by ", "author", "."],
    ["Sorted by ", "field", "."],
    ["Filtered by ", "category", "."],
    ["Searching for ", "query", "..."],
  ];
  for (let i = 0; i < 250; i++) {
    const [before, varName, after] =
      singleVarTemplates[i % singleVarTemplates.length]!;
    keys.push(
      bundle(id("single_var"), [
        { type: "text", value: before },
        { type: "expression", arg: { type: "variable-reference", name: varName } },
        { type: "text", value: after },
      ]),
    );
  }

  // ── Multi-variable (150) ─────────────────────────────────────────────────
  const multiVarTemplates: Array<Array<{ t?: string; v?: string }>> = [
    [{ t: "" }, { v: "firstName" }, { t: " " }, { v: "lastName" }, { t: " is logged in." }],
    [{ t: "From " }, { v: "start" }, { t: " to " }, { v: "end" }, { t: "." }],
    [{ t: "Showing " }, { v: "from" }, { t: "–" }, { v: "to" }, { t: " of " }, { v: "total" }, { t: " results." }],
    [{ t: "File " }, { v: "filename" }, { t: " uploaded to " }, { v: "folder" }, { t: "." }],
    [{ t: "Move " }, { v: "item" }, { t: " from " }, { v: "source" }, { t: " to " }, { v: "destination" }, { t: "." }],
  ];
  for (let i = 0; i < 150; i++) {
    const template = multiVarTemplates[i % multiVarTemplates.length]!;
    const pattern = template.map((seg) =>
      seg.v
        ? { type: "expression" as const, arg: { type: "variable-reference" as const, name: seg.v } }
        : { type: "text" as const, value: seg.t! },
    );
    keys.push(bundle(id("multi_var"), pattern));
  }

  // ── Count variable / plural-adjacent (100) ───────────────────────────────
  const countTemplates: Array<[string, string]> = [
    ["You have ", " unread messages."],
    ["", " items selected."],
    ["Showing ", " results."],
    ["", " errors found."],
    ["Download ", " files."],
  ];
  for (let i = 0; i < 100; i++) {
    const [before, after] = countTemplates[i % countTemplates.length]!;
    keys.push(
      bundle(id("count"), [
        ...(before ? [{ type: "text" as const, value: before }] : []),
        { type: "expression", arg: { type: "variable-reference", name: "count" } },
        { type: "text", value: after },
      ]),
    );
  }

  // ── Markup nodes (80) ────────────────────────────────────────────────────
  const markupTemplates = [
    () => [
      { type: "text" as const, value: "Click " },
      { type: "markup-start" as const, name: "b" },
      { type: "text" as const, value: "here" },
      { type: "markup-end" as const, name: "b" },
      { type: "text" as const, value: " to continue." },
    ],
    () => [
      { type: "markup-start" as const, name: "em" },
      { type: "text" as const, value: "Important:" },
      { type: "markup-end" as const, name: "em" },
      { type: "text" as const, value: " please read carefully." },
    ],
    () => [
      { type: "text" as const, value: "Visit " },
      { type: "markup-start" as const, name: "a" },
      { type: "text" as const, value: "our website" },
      { type: "markup-end" as const, name: "a" },
      { type: "text" as const, value: " for more info." },
    ],
    () => [
      { type: "text" as const, value: "Press " },
      { type: "markup-standalone" as const, name: "kbd", options: [] },
      { type: "text" as const, value: " to search." },
    ],
  ];
  for (let i = 0; i < 80; i++) {
    keys.push(bundle(id("markup"), markupTemplates[i % markupTemplates.length]!()));
  }

  // ── Long strings > 100 chars with variables (70) ─────────────────────────
  const longTemplates: Array<Array<{ t?: string; v?: string }>> = [
    [
      { t: "Your booking for " },
      { v: "nights" },
      { t: " nights at " },
      { v: "property" },
      { t: " has been confirmed. A confirmation email has been sent to " },
      { v: "email" },
      { t: "." },
    ],
    [
      { t: "The export of " },
      { v: "count" },
      { t: " records has been scheduled. You will receive a notification at " },
      { v: "email" },
      { t: " when it is ready to download." },
    ],
    [
      { t: "An error occurred while processing your request for " },
      { v: "resource" },
      { t: ". Please try again or contact support at " },
      { v: "supportEmail" },
      { t: " if the issue persists." },
    ],
  ];
  for (let i = 0; i < 70; i++) {
    const template = longTemplates[i % longTemplates.length]!;
    const pattern = template.map((seg) =>
      seg.v
        ? { type: "expression" as const, arg: { type: "variable-reference" as const, name: seg.v } }
        : { type: "text" as const, value: seg.t! },
    );
    keys.push(bundle(id("long"), pattern));
  }

  // ── Edge cases (50) ──────────────────────────────────────────────────────

  // EDGE: Variable at string start
  for (let i = 0; i < 8; i++) {
    keys.push(
      bundle(id("edge_var_start"), [
        { type: "expression", arg: { type: "variable-reference", name: "name" } },
        { type: "text", value: " has joined the session." },
      ]),
    );
  }

  // EDGE: Variable at string end
  for (let i = 0; i < 8; i++) {
    keys.push(
      bundle(id("edge_var_end"), [
        { type: "text", value: "Welcome back, " },
        { type: "expression", arg: { type: "variable-reference", name: "name" } },
      ]),
    );
  }

  // EDGE: Adjacent variables with no text between
  for (let i = 0; i < 8; i++) {
    keys.push(
      bundle(id("edge_adjacent_vars"), [
        { type: "expression", arg: { type: "variable-reference", name: "firstName" } },
        { type: "text", value: " " }, // single space — minimal text between
        { type: "expression", arg: { type: "variable-reference", name: "lastName" } },
      ]),
    );
  }

  // EDGE: Variable-only pattern (no text nodes)
  for (let i = 0; i < 8; i++) {
    keys.push(
      bundle(id("edge_var_only"), [
        { type: "expression", arg: { type: "variable-reference", name: "count" } },
      ]),
    );
  }

  // EDGE: Empty text node between two expressions
  for (let i = 0; i < 9; i++) {
    keys.push(
      bundle(id("edge_empty_text"), [
        { type: "expression", arg: { type: "variable-reference", name: "a" } },
        { type: "text", value: "" }, // intentionally empty
        { type: "expression", arg: { type: "variable-reference", name: "b" } },
      ]),
    );
  }

  // EDGE: Markup wrapping a variable
  for (let i = 0; i < 9; i++) {
    keys.push(
      bundle(id("edge_markup_var"), [
        { type: "markup-start", name: "b" },
        { type: "expression", arg: { type: "variable-reference", name: "count" } },
        { type: "markup-end", name: "b" },
        { type: "text", value: " items selected." },
      ]),
    );
  }

  return keys;
}
```

- [ ] **Step 7.2: Verify key count**

```bash
cd /c/Users/Wesse/Desktop/Projects/inlang
node --input-type=module <<'EOF'
import { generateFixtureKeys } from "./packages/llm-translate-benchmark/fixtures/keys.ts";
const keys = generateFixtureKeys();
console.log("Total keys:", keys.length);
EOF
```

If `tsx` is not installed yet, run `pnpm install` first. Use tsx:

```bash
cd packages/llm-translate-benchmark
npx tsx -e "import { generateFixtureKeys } from './fixtures/keys.ts'; const k = generateFixtureKeys(); console.log('Total keys:', k.length);"
```

Expected output: `Total keys: 1000`

- [ ] **Step 7.3: Commit**

```bash
cd /c/Users/Wesse/Desktop/Projects/inlang
git add packages/llm-translate-benchmark/fixtures/keys.ts
git commit -m "feat(benchmark): add 1000 fixture keys covering all i18n patterns and edge cases"
```

---

## Task 8: `benchmark.ts` — Experiment runner

**Files:**
- Create: `packages/llm-translate-benchmark/benchmark.ts`

- [ ] **Step 8.1: Create `benchmark.ts`**

Create `packages/llm-translate-benchmark/benchmark.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * LLM Translate Benchmark
 *
 * Tests different batch sizes and locale strategies and records
 * token usage to results/runs.json and results/runs.csv.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-... npx tsx benchmark.ts [--model openai/gpt-4o-mini] [--batch-sizes 5,10,20] [--dry-run]
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  insertBundleNested,
  loadProjectInMemory,
  newProject,
  selectBundleNested,
} from "@inlang/sdk";
import { generateFixtureKeys } from "./fixtures/keys.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "results");
const RUNS_JSON = path.join(RESULTS_DIR, "runs.json");
const RUNS_CSV = path.join(RESULTS_DIR, "runs.csv");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const modelArg = args.find((_, i) => args[i - 1] === "--model") ?? "openai/gpt-4o-mini";
const batchSizesArg = args.find((_, i) => args[i - 1] === "--batch-sizes") ?? "5,10,20,50,100";
const dryRun = args.includes("--dry-run");

const BATCH_SIZES = batchSizesArg.split(",").map(Number);
const STRATEGIES: Array<"multi-locale" | "per-locale"> = ["multi-locale", "per-locale"];
const SOURCE_LOCALE = "en-gb";
const TARGET_LOCALES = ["nl"];
const MODEL = modelArg;

const apiKey = process.env.OPENROUTER_API_KEY;
if (!dryRun && !apiKey) {
  console.error("OPENROUTER_API_KEY is required unless --dry-run is used.");
  process.exit(1);
}

// ── Types ─────────────────────────────────────────────────────────────────

type BenchmarkRecord = {
  runId: string;
  timestamp: string;
  model: string;
  strategy: "multi-locale" | "per-locale";
  batchSize: number;
  keyCount: number;
  locales: string[];
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  successCount: number;
  rejectedCount: number;
  durationMs: number;
};

// ── OpenRouter call ───────────────────────────────────────────────────────

async function callOpenRouter(
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<{
  content: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  totalTokens: number;
}> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.1 }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter HTTP ${response.status}: ${text}`);
  }

  const data = await response.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  const u = data?.usage ?? {};

  return {
    content,
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    thinkingTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}

// ── Serialization helpers ─────────────────────────────────────────────────

function serializePattern(pattern: unknown): string {
  return JSON.stringify(pattern);
}

function validatePattern(source: unknown[], translated: unknown): boolean {
  if (!Array.isArray(translated)) return false;
  if (translated.length !== source.length) return false;
  for (let i = 0; i < source.length; i++) {
    const src = source[i] as Record<string, unknown>;
    const tgt = translated[i] as Record<string, unknown>;
    if (src["type"] !== "text") {
      if (JSON.stringify(src) !== JSON.stringify(tgt)) return false;
    }
  }
  return true;
}

// ── Experiment runner ─────────────────────────────────────────────────────

async function runExperiment(
  runId: string,
  keys: Awaited<ReturnType<typeof selectBundleNested>>["execute"] extends (...args: any) => Promise<infer T> ? T : never,
  batchSize: number,
  strategy: "multi-locale" | "per-locale",
): Promise<BenchmarkRecord[]> {
  const records: BenchmarkRecord[] = [];

  // Chunk keys into batches
  const chunks: typeof keys[] = [];
  for (let i = 0; i < keys.length; i += batchSize) {
    chunks.push(keys.slice(i, i + batchSize) as typeof keys);
  }

  const localesToTest =
    strategy === "multi-locale" ? [TARGET_LOCALES] : TARGET_LOCALES.map((l) => [l]);

  for (const chunk of chunks) {
    for (const locales of localesToTest) {
      // Build the multi-key prompt for this chunk
      const keyEntries: Record<string, { sourceLocale: string; pattern: unknown; targetLocales: string[] }> = {};

      for (const bundle of chunk) {
        const srcMessage = bundle.messages.find((m) => m.locale === SOURCE_LOCALE);
        if (!srcMessage) continue;
        const srcVariant = srcMessage.variants[0];
        if (!srcVariant) continue;
        keyEntries[bundle.id] = {
          sourceLocale: SOURCE_LOCALE,
          pattern: srcVariant.pattern,
          targetLocales: locales,
        };
      }

      const systemPrompt =
        `You are a UI localisation expert. ` +
        `For each key, translate only the "value" field of nodes where "type" is "text". ` +
        `Return the full pattern array with all non-text nodes exactly as given.`;

      const userContent = [
        `Translate the following keys. For each key, translate from "${SOURCE_LOCALE}" to: ${locales.join(", ")}.`,
        ``,
        `Respond ONLY with a JSON object: { "bundleId": { "locale": [...pattern array...] } }`,
        ``,
        `Keys:`,
        JSON.stringify(keyEntries, null, 2),
      ].join("\n");

      if (dryRun) {
        console.log(
          `[DRY RUN] strategy=${strategy} batchSize=${batchSize} chunk=${chunk.length} locales=${locales.join(",")}`,
        );
        console.log(`  Prompt length: ${userContent.length} chars`);
        continue;
      }

      const start = Date.now();
      let result;
      try {
        result = await callOpenRouter([
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ]);
      } catch (err) {
        console.error(`  [ERROR] ${err}`);
        continue;
      }
      const durationMs = Date.now() - start;

      // Validate response
      let successCount = 0;
      let rejectedCount = 0;

      let translations: Record<string, Record<string, unknown[]>> = {};
      try {
        translations = JSON.parse(result.content);
      } catch {
        console.warn("  [WARN] Failed to parse LLM response as JSON");
        rejectedCount = chunk.length * locales.length;
      }

      for (const bundle of chunk) {
        const srcMessage = bundle.messages.find((m) => m.locale === SOURCE_LOCALE);
        if (!srcMessage) continue;
        const srcVariant = srcMessage.variants[0];
        if (!srcVariant) continue;

        for (const locale of locales) {
          const translated = translations?.[bundle.id]?.[locale];
          if (validatePattern(srcVariant.pattern as unknown[], translated)) {
            successCount++;
          } else {
            rejectedCount++;
            console.warn(
              `  [WARN] Validation failed: ${bundle.id} → ${locale}`,
            );
          }
        }
      }

      const record: BenchmarkRecord = {
        runId,
        timestamp: new Date().toISOString(),
        model: MODEL,
        strategy,
        batchSize,
        keyCount: chunk.length,
        locales,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        cachedTokens: result.cachedTokens,
        thinkingTokens: result.thinkingTokens,
        totalTokens: result.totalTokens,
        successCount,
        rejectedCount,
        durationMs,
      };

      records.push(record);
      console.log(
        `  [${strategy}] batchSize=${batchSize} keys=${chunk.length} locales=${locales.join(",")} tokens=${result.totalTokens} success=${successCount} rejected=${rejectedCount} ms=${durationMs}`,
      );
    }
  }

  return records;
}

// ── Results I/O ───────────────────────────────────────────────────────────

function loadExistingRuns(): BenchmarkRecord[] {
  try {
    return JSON.parse(fs.readFileSync(RUNS_JSON, "utf8"));
  } catch {
    return [];
  }
}

function saveRuns(records: BenchmarkRecord[]): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(RUNS_JSON, JSON.stringify(records, null, 2), "utf8");
}

function saveCsv(records: BenchmarkRecord[]): void {
  if (records.length === 0) return;
  const header = Object.keys(records[0]!).join(",");
  const rows = records.map((r) =>
    Object.values(r)
      .map((v) => (Array.isArray(v) ? `"${v.join(";")}"` : String(v)))
      .join(","),
  );
  fs.writeFileSync(RUNS_CSV, [header, ...rows].join("\n"), "utf8");
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\nLLM Translate Benchmark`);
  console.log(`Model       : ${MODEL}`);
  console.log(`Batch sizes : ${BATCH_SIZES.join(", ")}`);
  console.log(`Strategies  : ${STRATEGIES.join(", ")}`);
  console.log(`Dry run     : ${dryRun}`);
  console.log(`\nLoading fixture keys...`);

  const project = await loadProjectInMemory({
    blob: await newProject({
      settings: { baseLocale: SOURCE_LOCALE, locales: [SOURCE_LOCALE, ...TARGET_LOCALES] },
    }),
  });

  const fixtureKeys = generateFixtureKeys();
  console.log(`Inserting ${fixtureKeys.length} fixture keys...`);

  for (const key of fixtureKeys) {
    await insertBundleNested(project.db, key);
  }

  const allBundles = await selectBundleNested(project.db).execute();
  console.log(`Loaded ${allBundles.length} bundles.\n`);

  const runId = randomUUID();
  const existingRuns = loadExistingRuns();
  const newRecords: BenchmarkRecord[] = [];

  for (const batchSize of BATCH_SIZES) {
    for (const strategy of STRATEGIES) {
      console.log(`\n── batchSize=${batchSize} strategy=${strategy} ──`);
      const records = await runExperiment(runId, allBundles, batchSize, strategy);
      newRecords.push(...records);
    }
  }

  if (!dryRun && newRecords.length > 0) {
    const allRuns = [...existingRuns, ...newRecords];
    saveRuns(allRuns);
    saveCsv(allRuns);
    console.log(`\nResults written to results/runs.json and results/runs.csv`);
    console.log(`Total new records: ${newRecords.length}`);

    // Summary by batchSize + strategy
    console.log("\n── Summary ──");
    console.log(
      `${"Strategy".padEnd(15)} ${"BatchSize".padEnd(10)} ${"AvgTokens".padEnd(12)} ${"AvgSuccess".padEnd(12)} ${"AvgRejected"}`,
    );
    const grouped = new Map<string, BenchmarkRecord[]>();
    for (const r of newRecords) {
      const key = `${r.strategy}::${r.batchSize}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    }
    for (const [key, recs] of grouped) {
      const [strategy, batchSize] = key.split("::");
      const avgTokens = Math.round(recs.reduce((s, r) => s + r.totalTokens, 0) / recs.length);
      const avgSuccess = (recs.reduce((s, r) => s + r.successCount, 0) / recs.length).toFixed(1);
      const avgRejected = (recs.reduce((s, r) => s + r.rejectedCount, 0) / recs.length).toFixed(1);
      console.log(
        `${strategy!.padEnd(15)} ${batchSize!.padEnd(10)} ${String(avgTokens).padEnd(12)} ${avgSuccess.padEnd(12)} ${avgRejected}`,
      );
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 8.2: Run benchmark in dry-run mode to verify it works**

```bash
cd /c/Users/Wesse/Desktop/Projects/inlang/packages/llm-translate-benchmark
pnpm install
OPENROUTER_API_KEY=dummy npx tsx benchmark.ts --dry-run --batch-sizes 5,10
```

Expected: prints dry-run output for each batch+strategy combination, no API calls made, no errors.

- [ ] **Step 8.3: (Optional, with real API key) Run benchmark against a small subset**

If you have an `OPENROUTER_API_KEY`:

```bash
cd packages/llm-translate-benchmark
OPENROUTER_API_KEY=sk-... npx tsx benchmark.ts --batch-sizes 5,10 --model openai/gpt-4o-mini
```

Expected: results appended to `results/runs.json` and `results/runs.csv`, summary table printed to stdout.

- [ ] **Step 8.4: Commit**

```bash
cd /c/Users/Wesse/Desktop/Projects/inlang
git add packages/llm-translate-benchmark/benchmark.ts packages/llm-translate-benchmark/results/
git commit -m "feat(benchmark): add experiment runner with token recording and CSV export"
```

---

## Task 9: Changeset and final checks

**Files:**
- Create: `.changeset/<generated-name>.md` (via `npx changeset`)

- [ ] **Step 9.1: Write a changeset entry**

```bash
cd /c/Users/Wesse/Desktop/Projects/inlang
npx changeset
```

When prompted:
- Select `@inlang/cli` as the changed package
- Select `minor` (new feature, no breaking changes)
- Summary: `Add \`inlang llm translate\` command for LLM-powered translations via OpenRouter`

- [ ] **Step 9.2: Run the full CLI test suite one final time**

```bash
pnpm --filter @inlang/cli test
```

Expected: all tests pass.

- [ ] **Step 9.3: TypeScript check**

```bash
pnpm --filter @inlang/cli... build
```

Expected: no TS errors.

- [ ] **Step 9.4: Verify `inlang llm translate --help` output**

```bash
node packages/cli/dist/main.js llm translate --help
```

Expected output:
```
Usage: inlang llm translate [options]

Translate bundles using an LLM via OpenRouter.

Options:
  --project <path>          Path to the inlang project.
  --model <id>              OpenRouter model ID. (default: "openai/gpt-4o-mini")
  --locale <locale>         Override source locale from project settings.
  --targetLocales <locales...>  Target locales for translation (comma-separated).
  --context <text>          Inline brand/style instructions for the LLM.
  --context-file <path>     Path to a markdown file with brand/style instructions...
  --batch-size <n>          Bundles per parallel batch. (default: 20)
  --concurrency <n>         Number of parallel batches. (default: 4)
  --force                   Overwrite existing translations. (default: false)
  --dry-run                 Preview what would be translated without writing. (default: false)
  -q, --quiet               Suppress per-bundle logging. (default: false)
  -h, --help                display help for command
```

- [ ] **Step 9.5: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for inlang llm translate command"
```

---

## Quick Reference

| Command | Purpose |
|---|---|
| `pnpm --filter @inlang/cli test -- astSerializer` | Unit tests for AST serialization |
| `pnpm --filter @inlang/cli test -- llmTranslateBundle` | Integration test (needs OPENROUTER_API_KEY) |
| `pnpm --filter @inlang/cli test` | Full CLI test suite |
| `pnpm --filter @inlang/cli... build` | Build CLI + dependencies |
| `node packages/cli/dist/main.js llm translate --help` | Verify command is wired |
| `OPENROUTER_API_KEY=sk-... npx tsx benchmark.ts --dry-run` | Benchmark dry run |
| `OPENROUTER_API_KEY=sk-... npx tsx benchmark.ts --batch-sizes 5,10,20,50,100` | Full benchmark run |
