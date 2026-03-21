# Design: `inlang llm translate` command

**Date:** 2026-03-21
**Author:** WesHaze + Claude
**Issue:** https://github.com/opral/inlang/issues/4304
**Status:** Approved, ready for implementation

---

## Background

The existing `inlang machine translate` command uses Google Translate. The community wants an LLM-based alternative via OpenRouter so users can choose their model. Key challenge: LLMs must preserve non-text AST nodes (expressions, markup) exactly while translating only text nodes.

WesHaze built a working standalone script (`translate-missing-paraglide.mjs`) that uses a custom `{placeholder}` serialization. This contribution converts it to use the inlang AST directly, adds a benchmark harness to measure LLM token usage across batch sizes and locale strategies, and lands the result as a proper CLI command.

---

## Architecture

**Option chosen: Follow the existing `machine` command pattern exactly.**

Mirror `packages/cli/src/commands/machine/` — a pure `llmTranslateBundle.ts` function and a thin `translate.ts` CLI wrapper. A separate `packages/llm-translate-benchmark/` package holds the 1000-key test project and experiment runner.

---

## File Structure

```
packages/
  cli/
    src/
      main.ts                       # ADD: .addCommand(llm) alongside machine/plugin/lint
      commands/
        llm/
          index.ts                  # registers `inlang llm` command group
          translate.ts              # CLI flags, batch orchestration, dry-run guard, upsert
          llmTranslateBundle.ts     # pure fn: one BundleNested → NewBundleNested (+ usage)
          openrouterClient.ts       # fetch wrapper, retry, returns raw usage from API
          astSerializer.ts          # Pattern → JSON string; validate translated Pattern
  llm-translate-benchmark/
    package.json                    # "private": true, not published
    project.inlang/
      settings.json                 # baseLocale: en-gb, locales: [en-gb, nl]
    fixtures/
      keys.ts                       # generates 1000 keys programmatically
    benchmark.ts                    # calls OpenRouter directly, writes results
    results/
      runs.json                     # append-only array of BenchmarkRecord
      runs.csv                      # derived from runs.json after each run
```

**`main.ts` change:** add `.addCommand(llm)` alongside the existing `machine`, `plugin`, `lint`, and `validate` commands.

**Benchmark package:** `"private": true` in `package.json`. Add to `pnpm-workspace.yaml` so it resolves `@inlang/sdk` from the workspace.

---

## AST Serialization (`astSerializer.ts`)

### Principle

The full JSON array of pattern nodes is sent to the LLM. Only `type: "text"` nodes have translatable content. All other node types (`expression`, `markup-start`, `markup-end`, `markup-standalone`) must be returned unchanged.

### Serialization: Pattern → LLM input

Each variant's pattern array is sent as-is (JSON-serialized). Example:

```json
[
  {"type":"text","value":"Hello "},
  {"type":"expression","arg":{"type":"variable-reference","name":"name"}},
  {"type":"text","value":", you have "},
  {"type":"expression","arg":{"type":"variable-reference","name":"count"}},
  {"type":"text","value":" items."}
]
```

System instruction: "Translate only the `value` field of nodes where `type` is `"text"`. Return the full array with all other nodes exactly as given. Do not add, remove, or reorder nodes."

### Deserialization validation

After receiving the LLM response, validate each translated pattern:

1. **JSON parse**: Wrap in `try/catch`. On failure, warn and skip the bundle — do not write partial data.
2. **Is an array**: If the parsed value is not an array, warn and skip.
3. **Length**: Array length must equal the source pattern length. On mismatch, warn and skip.
4. **Non-text nodes**: For each element where `source[i].type !== "text"`, the translated element must deep-equal the source element. Use a normalising deep-equal that treats `undefined` and `[]` as equivalent for optional array fields (`options`, `attributes`) on markup nodes. On mismatch, warn and skip.
5. **Text node types**: For each element where `source[i].type === "text"`, the translated element's `type` must also be `"text"`. On mismatch, warn and skip.
6. **Non-empty text**: For each text node where the source `value` was non-empty, the translated `value` must also be non-empty. Source text nodes with an empty `value` (e.g., between two adjacent expressions) may remain empty in the translation.

Validation failures produce a `console.warn` and skip that variant. The bundle is not written with bad data.

---

## Core Function: `llmTranslateBundle`

