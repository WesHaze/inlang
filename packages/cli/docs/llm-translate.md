---
title: LLM Translate - AI-powered translations via OpenRouter
description: Use any LLM to translate missing messages in your inlang project. Supports brand/style context, custom models, and CI/CD pipelines.
---

# LLM Translate

Translate missing messages using an LLM of your choice via [OpenRouter](https://openrouter.ai).

Unlike `machine translate` (which uses Google Translate), `llm translate` lets you pick any model and inject brand/style context so translations match your product's tone.

## Quick start

**1. Get an API key**

Sign up at [openrouter.ai](https://openrouter.ai) and create an API key.

**2. Export the key**

```sh
export OPENROUTER_API_KEY="your-api-key"
```

For CI/CD, add it as a secret environment variable in your provider's settings.

**3. Run**

```sh
npx @inlang/cli llm translate --project ./project.inlang
```

This translates all bundles that are missing a translation for any locale defined in your project settings.

---

## Options reference

| Flag | Default | Description |
|---|---|---|
| `--project <path>` | — | **Required.** Path to the `.inlang` project directory |
| `--model <id>` | `openai/gpt-4o-mini` | Any [OpenRouter model ID](https://openrouter.ai/models) |
| `--locale <locale>` | `settings.baseLocale` | Override source locale from project settings |
| `--targetLocales <locales...>` | all non-source locales | Target locales. Space-separated or comma-separated, e.g. `--targetLocales fr de` or `--targetLocales fr,de` |
| `--context <text>` | — | Inline brand/style instructions for the LLM |
| `--context-file <path>` | — | Path to a markdown file with brand/style instructions (takes precedence over `--context`) |
| `--batch-size <n>` | `200` | Number of bundles per LLM call |
| `--force` | false | Overwrite existing non-empty translations |
| `--dry-run` | false | Preview what would be translated without writing or calling the API |
| `-q, --quiet` | false | Suppress per-batch token log lines |

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes (unless `--dry-run`) | API key from [openrouter.ai](https://openrouter.ai) |
| `OPENROUTER_SITE_URL` | No | Sent as `HTTP-Referer` header — used by OpenRouter for attribution |
| `OPENROUTER_SITE_NAME` | No | Sent as `X-Title` header — used by OpenRouter for attribution |

---

## Choosing a model

`--model` accepts any model ID from [openrouter.ai/models](https://openrouter.ai/models).

| Model | Use case |
|---|---|
| `openai/gpt-4o-mini` *(default)* | Fast and low-cost. Good for most UI strings. |
| `openai/gpt-4o` | Higher quality. Better for long or nuanced strings. |
| `anthropic/claude-3.5-sonnet` | Strong at preserving tone and formatting. |

Example:

```sh
npx @inlang/cli llm translate --project ./project.inlang --model openai/gpt-4o
```

---

## Brand and style context

Use `--context` or `--context-file` to give the LLM instructions about your product's tone, terminology, or style. This helps produce translations that sound like your brand rather than generic machine output.

**Inline context:**

```sh
npx @inlang/cli llm translate --project ./project.inlang \
  --context "Informal tone. Use 'you' not 'one'. Avoid jargon."
```

**Context file (recommended for longer instructions):**

Create a markdown file, e.g. `translation-context.md`:

```markdown
## Tone
Write in a friendly, informal tone. Use "you" and avoid corporate language.

## Terminology
- "workspace" not "project"
- "teammates" not "users" or "members"

## Do not translate
- Product names: Acme, Acme Pro
- Technical terms: API, SDK, CLI
```

Then pass it with `--context-file`:

```sh
npx @inlang/cli llm translate --project ./project.inlang \
  --context-file ./translation-context.md
```

`--context-file` takes precedence over `--context` if both are provided. They are not merged.

---

## How it works

*This section is for contributors and anyone curious about the internals.*

1. All bundles in the project are loaded and split into chunks of `--batch-size`.
2. Each chunk is passed to `llmTranslateBundles`, which sends the entire chunk as a single LLM call via OpenRouter. The request payload is a JSON object keyed by `bundleId::variantId`, where each entry is `{ pattern: [...], targetLocales: [...] }`. The LLM is expected to return `{ "bundleId::variantId": { "locale": [...pattern...] } }`.
3. The LLM is instructed to translate only the `"value"` field of nodes where `"type"` is `"text"`. All other node types (`expression`, `markup-start`, `markup-end`, `markup-standalone`) must be returned exactly as given — this preserves variables and markup in translated strings.
4. In `llmTranslateBundles` (the function the command uses), each locale's translated pattern is validated: it must be a JSON array, all non-text nodes must deep-equal their source counterparts, and text nodes that were non-empty in the source must remain non-empty. If a locale's pattern fails validation, only that locale-variant combination is skipped with a warning; other valid locales in the same bundle are still applied.
5. If the LLM returns unparseable JSON or a non-object response, the entire batch retries up to 3 total attempts with exponential backoff.
6. The HTTP client separately retries on HTTP 429, 5xx, network errors, and request timeouts — up to 5 total attempts with exponential backoff.
