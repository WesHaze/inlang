---
"@inlang/cli": minor
---

## `inlang llm translate` — LLM-powered translations via OpenRouter

Translate missing messages in any inlang project using any LLM available on [OpenRouter](https://openrouter.ai). Unlike the built-in `machine translate` command, `llm translate` lets you choose the model and inject brand/style context so the output matches your product's tone.

### Quick start

```bash
# Set your API key once
export INLANG_OPENROUTER_API_KEY="sk-or-..."

# Translate all missing strings
npx @inlang/cli llm translate --project ./project.inlang
```

### Arguments

| Flag | Default | Description |
| --- | --- | --- |
| `--project <path>` | — | **Required.** Path to the `.inlang` project directory. |
| `--model <id>` | `openai/gpt-5-mini` | Any model ID from [openrouter.ai/models](https://openrouter.ai/models). Lite reasoning models are strongly recommended — they are significantly more reliable at preserving variables and applying style context. |
| `--locale <locale>` | `settings.baseLocale` | Override the source locale. Useful when you want to translate from a secondary locale or when the project base locale differs from your working language. |
| `--targetLocales <locales...>` | all non-source locales | Space-separated or comma-separated list of target locales, e.g. `--targetLocales fr de ja` or `--targetLocales fr,de`. Defaults to every locale defined in project settings except the source. |
| `--context <text>` | — | Inline brand/style instructions passed to the LLM with every batch. Use this for short instructions. |
| `--context-file <path>` | — | Path to a markdown file containing brand/style instructions. **Takes precedence over `--context` if both are supplied — they are not merged.** Recommended for longer briefs covering tone, terminology, and do-not-translate rules. |
| `--batch-size <n>` | `10` | Number of bundles sent to the LLM in a single API call. Larger batches are faster but increase the chance of a parse error requiring a retry. |
| `--force` | `false` | Overwrite existing non-empty translations. Without this flag, any locale that already has a translation for a given bundle is silently skipped. |
| `--dry-run` | `false` | Print what would be translated without making any API calls. Skips the API key requirement entirely — useful for previewing scope in CI. |
| `--strict` | `false` | Exit with code 1 if any bundles could not be fully translated (e.g. the LLM returned malformed output that failed validation after all retries). Without `--strict` the command exits 0 as long as there are no hard errors. Use in CI to fail a pipeline when translations are incomplete. |
| `--max-retries <n>` | `3` | Maximum number of LLM call attempts per batch when the response fails validation. Retries use exponential backoff (500 ms, 1 s, 2 s, …). Increase for flaky network conditions; decrease to fail faster. |
| `-q, --quiet` | `false` | Suppress per-bundle warnings, retry notices, and per-batch token usage lines. Final summary is always printed. |
| `--api-key <key>` | — | OpenRouter API key. Overrides the `INLANG_OPENROUTER_API_KEY` environment variable. Prefer the env var in CI to avoid secrets appearing in shell history. |

### Context: inline vs file

Both `--context` and `--context-file` inject free-form instructions into every LLM prompt. Use them to encode tone of voice, terminology preferences, and strings that must not be translated (brand names, placeholder values, format strings).

`--context-file` **always takes precedence** over `--context`. If both are provided the file content is used and the inline string is ignored. They are not merged.

Example context file (`translation-context.md`):

```markdown
## Tone
Friendly and approachable. Use "you", avoid corporate language.

## Terminology
- "workspace" not "project"
- "teammates" not "users"

## Do not translate
- Product name: Acme
- Variables: {name}, {count}, {date}
```

### How it works

1. All bundles in the project are loaded from the inlang SQLite database and split into chunks of `--batch-size`.
2. Each chunk is sent as a single LLM call via OpenRouter. The request payload is a JSON object keyed by `bundleId::variantId`, where each entry contains the source pattern nodes and the list of target locales to produce.
3. The LLM is instructed to translate only `"type": "text"` nodes. All other node types — `expression` (variables), `markup-start`, `markup-end`, `markup-standalone` — must be returned exactly as provided. This is how variables like `{name}` and markup like `<b>` are preserved in translated strings.
4. Each translated pattern is validated before being written: it must be a valid JSON array, all non-text nodes must deep-equal the source, and text nodes that were non-empty in the source must remain non-empty. Locales that fail validation are skipped with a warning; valid locales in the same bundle are still applied.
5. If the LLM returns unparseable JSON or a non-object response the entire batch is retried up to `--max-retries` times with exponential backoff. HTTP 429, 5xx, and network errors are retried separately at the HTTP layer (up to 5 attempts).
6. Successfully translated bundles are upserted back into the project database. The project is saved to disk once all batches complete.

### Environment variables

| Variable | Description |
| --- | --- |
| `INLANG_OPENROUTER_API_KEY` | API key from openrouter.ai. Required unless `--dry-run` or `--api-key` is used. |
| `INLANG_OPENROUTER_SITE_URL` | Sent as `HTTP-Referer` — used by OpenRouter for attribution. |
| `INLANG_OPENROUTER_SITE_NAME` | Sent as `X-Title` — used by OpenRouter for attribution. |