**Scope:** one `BundleNested` → one `NewBundleNested`. Handles one bundle across all target locales. Batching multiple bundles per API call is the responsibility of `translate.ts`.

```ts
type LlmTranslateBundleArgs = {
  bundle: BundleNested;
  sourceLocale: string;
  targetLocales: string[];
  openrouterApiKey?: string;   // optional — falls back to process.env.OPENROUTER_API_KEY
  model: string;
  context?: string;            // resolved brand/style string, merged by caller
  force?: boolean;             // if true, overwrite existing non-empty variants
}

type LlmTranslateUsage = {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;        // prompt_tokens_details.cached_tokens ?? 0
  thinkingTokens: number;      // completion_tokens_details.reasoning_tokens ?? 0
  totalTokens: number;
}

type LlmTranslateBundleResult = {
  data?: NewBundleNested;
  error?: string;
  usage?: LlmTranslateUsage;
}
```

The function:
- Resolves `openrouterApiKey` from args or `process.env.OPENROUTER_API_KEY`; returns `{ error }` if neither is set
- Finds the source message for `sourceLocale`; returns `{ error }` if not found
- Iterates source variants; skips target locales with a non-empty matching variant unless `force === true`
- Sends the pattern to OpenRouter via `openrouterClient`, receives translated pattern
- Validates with `astSerializer` — skips invalid variants with a warning, does not error the whole bundle
- Returns `{ data: NewBundleNested, usage }` on success, or `{ error }` on unrecoverable failure

`cachedTokens` and `thinkingTokens` default to `0` when the model's response does not include the relevant `usage` sub-fields.

---

## OpenRouter Client (`openrouterClient.ts`)

```ts
type OpenRouterRequest = {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature?: number;
}

type OpenRouterResponse = {
  content: string;             // choices[0].message.content
  usage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    thinkingTokens: number;
    totalTokens: number;
  };
}

async function callOpenRouter(
  args: OpenRouterRequest & {
    apiKey: string;
    siteUrl?: string;           // HTTP-Referer header ← OPENROUTER_SITE_URL
    siteName?: string;          // X-Title header      ← OPENROUTER_SITE_NAME
  }
): Promise<OpenRouterResponse>
```

Retry policy: up to 5 attempts, exponential backoff starting at 500ms with ±200ms jitter. Retries on HTTP 429 and 5xx. Throws on non-retryable errors or exhausted attempts.

Required headers: `Authorization: Bearer <apiKey>`, `Content-Type: application/json`, optional `HTTP-Referer` and `X-Title`.

---

## CLI Command: `inlang llm translate`

Registered under a new `inlang llm` command group via `packages/cli/src/commands/llm/index.ts`, added to `main.ts`.

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--project` | string | — | **Required.** Path to `.inlang` project |
| `--model` | string | `openai/gpt-4o-mini` | OpenRouter model ID |
| `--locale` | string | from `settings.baseLocale` | Override source locale |
| `--targetLocales` | `string[]` | from `settings.locales` | Target locales (matches existing `machine translate` casing) |
| `--context` | string | — | Inline brand/style instructions |
| `--context-file` | path | — | Markdown file with brand/style instructions |
| `--batch-size` | number | `20` | Bundles per OpenRouter request |
| `--concurrency` | number | `4` | Parallel requests |
| `--force` | boolean | false | Overwrite existing translations |
| `--dry-run` | boolean | false | Preview without writing |
| `--quiet` | boolean | false | Suppress per-bundle logging |

**Note:** `--targetLocales` uses the same camelCase-as-hyphenated style as the existing `machine translate --targetLocales` flag for consistency.

### Environment variables

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | Required unless `--dry-run` |
| `OPENROUTER_SITE_URL` | Optional → `HTTP-Referer` header |
| `OPENROUTER_SITE_NAME` | Optional → `X-Title` header |

### Context resolution (in `translate.ts`)

`--context-file` takes precedence over `--context`. They are not merged.

1. If `--context-file` is provided, read the file contents and use that as the context string
2. Else if `--context` is provided, use the inline string
3. Else `context` is `undefined`

The resolved string is passed as `context` to every `llmTranslateBundle` call.

### Settings read pattern (in `translate.ts`)

```ts
const project = await getInlangProject({ projectPath: args.project });
const settings = await project.settings.get();
const sourceLocale = options.locale ?? settings.baseLocale;
const targetLocales: string[] = options.targetLocales
  ? options.targetLocales[0]?.split(",")
  : settings.locales.filter((l) => l !== sourceLocale);
