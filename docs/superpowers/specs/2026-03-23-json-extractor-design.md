# JSON Extractor Design

**Date:** 2026-03-23
**Branch:** feature/llm-translations
**Status:** Approved

## Overview

Replace direct `JSON.parse(response.content)` calls in the LLM translation retry loops with a hardened `extractJson` function that recovers from common LLM response quirks before parsing. This reduces retries caused by recoverable formatting failures rather than genuine translation errors.

## Motivation

The current retry loops in `llmTranslateBundle` and `llmTranslateBundles` treat any `JSON.parse` failure as grounds for a full retry. Many of these failures are caused by predictable LLM formatting habits (markdown fences, preamble text, trailing commas, single quotes) that can be corrected in code. Handling them defensively eliminates most structural retries.

## Scope

Three files change:

| File | Change |
|---|---|
| `packages/cli/src/commands/llm/jsonExtractor.ts` | New file — `extractJson` function |
| `packages/cli/src/commands/llm/jsonExtractor.test.ts` | New file — unit tests |
| `packages/cli/src/commands/llm/llmTranslateBundle.ts` | Use `extractJson`; align bare-array handling |

## Design

### `jsonExtractor.ts`

Exports a single function:

```typescript
export function extractJson(raw: string): unknown
```

Throws if the content cannot be parsed after all normalization steps. Callers wrap it in `try/catch` as they do today with `JSON.parse`.

**Normalization pipeline (applied in order):**

1. **Trim** — remove leading/trailing whitespace
2. **Strip markdown fences** — remove ` ```json ` or ` ``` ` at start/end (case-insensitive)
3. **Extract JSON substring** — find the first `{` or `[` and the last matching `}` or `]`; discard any preamble or postamble text outside that range
4. **Remove trailing commas** — replace `,` followed by optional whitespace and `}` or `]` with just the closing character (regex: `/,(\s*[}\]])/g`)
5. **Replace single quotes** — replace `'` with `"` (best-effort; may misfire when translated strings contain apostrophes, but acceptable given the alternative is a retry)
6. **`JSON.parse`** — parse and return the result

### `llmTranslateBundle.ts`

Two targeted changes:

**1. Replace `JSON.parse` with `extractJson`**

Both parse sites:
```typescript
// Before:
const parsed = JSON.parse(response.content) as unknown;

// After:
const parsed = extractJson(response.content);
```

The surrounding `try/catch` block is unchanged — `extractJson` throws on failure just as `JSON.parse` did.

**2. Align bare-array handling in `llmTranslateBundle`**

After parsing, when `remainingLocales.length === 1` and the result is an array, wrap it into the expected object shape before the existing validation logic. This mirrors the handling already present in `llmTranslateBundles`:

```typescript
// After parsing, before checking typeof parsed:
let normalized: unknown = parsed;
if (Array.isArray(parsed) && remainingLocales.length === 1) {
  normalized = { [remainingLocales[0]!]: parsed };
}
// then use `normalized` where `parsed` was used for the translationsMap check
```

### `jsonExtractor.test.ts`

Unit tests covering each normalization step independently:

- Returns parsed object for clean JSON input
- Strips ` ```json ``` ` fences
- Strips ` ``` ``` ` fences (no language specifier)
- Extracts JSON from preamble text ("Here is the translation: {...}")
- Extracts JSON from postamble text ("{...} Hope that helps!")
- Removes trailing commas before `}`
- Removes trailing commas before `]`
- Replaces single quotes with double quotes
- Throws on input with no JSON-like content
- Handles combination of fences + trailing comma + single quotes

## Error handling

`extractJson` throws a plain `Error` on failure. Callers (`llmTranslateBundle` and `llmTranslateBundles`) already wrap the parse step in `try/catch` and handle the failure as a retry trigger — no changes needed to that logic.

## Limitations

Single-quote replacement is a regex substitution. It will produce invalid JSON if a translated string value itself contains a single quote (apostrophe), e.g., `"don't"` in a single-quoted JSON string would become `"don"t"`. This is an accepted trade-off: the alternative is a retry anyway, and the cases where this fires incorrectly are rare in practice. A JSON repair library could handle this more robustly but is out of scope.
