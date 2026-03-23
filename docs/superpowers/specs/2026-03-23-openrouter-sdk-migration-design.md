# OpenRouter TypeScript SDK Migration

**Date:** 2026-03-23
**Branch:** feature/llm-translations
**Status:** Approved

## Overview

Migrate the OpenRouter client abstraction in `packages/cli` from raw `fetch()` with a manual retry loop to the OpenRouter TypeScript SDK (the `openai` npm package pointed at OpenRouter's base URL). The primary motivation is to respect the `Retry-After` header on 429 responses rather than using fixed exponential backoff. Application-level retries for invalid LLM responses are retained unchanged.

## Scope

Three source files change, one package dependency is added, and two test files are rewritten.

## Architecture

### Retry responsibility split

| Layer | Handles |
|---|---|
| SDK (`openai` package) | 429 (with `Retry-After`), 5xx, timeouts — up to 5 total attempts (`maxRetries: 4`) |
| Application (`llmTranslateBundle.ts`) | Malformed/invalid LLM responses (bad JSON, pattern validation failures) — `MAX_RETRIES = 3`, unchanged |

### Dependency

Add `openai` to `packages/cli/package.json` dependencies. This is the SDK that OpenRouter's TypeScript SDK documentation references, configured with a custom `baseURL`.

## Components

### `openrouterClient.ts`

Replace the `callOpenRouter` function with an `OpenRouterClient` class.

**Constructor:** `constructor({ apiKey, siteUrl?, siteName? })`

- Creates an `OpenAI` SDK instance with:
  - `baseURL: "https://openrouter.ai/api/v1"`
  - `apiKey`
  - `defaultHeaders`: `HTTP-Referer` and `X-Title` if provided
  - `maxRetries: 4` (4 retries = 5 total attempts, matching current `MAX_ATTEMPTS`)
  - `timeout: 60_000` (matching current `REQUEST_TIMEOUT_MS`)

**Public method:** `complete({ model, messages, temperature? }): Promise<OpenRouterResponse>`

- Calls `client.chat.completions.create(...)`
- Maps the typed SDK response to the existing `OpenRouterResponse` / `OpenRouterUsage` types (both unchanged)
- Wraps `OpenAI.APIError` into plain `Error` objects so no SDK types leak to callers

**Removed:** `OPENROUTER_URL`, `BASE_DELAY_MS`, manual retry loop, `sleep()` helper

**Kept:** All exported types (`OpenRouterMessage`, `OpenRouterUsage`, `OpenRouterResponse`), all env var constants (`OPENROUTER_API_KEY_ENV`, `OPENROUTER_SITE_URL_ENV`, `OPENROUTER_SITE_NAME_ENV`)

### `llmTranslateBundle.ts`

- `LlmTranslateBundleArgs`: replace `openrouterApiKey?: string` with `client: OpenRouterClient`
- `model` remains on the args (translation concern, not client concern)
- All internal calls to `callOpenRouter({ apiKey, model, messages, ... })` become `client.complete({ model, messages, ... })`
- `llmTranslateBundles()` updated identically
- `MAX_RETRIES = 3` loop for malformed responses: **untouched**

### `translate.ts`

- Construct `new OpenRouterClient({ apiKey, siteUrl, siteName })` once near the top of the command handler, after resolving the API key from env/option
- Pass the client instance into `llmTranslateBundles`
- No logic changes

## Error handling

- Transport errors (429, 5xx, timeout, network): delegated entirely to the SDK
- Non-retryable 4xx (401, 404, etc.): SDK throws immediately; caught and re-wrapped as plain `Error`
- Malformed LLM response: unchanged application-level retry in `llmTranslateBundle.ts`

## Tests

### `openrouterClient.test.ts` — rewritten

Mock `openai` SDK's `chat.completions.create`. Coverage:

- Success case with correct usage mapping
- SDK-level 429: verify the SDK is configured with `maxRetries: 4` (Retry-After delegation, not re-implemented)
- Non-retryable 4xx: surfaces as plain `Error` with status info
- Malformed response (empty choices): surfaces as descriptive error
- Timeout: SDK `APIConnectionTimeoutError` wrapped as plain `Error`

### `llmTranslateBundle.test.ts` — updated

- Construct a mock `OpenRouterClient` with a stubbed `complete()` method
- Inject directly instead of patching `globalThis.fetch`
- Same scenario coverage as before

## Files changed

| File | Change |
|---|---|
| `packages/cli/package.json` | Add `openai` dependency |
| `packages/cli/src/commands/llm/openrouterClient.ts` | Replace function with class |
| `packages/cli/src/commands/llm/openrouterClient.test.ts` | Rewrite to mock SDK |
| `packages/cli/src/commands/llm/llmTranslateBundle.ts` | Accept `client` instead of `apiKey` |
| `packages/cli/src/commands/llm/llmTranslateBundle.test.ts` | Inject mock client |
| `packages/cli/src/commands/llm/translate.ts` | Construct client, pass down |
