# OpenRouter TypeScript SDK Migration

**Date:** 2026-03-23
**Branch:** feature/llm-translations
**Status:** Approved

## Overview

Migrate the OpenRouter client abstraction in `packages/cli` from raw `fetch()` with a manual retry loop to the OpenRouter TypeScript SDK (the `openai` npm package pointed at OpenRouter's base URL). The primary motivation is to respect the `Retry-After` header on 429 responses rather than using fixed exponential backoff. Application-level retries for invalid LLM responses are retained unchanged.

## Scope

Four source files change, one package dependency is added, and two test files are rewritten.

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

- `temperature` defaults to `0.1` inside the method when not provided (preserving current behavior from `callOpenRouter`)
- Accepts `OpenRouterMessage[]` (`role: "system" | "user"`); casts to `ChatCompletionMessageParam[]` before calling `client.chat.completions.create(...)`
- Maps the typed SDK response to the existing `OpenRouterResponse` / `OpenRouterUsage` types (both unchanged)
- Wraps `OpenAI.APIError` into plain `Error` objects so no SDK types leak to callers

**Removed:** `OPENROUTER_URL`, `BASE_DELAY_MS`, manual retry loop, `sleep()` helper

**Kept:** All exported types (`OpenRouterMessage`, `OpenRouterUsage`, `OpenRouterResponse`), all env var constants (`OPENROUTER_API_KEY_ENV`, `OPENROUTER_SITE_URL_ENV`, `OPENROUTER_SITE_NAME_ENV`)

### `llmTranslateBundle.ts`

**`LlmTranslateBundleArgs`:** replace `openrouterApiKey?: string` with `client: OpenRouterClient`. `model` remains on the args. `LlmTranslateBundlesArgs` is `Omit<LlmTranslateBundleArgs, "bundle"> & { bundles: BundleNested[] }` and inherits `client` automatically.

**`llmTranslateBundle`:**
- Remove the `apiKey` resolution block (lines 65-68) and the "no API key" early-return — key validation now lives exclusively in `llmTranslateCommandAction`
- All `callOpenRouter({ apiKey, model, messages, ... })` calls become `args.client.complete({ model, messages })`
- `siteUrl` / `siteName` are no longer passed here — they are baked into the client at construction time
- Update the import from `./openrouterClient.js` to remove `OPENROUTER_API_KEY_ENV`, `OPENROUTER_SITE_URL_ENV`, and `OPENROUTER_SITE_NAME_ENV` (no longer used); import `OpenRouterClient` type instead

**`llmTranslateBundles`:**
- Remove the `apiKey` resolution block (lines 219-226) and the "no API key" early-return for the same reason
- All `callOpenRouter(...)` calls become `args.client.complete(...)`
- Otherwise unchanged

The `MAX_RETRIES = 3` loop for malformed responses in both functions: **untouched**.

### `translate.ts` / `llmTranslateCommandAction`

The API key is resolved and the dry-run guard live inside `llmTranslateCommandAction`. The client must be constructed **inside `llmTranslateCommandAction`**, after the dry-run early-return and after the API key is resolved and validated. This preserves existing behavior where a missing key is only an error when actually making calls.

```
// inside llmTranslateCommandAction, after the dryRun guard:
const apiKey = args.apiKey ?? process.env[OPENROUTER_API_KEY_ENV];
if (!apiKey) throw new Error(`${OPENROUTER_API_KEY_ENV} is required unless --dry-run is used.`);
const client = new OpenRouterClient({
  apiKey,
  siteUrl: process.env[OPENROUTER_SITE_URL_ENV],
  siteName: process.env[OPENROUTER_SITE_NAME_ENV],
});
// replace openrouterApiKey: apiKey with client in llmTranslateBundles(...) call
```

## Error handling

- Transport errors (429, 5xx, timeout, network): delegated entirely to the SDK
- Non-retryable 4xx (401, 404, etc.): SDK throws immediately; caught and re-wrapped as plain `Error`
- Malformed LLM response: unchanged application-level retry in `llmTranslateBundle.ts`
- Missing API key: validated once in `llmTranslateCommandAction` before client construction; removed from `llmTranslateBundle` and `llmTranslateBundles`

## Tests

### `openrouterClient.test.ts` — rewritten

Use `vi.mock('openai')` to spy on the `OpenAI` constructor and stub `chat.completions.create`. Coverage:

- Success case with correct usage mapping (including `cachedTokens`, `thinkingTokens`)
- Retry configuration: assert the `OpenAI` constructor is called with `maxRetries: 4` and `timeout: 60_000` — configuration assertion only; `Retry-After` honoring is delegated to the SDK and not re-tested
- Non-retryable 4xx: `APIError` with a 4xx status is caught and surfaced as a plain `Error`
- Malformed response (empty/missing choices): surfaces as a descriptive `Error`
- Timeout: `APIConnectionTimeoutError` is caught and surfaced as a plain `Error`

### `llmTranslateBundle.test.ts` — updated

Integration tests gated on a real API key. Remove any args that include `openrouterApiKey`; replace with a constructed `OpenRouterClient`. The existing "no API key" error path test (`openrouterApiKey: undefined` → expected error) is removed — that validation has moved to `llmTranslateCommandAction` and is covered in `translate.unit.test.ts`.

### `translate.unit.test.ts` — updated

Add a test asserting that `llmTranslateCommandAction` throws (or rejects) with a message matching `OPENROUTER_API_KEY_ENV` when no API key is provided via `args.apiKey` and the env var is unset. This replaces the coverage removed from `llmTranslateBundle.test.ts`.

### `llmTranslateBundleUnit.test.ts` — updated

Currently mocks `callOpenRouter` via `vi.mock("./openrouterClient.js")` and imports `callOpenRouter` as a mock. After migration:

- Change `vi.mock("./openrouterClient.js")` mock to stub `OpenRouterClient.prototype.complete` instead of `callOpenRouter`
- Update all test args to pass `client: mockClient` (a `new OpenRouterClient(...)` instance, or a plain object matching the interface) instead of `openrouterApiKey`
- Update all `expect(callOpenRouter).toHaveBeenCalledTimes(n)` assertions to `expect(mockClient.complete).toHaveBeenCalledTimes(n)`
- Same scenario coverage is retained for both `llmTranslateBundle` and `llmTranslateBundles`

## Files changed

| File | Change |
|---|---|
| `packages/cli/package.json` | Add `openai` dependency |
| `packages/cli/src/commands/llm/openrouterClient.ts` | Replace `callOpenRouter` function with `OpenRouterClient` class |
| `packages/cli/src/commands/llm/openrouterClient.test.ts` | Rewrite to mock SDK via `vi.mock('openai')` |
| `packages/cli/src/commands/llm/llmTranslateBundle.ts` | Accept `client: OpenRouterClient`; remove internal `apiKey` resolution from both functions |
| `packages/cli/src/commands/llm/llmTranslateBundle.test.ts` | Replace `openrouterApiKey` with client; remove "no API key" test |
| `packages/cli/src/commands/llm/llmTranslateBundleUnit.test.ts` | Re-mock `OpenRouterClient.prototype.complete` instead of `callOpenRouter` |
| `packages/cli/src/commands/llm/translate.ts` | Construct `OpenRouterClient` inside `llmTranslateCommandAction`; pass `client` to `llmTranslateBundles` |
| `packages/cli/src/commands/llm/translate.unit.test.ts` | Add "no API key" throw test for `llmTranslateCommandAction` |
