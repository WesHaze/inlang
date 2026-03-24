---
name: inlang-translate
description: Translates missing variants in an inlang project using the agent's LLM. Scans all bundles for missing locale translations, batches them for the agent to translate with full project context, validates output, and writes results back. Use when asked to translate an inlang project or fill missing translations.
compatibility: Requires Node.js 18+. Must be installed inside a valid inlang project.
allowed-tools: Bash(node:*) Agent
---

# inlang-translate

Translates missing variants in an inlang project. Run from the directory containing your `*.inlang` project.

## Setup

Edit `config.json` in the skill directory before running:

- `bundleBatchSize` — bundles per translation batch (default: 20)
- `interpretationContext` — domain/tone context for the LLM (default: "")
- `hallucinationRetries` — max retries per bundle on validation failure (default: 3)

## Flow

### 1. Scan

```bash
node scripts/scan.js
```

Outputs JSON to stdout: `{ project, interpretationContext, batches[] }`.

Read and store the full output — it contains everything needed for translation AND writing.

### 2. Dispatch subagents (parallel)

Spawn **one subagent per batch**. Each subagent receives:
- Its batch (bundles with `sourceVariants`, `existingTranslations`, `missingLocales`)
- `project.baseLocale` and `interpretationContext`

**Subagent instructions:**

For each bundle in the batch, for each `missingLocale`:
1. Translate each `sourceVariant` into the target locale
2. Produce one translated variant per source variant with identical `matches`
3. Only translate `{ type: "text" }` nodes (modify `value` field only)
4. Leave all other node types (`expression`, `markup-start`, `markup-end`, `markup-standalone`) completely unchanged — copy them verbatim
5. Use `existingTranslations` for reference and consistency

Produce output JSON:
```json
{
  "bundleId": "...",
  "locale": "fr",
  "declarations": [],
  "selectors": [],
  "existingMessageId": null,
  "variants": [{ "matches": [], "pattern": [...] }]
}
```

Then validate:
```bash
echo '<translation-json>' | node scripts/validate.js
```

Where the validate input is:
```json
{
  "translations": [{
    "bundleId": "...",
    "locale": "fr",
    "sourceVariants": [...],
    "variants": [...]
  }]
}
```

`sourceVariants` must be copied from the bundle's `sourceVariants` in your batch data — the same source variants you translated from. Include the exact stderr error text in your retry reasoning so the model can target the specific failing node.

If validate exits non-zero, read the error from stderr, fix the translation, and retry. Retry up to `config.hallucinationRetries` times per bundle.

Return to the main agent:
```json
{
  "passing": [{ "bundleId": "...", "locale": "fr", "declarations": [], "selectors": [], "existingMessageId": null, "variants": [...] }],
  "exhausted": [{ "bundleId": "...", "locale": "fr", "reason": "..." }]
}
```

### 3. Write

Collect all `passing` arrays from all subagents. Concatenate into a single payload and pipe to write.js:

```bash
echo '{ "translations": [...all passing...] }' | node scripts/write.js
```

### 4. Report

Surface to the user:
- How many variants were translated
- Which bundles were exhausted (retry limit reached) with their failure reasons
- Never silently swallow failures

## Data model

See `references/data-model.md` for pattern node types and what to translate.
