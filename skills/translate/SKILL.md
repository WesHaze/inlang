---
name: inlang-translate
description: Translates inlang bundles, use when the user wants to translate new keys or regenerate stale translations.
compatibility: Requires Node.js 18+. Must be installed inside a valid inlang project.
license: Apache-2.0
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
node scripts/scan.js [--force]
```

Store the full JSON output — it contains `projectPath` and everything needed for translation and writing. `--force` overwrites existing translations instead of only filling missing ones.

### 2. Translate batches
Process the batches from the scan output using `project.baseLocale` and `interpretationContext` as context. Subagents can be used to process batches in parallel — forward the following instructions to each:

> For each bundle, for each `targetLocale`:
> 1. Translate each `sourceVariant` into the target locale, keeping `matches` identical
> 2. Only translate `{ type: "text" }` nodes — copy all other node types verbatim
> 3. Use `existingTranslations` for reference and consistency
>
> Validate each translation:
> ```bash
> echo '<json>' | node scripts/validate.js
> ```
>
> On failure, read stderr, fix, and retry up to `hallucinationRetries` times. Return `passing` and `exhausted` bundles to the main agent.

### 3. Write
Wait for all batches to finish, then collect every `passing` translation and write in a single call:
```bash
echo '{ "projectPath": "...", "translations": [...all passing...] }' | node scripts/write.js
```

### 4. Report
Surface exhausted bundles and their failure reasons to the user — never swallow failures silently.