```

Mirrors the existing `machine/translate.ts` settings-read pattern exactly.

### Batching and dry-run (in `translate.ts`)

`translate.ts` groups all bundles into chunks of `--batch-size`. Each chunk is one OpenRouter call. The dry-run guard is applied **before** calling the API — in dry-run mode, the chunks are printed to stdout and `process.exit(0)` is called without writing.

After receiving translated bundles, `translate.ts` calls:
```ts
await upsertBundleNested(project.db, bundle.data);
```
for each successful result, then:
```ts
await saveProjectToDirectory({ fs, path: args.project, project });
```

### Token usage in `translate.ts`

Because multiple bundles share one API call, token usage is attributed at the **call level** in `translate.ts`, not per-bundle. After each batch call, `translate.ts` logs the total tokens for that batch (unless `--quiet`). Aggregated totals are logged at the end of the run.

---

## Benchmark Package: `llm-translate-benchmark`

The benchmark calls the OpenRouter API directly (it does not go through `llmTranslateBundle`) so it can measure raw per-call token usage without the per-bundle attribution issue.

### Keys (`fixtures/keys.ts`)

1000 keys generated programmatically in `en-gb`:

| Category | Count | Notes |
|---|---|---|
| Simple text | 300 | No variables, short strings |
| Single variable | 250 | `{name}`, `{count}`, etc. |
| Multi-variable | 150 | 2–3 variables per string |
| Count variable (plural-adjacent) | 100 | `{count}` with surrounding number context |
| Markup nodes | 80 | `markup-start`/`markup-end` nodes |
| Long strings (>100 chars) | 70 | Variables mid-sentence |
| Edge cases | 50 | Marked with `// EDGE:` comment |

Edge cases include:
- Variable at string start: `"{name} has joined"`
- Variable at string end: `"Welcome back, {name}"`
- Adjacent variables: `"{firstName} {lastName}"`
- Variable-only pattern: `"{count}"`
- Empty text node between two expressions
- Markup wrapping a variable: `<b>{count}</b> items`

### Experiment matrix (`benchmark.ts`)

| Dimension | Values |
|---|---|
| Batch sizes | 5, 10, 20, 50, 100 keys per call |
| Locale strategy | `multi-locale` (all locales per call) vs. `per-locale` (one locale per call) |

Each cell = one or more OpenRouter calls. All calls recorded individually.

### Token record shape

```ts
type BenchmarkRecord = {
  runId: string;            // uuid — groups all calls in one benchmark run
  timestamp: string;        // ISO 8601
  model: string;
  strategy: "multi-locale" | "per-locale";
  batchSize: number;        // configured keys per call
  keyCount: number;         // actual keys in this call
  locales: string[];        // locales requested in this call
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;     // 0 if not returned by model
  thinkingTokens: number;   // 0 if not returned by model
  totalTokens: number;
  successCount: number;     // variants accepted after AST validation
  rejectedCount: number;    // variants rejected by AST validation
  durationMs: number;
}
```

`results/runs.json` — append-only array of `BenchmarkRecord`.
`results/runs.csv` — flat CSV auto-derived after each run, same fields.

---

## What is NOT in scope

- Functional parity with `inlang machine translate` (no Google Translate fallback, no RPC)
- Plural/selector-aware batching (complex match patterns translated per-variant same as simple ones)
- A standalone `@inlang/llm-translate` package (extractable later based on demand)
- Opening the PR (author will do this manually)

---

## Contribution checklist

- [ ] `packages/cli/src/main.ts` updated with `.addCommand(llm)`
- [ ] `packages/llm-translate-benchmark/` added to `pnpm-workspace.yaml`
- [ ] `pnpm --filter @inlang/cli... build` passes
- [ ] `packages/cli/src/commands/llm/translate.test.ts` added (gated integration test matching `translate.test.ts` pattern in `machine/`)
- [ ] `pnpm --filter @inlang/cli test` passes
- [ ] `npx changeset` entry written for `@inlang/cli`
- [ ] Benchmark results committed to `packages/llm-translate-benchmark/results/`
- [ ] `inlang llm translate --help` output is clean
