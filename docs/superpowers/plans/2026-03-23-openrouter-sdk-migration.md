# OpenRouter TypeScript SDK Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-fetch OpenRouter client with the `openai` npm SDK so that 429 rate-limit responses are handled using the server's `Retry-After` header rather than fixed exponential backoff.

**Architecture:** An `OpenRouterClient` class wraps the `openai` SDK configured for `https://openrouter.ai/api/v1`. It exposes a single `complete()` method. The client is constructed once in `llmTranslateCommandAction` and injected into the bundle translation functions as a `client` argument. The SDK handles transport-level retries (`maxRetries: 4`); the existing `MAX_RETRIES = 3` loop inside the bundle functions handles malformed LLM responses and is left untouched.

**Tech Stack:** TypeScript, `openai` npm package (v4+), vitest for tests, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-03-23-openrouter-sdk-migration-design.md`

---

## File Map

| File | What changes |
|---|---|
| `packages/cli/package.json` | Add `openai` dependency |
| `packages/cli/src/commands/llm/openrouterClient.ts` | Add `OpenRouterClient` class; later remove `callOpenRouter` |
| `packages/cli/src/commands/llm/openrouterClient.test.ts` | Add new class tests; later remove old fetch-mock tests |
| `packages/cli/src/commands/llm/llmTranslateBundle.ts` | `client: OpenRouterClient` replaces `openrouterApiKey`; remove internal key resolution |
| `packages/cli/src/commands/llm/llmTranslateBundleUnit.test.ts` | Inject `mockClient` instead of mocking `callOpenRouter` (Task 3) |
| `packages/cli/src/commands/llm/llmTranslateBundle.test.ts` | Non-integration tests: swap `openrouterApiKey`→`client`, delete "no API key" test (Task 3); integration tests: add `client` (Task 5) |
| `packages/cli/src/commands/llm/translate.ts` | Construct `OpenRouterClient` in `llmTranslateCommandAction`; pass as `client` (Task 4) |
| `packages/cli/src/commands/llm/translate.unit.test.ts` | Update `openrouterApiKey` assertions; add "no API key" + "client passed" tests (Task 4) |

---

## Task 1: Install `openai` dependency

**Files:**
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Add the dependency**

  In `packages/cli/package.json`, add `"openai": "^4.0.0"` to the `"dependencies"` object (alongside existing deps).

- [ ] **Step 2: Install**

  Run from the repo root:
  ```bash
  pnpm install
  ```
  Expected: lock file updated, `packages/cli/node_modules/openai/` created.

- [ ] **Step 3: Verify TypeScript can see the package**

  ```bash
  cd packages/cli && pnpm exec tsc --noEmit
  ```
  Expected: no errors (file compiles as-is; we haven't imported `openai` yet).

- [ ] **Step 4: Commit**

  ```bash
  git add packages/cli/package.json pnpm-lock.yaml
  git commit -m "feat(cli): add openai sdk dependency"
  ```

---

## Task 2: Implement `OpenRouterClient` class (TDD)

`callOpenRouter` stays in the file for now — it will be removed in Task 5 once all callers have been migrated.

**Files:**
- Modify: `packages/cli/src/commands/llm/openrouterClient.test.ts`
- Modify: `packages/cli/src/commands/llm/openrouterClient.ts`

- [ ] **Step 1: Write failing tests for `OpenRouterClient`**

  Append a new `describe("OpenRouterClient", ...)` block to the end of `openrouterClient.test.ts`. The existing `describe("callOpenRouter", ...)` block stays untouched.

  ```typescript
  // ─── NEW TESTS — append after the existing describe("callOpenRouter") block ───

  import OpenAI from "openai";

  // vi.hoisted ensures mockCreate is available inside the vi.mock factory (which is
  // hoisted to the top of the file by vitest's transform).
  const mockCreate = vi.hoisted(() => vi.fn());

  vi.mock("openai", () => {
    class MockAPIError extends Error {
      status: number;
      constructor(status: number, _error: unknown, message: string, _headers: unknown) {
        super(message);
        this.name = "APIError";
        this.status = status;
      }
    }
    class MockAPIConnectionTimeoutError extends Error {
      constructor() {
        super("Connection timed out.");
        this.name = "APIConnectionTimeoutError";
      }
    }
    class MockOpenAI {
      chat = { completions: { create: mockCreate } };
      static APIError = MockAPIError;
      static APIConnectionTimeoutError = MockAPIConnectionTimeoutError;
    }
    return { default: MockOpenAI };
  });

  describe("OpenRouterClient", () => {
    beforeEach(() => {
      mockCreate.mockReset();
    });

    function makeSuccessCompletion(content = "ok") {
      return {
        choices: [{ message: { content } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_tokens_details: { cached_tokens: 2 },
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      };
    }

    it("is constructed with correct SDK options (baseURL, maxRetries, timeout)", () => {
      // We spy on the MockOpenAI constructor via vi.mocked on the default export.
      const MockOpenAI = vi.mocked((await import("openai")).default);
      new OpenRouterClient({ apiKey: "k", siteUrl: "https://example.com", siteName: "Test" });
      expect(MockOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "https://openrouter.ai/api/v1",
          apiKey: "k",
          maxRetries: 4,
          timeout: 60_000,
          defaultHeaders: expect.objectContaining({
            "HTTP-Referer": "https://example.com",
            "X-Title": "Test",
          }),
        }),
      );
    });

    it("returns content and mapped usage on success", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessCompletion("translated"));

      const client = new OpenRouterClient({ apiKey: "k" });
      const result = await client.complete({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.content).toBe("translated");
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        cachedTokens: 2,
        thinkingTokens: 0,
        totalTokens: 15,
      });
    });

    it("applies temperature default of 0.1 when not provided", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessCompletion());

      const client = new OpenRouterClient({ apiKey: "k" });
      await client.complete({ model: "m", messages: [{ role: "user", content: "hi" }] });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.1 }),
      );
    });

    it("wraps APIError as a plain Error with status info", async () => {
      const { default: MockOpenAI } = await import("openai");
      mockCreate.mockRejectedValueOnce(
        new (MockOpenAI as any).APIError(401, {}, "unauthorized", {}),
      );

      const client = new OpenRouterClient({ apiKey: "k" });
      await expect(
        client.complete({ model: "m", messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toThrow(/401/);
    });

    it("returns empty string when choices array is empty", async () => {
      mockCreate.mockResolvedValueOnce({ choices: [], usage: {} });

      const client = new OpenRouterClient({ apiKey: "k" });
      const result = await client.complete({ model: "m", messages: [{ role: "user", content: "hi" }] });
      expect(result.content).toBe("");
    });

    it("wraps APIConnectionTimeoutError as a plain Error", async () => {
      const { default: MockOpenAI } = await import("openai");
      mockCreate.mockRejectedValueOnce(new (MockOpenAI as any).APIConnectionTimeoutError());

      const client = new OpenRouterClient({ apiKey: "k" });
      await expect(
        client.complete({ model: "m", messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toThrow(/timed out|timeout/i);
    });
  });
  ```

  > Note: The `vi.mock("openai", ...)` factory and `vi.hoisted` call must be placed at the **top of the file** (before the first `describe`), not inside the `describe` block. Vitest hoists `vi.mock` calls regardless of where you write them, but co-locating them at the top prevents confusion. The existing `vi.stubGlobal("fetch", ...)` tests are unaffected because they mock `globalThis.fetch`, not the `openai` module.

- [ ] **Step 2: Run new tests — verify they fail**

  ```bash
  cd packages/cli && pnpm exec vitest run src/commands/llm/openrouterClient.test.ts
  ```
  Expected: `OpenRouterClient` describe block fails with "OpenRouterClient is not defined" or similar. Existing `callOpenRouter` tests still pass.

- [ ] **Step 3: Implement `OpenRouterClient` in `openrouterClient.ts`**

  Add to the **top** of `openrouterClient.ts` (before the existing constants):

  ```typescript
  import OpenAI from "openai";
  ```

  Add the class **before** `callOpenRouter` (which stays for now):

  ```typescript
  export class OpenRouterClient {
    private readonly client: OpenAI;

    constructor(args: {
      apiKey: string;
      siteUrl?: string;
      siteName?: string;
    }) {
      const defaultHeaders: Record<string, string> = {};
      if (args.siteUrl) defaultHeaders["HTTP-Referer"] = args.siteUrl;
      if (args.siteName) defaultHeaders["X-Title"] = args.siteName;

      this.client = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: args.apiKey,
        defaultHeaders,
        maxRetries: 4,
        timeout: 60_000,
      });
    }

    async complete(args: {
      model: string;
      messages: OpenRouterMessage[];
      temperature?: number;
    }): Promise<OpenRouterResponse> {
      let completion: OpenAI.Chat.ChatCompletion;
      try {
        completion = await this.client.chat.completions.create({
          model: args.model,
          messages: args.messages as OpenAI.Chat.ChatCompletionMessageParam[],
          temperature: args.temperature ?? 0.1,
        });
      } catch (err) {
        if (err instanceof OpenAI.APIError) {
          throw new Error(`OpenRouter ${err.status ?? "error"}: ${err.message}`);
        }
        throw err;
      }

      const rawContent = completion.choices[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : "";
      const u = (completion.usage as Record<string, unknown>) ?? {};

      return {
        content,
        usage: {
          promptTokens: (u["prompt_tokens"] as number) ?? 0,
          completionTokens: (u["completion_tokens"] as number) ?? 0,
          cachedTokens: ((u["prompt_tokens_details"] as Record<string, number> | undefined)?.["cached_tokens"]) ?? 0,
          thinkingTokens: ((u["completion_tokens_details"] as Record<string, number> | undefined)?.["reasoning_tokens"]) ?? 0,
          totalTokens: (u["total_tokens"] as number) ?? 0,
        },
      };
    }
  }
  ```

- [ ] **Step 4: Run tests — verify all pass**

  ```bash
  cd packages/cli && pnpm exec vitest run src/commands/llm/openrouterClient.test.ts
  ```
  Expected: all tests pass (both `callOpenRouter` and `OpenRouterClient` describe blocks).

- [ ] **Step 5: Commit**

  ```bash
  git add packages/cli/src/commands/llm/openrouterClient.ts \
          packages/cli/src/commands/llm/openrouterClient.test.ts
  git commit -m "feat(cli): add OpenRouterClient class wrapping openai sdk"
  ```

---

## Task 3: Migrate `llmTranslateBundle.ts` to client injection (TDD)

`llmTranslateBundle.test.ts` also has two non-integration tests that pass `openrouterApiKey` — these must be updated in the same commit as `llmTranslateBundle.ts` so the build stays clean.

**Files:**
- Modify: `packages/cli/src/commands/llm/llmTranslateBundleUnit.test.ts`
- Modify: `packages/cli/src/commands/llm/llmTranslateBundle.ts`
- Modify: `packages/cli/src/commands/llm/llmTranslateBundle.test.ts` (non-integration tests only)

- [ ] **Step 1: Update `llmTranslateBundleUnit.test.ts` to inject a mock client**

  At the top of the file, make these changes:

  **Remove** these lines:
  ```typescript
  vi.mock("./openrouterClient.js");
  import { callOpenRouter } from "./openrouterClient.js";
  ```
  and
  ```typescript
  const API_KEY = "test-key";
  ```

  **Add** this import (alongside the existing `llmTranslateBundle` import):
  ```typescript
  import type { OpenRouterClient } from "./openrouterClient.js";
  ```

  **Add** these two helpers near the top (after `mockUsage`):
  ```typescript
  const mockComplete = vi.fn();
  const mockClient = { complete: mockComplete } as unknown as OpenRouterClient;
  ```

  **In `beforeEach`**, reset `mockComplete`:
  ```typescript
  beforeEach(() => {
    vi.clearAllMocks();
    mockComplete.mockReset();
  });
  ```

  **Throughout the file:**
  - Replace every `openrouterApiKey: API_KEY` with `client: mockClient`
  - Replace every `openrouterApiKey: API_KEY,` → `client: mockClient,` (trailing comma variant)
  - Replace `vi.mocked(callOpenRouter).mockResolvedValueOnce(...)` → `mockComplete.mockResolvedValueOnce(...)`
  - Replace `vi.mocked(callOpenRouter).mockRejectedValueOnce(...)` → `mockComplete.mockRejectedValueOnce(...)`
  - Replace `expect(callOpenRouter).toHaveBeenCalledTimes(n)` → `expect(mockComplete).toHaveBeenCalledTimes(n)`
  - Replace `expect(callOpenRouter).not.toHaveBeenCalled()` → `expect(mockComplete).not.toHaveBeenCalled()`

- [ ] **Step 2: Run unit tests — verify they fail**

  ```bash
  cd packages/cli && pnpm exec vitest run src/commands/llm/llmTranslateBundleUnit.test.ts
  ```
  Expected: TypeScript errors or test failures because `LlmTranslateBundleArgs` still has `openrouterApiKey`, not `client`.

- [ ] **Step 3: Update `llmTranslateBundle.ts`**

  **Update the import** at the top:

  ```typescript
  // Remove this import entirely:
  import {
    callOpenRouter,
    type OpenRouterUsage,
    OPENROUTER_API_KEY_ENV,
    OPENROUTER_SITE_URL_ENV,
    OPENROUTER_SITE_NAME_ENV,
  } from "./openrouterClient.js";

  // Replace with:
  import { type OpenRouterClient, type OpenRouterUsage } from "./openrouterClient.js";
  ```

  **Update `LlmTranslateBundleArgs`:**

  ```typescript
  export type LlmTranslateBundleArgs = {
    bundle: BundleNested;
    sourceLocale: string;
    targetLocales: string[];
    client: OpenRouterClient;   // replaces openrouterApiKey?: string
    model: string;
    context?: string;
    force?: boolean;
    quiet?: boolean;
  };
  ```

  **Update `llmTranslateBundle` function body:**

  Remove lines 65-68:
  ```typescript
  // DELETE these lines:
  const apiKey = args.openrouterApiKey ?? process.env[OPENROUTER_API_KEY_ENV];
  if (!apiKey) {
    return { error: `${OPENROUTER_API_KEY_ENV} is not set` };
  }
  ```

  Replace the `callOpenRouter(...)` call (around line 151) with:
  ```typescript
  response = await args.client.complete({
    model: args.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });
  ```
  (Remove the `apiKey`, `siteUrl`, `siteName` fields — they are baked into the client.)

  **Update `llmTranslateBundles` function body:**

  Remove lines 219-226:
  ```typescript
  // DELETE these lines:
  const apiKey = args.openrouterApiKey ?? process.env[OPENROUTER_API_KEY_ENV];
  if (!apiKey) {
    return {
      results: args.bundles.map(() => ({ error: `${OPENROUTER_API_KEY_ENV} is not set` })),
      usage: emptyUsage(),
    };
  }
  ```

  Replace the `callOpenRouter(...)` call (around line 300) with:
  ```typescript
  response = await args.client.complete({
    model: args.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });
  ```

- [ ] **Step 4: Update non-integration tests in `llmTranslateBundle.test.ts`**

  `llmTranslateBundle.test.ts` has a `describe("llmTranslateBundle (unit)")` block (starts around line 177) with two tests that must be updated now to keep the build clean.

  **Add import** at the top of the file:
  ```typescript
  import { OpenRouterClient } from "./openrouterClient.js";
  ```

  **Skip-path test** (around line 178 — "skips already-translated variants without calling OpenRouter"):
  ```typescript
  // Replace:
  openrouterApiKey: "invalid-key-should-not-be-used",

  // With:
  client: new OpenRouterClient({ apiKey: "invalid-key-should-not-be-used" }),
  ```

  **"No API key" test** (around line 239 — "returns error when no API key is provided"):
  Delete the entire test. It tested a validation that now lives in `llmTranslateCommandAction` (covered in Task 4).

  > The integration tests inside `runIf(...)` (lines ~22-174) also need `client` added — do that in Task 5 together with removing `callOpenRouter`.

- [ ] **Step 5: Run unit tests — verify they pass**

  ```bash
  cd packages/cli && pnpm exec vitest run src/commands/llm/llmTranslateBundleUnit.test.ts
  cd packages/cli && pnpm exec vitest run src/commands/llm/llmTranslateBundle.test.ts
  ```
  Expected: all tests pass.

- [ ] **Step 6: Run full type check**

  ```bash
  cd packages/cli && pnpm exec tsc --noEmit
  ```
  Expected: errors only on `translate.ts` (still passes `openrouterApiKey`). That is expected — fixed in Task 4. Any other errors are bugs to fix now.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/cli/src/commands/llm/llmTranslateBundle.ts \
          packages/cli/src/commands/llm/llmTranslateBundleUnit.test.ts \
          packages/cli/src/commands/llm/llmTranslateBundle.test.ts
  git commit -m "refactor(cli): inject OpenRouterClient into llmTranslateBundle functions"
  ```

---

## Task 4: Migrate `translate.ts` — construct and pass client (TDD)

**Files:**
- Modify: `packages/cli/src/commands/llm/translate.unit.test.ts`
- Modify: `packages/cli/src/commands/llm/translate.ts`

- [ ] **Step 1: Update `translate.unit.test.ts`**

  **Add import** at the top:
  ```typescript
  import { OpenRouterClient, OPENROUTER_API_KEY_ENV } from "./openrouterClient.js";
  ```

  **Update the `"api-key forwarded"` describe block** (around lines 297-335). It has two tests that currently assert `openrouterApiKey` on the `llmTranslateBundles` call args. After Task 4's `translate.ts` change, that field no longer exists. Update both assertions:
  ```typescript
  // Replace (two occurrences in the file):
  expect(vi.mocked(llmTranslateBundles).mock.calls[0]![0].openrouterApiKey).toBe("my-explicit-key");
  // and:
  expect(vi.mocked(llmTranslateBundles).mock.calls[0]![0].openrouterApiKey).toBe("arg-key");

  // With (for both tests):
  expect(vi.mocked(llmTranslateBundles).mock.calls[0]![0].client).toBeInstanceOf(OpenRouterClient);
  ```
  The tests still verify the right behavior (the function reached the llmTranslateBundles call — meaning the key was accepted). The describe block title can optionally be updated to `"api-key accepted"`.

  **Add a new describe block** (e.g., after the "api-key forwarded" block):
  ```typescript
  // ---------------------------------------------------------------------------
  // client construction
  // ---------------------------------------------------------------------------

  describe("llmTranslateCommandAction — client construction", () => {
    it("throws when no API key is provided and env var is not set", async () => {
      const project = await makeProject();
      await insertBundle(project.db, "greet");

      const savedKey = process.env[OPENROUTER_API_KEY_ENV];
      delete process.env[OPENROUTER_API_KEY_ENV];
      try {
        await expect(
          llmTranslateCommandAction({
            project,
            sourceLocale: "en-gb",
            targetLocales: ["nl"],
            model: DEFAULT_MODEL,
            // no apiKey
          }),
        ).rejects.toThrow(OPENROUTER_API_KEY_ENV);
      } finally {
        if (savedKey !== undefined) process.env[OPENROUTER_API_KEY_ENV] = savedKey;
      }
    });

    it("passes an OpenRouterClient instance to llmTranslateBundles", async () => {
      const project = await makeProject();
      await insertBundle(project.db, "greet");
      vi.mocked(llmTranslateBundles).mockResolvedValue({
        results: [makeMockResult("greet")],
        usage: emptyUsage,
      });

      await llmTranslateCommandAction({
        project,
        sourceLocale: "en-gb",
        targetLocales: ["nl"],
        model: DEFAULT_MODEL,
        apiKey: "test-key",
      });

      const passedClient = vi.mocked(llmTranslateBundles).mock.calls[0]![0].client;
      expect(passedClient).toBeInstanceOf(OpenRouterClient);
    });
  });
  ```

- [ ] **Step 2: Run tests — verify the `"passes an OpenRouterClient instance"` test fails**

  ```bash
  cd packages/cli && pnpm exec vitest run src/commands/llm/translate.unit.test.ts
  ```
  Expected: `"passes an OpenRouterClient instance"` fails (currently passes `openrouterApiKey`, not `client`). The `"throws when no API key"` test may already pass.

- [ ] **Step 3: Update `translate.ts`**

  **Update the imports** at the top of `translate.ts`:
  ```typescript
  // Replace:
  import { OPENROUTER_API_KEY_ENV } from "./openrouterClient.js";

  // With:
  import {
    OpenRouterClient,
    OPENROUTER_API_KEY_ENV,
    OPENROUTER_SITE_URL_ENV,
    OPENROUTER_SITE_NAME_ENV,
  } from "./openrouterClient.js";
  ```

  **Update `llmTranslateCommandAction`** — replace the existing `apiKey` resolution block (lines ~155-158) and the `llmTranslateBundles` call (line ~171):

  ```typescript
  // Replace:
  const apiKey = args.apiKey ?? process.env[OPENROUTER_API_KEY_ENV];
  if (!apiKey) {
    throw new Error(`${OPENROUTER_API_KEY_ENV} is required unless --dry-run is used.`);
  }

  // With:
  const apiKey = args.apiKey ?? process.env[OPENROUTER_API_KEY_ENV];
  if (!apiKey) {
    throw new Error(`${OPENROUTER_API_KEY_ENV} is required unless --dry-run is used.`);
  }
  const client = new OpenRouterClient({
    apiKey,
    siteUrl: process.env[OPENROUTER_SITE_URL_ENV],
    siteName: process.env[OPENROUTER_SITE_NAME_ENV],
  });
  ```

  **Update the `llmTranslateBundles` call** (line ~171):
  ```typescript
  // Replace:
  const { results, usage } = await llmTranslateBundles({
    bundles: chunk,
    sourceLocale,
    targetLocales,
    model,
    openrouterApiKey: apiKey,
    context,
    force,
    quiet,
  });

  // With:
  const { results, usage } = await llmTranslateBundles({
    bundles: chunk,
    sourceLocale,
    targetLocales,
    model,
    client,
    context,
    force,
    quiet,
  });
  ```

- [ ] **Step 4: Run tests — verify all pass**

  ```bash
  cd packages/cli && pnpm exec vitest run src/commands/llm/translate.unit.test.ts
  ```
  Expected: all tests pass.

- [ ] **Step 5: Run full type check**

  ```bash
  cd packages/cli && pnpm exec tsc --noEmit
  ```
  Expected: no errors (or only errors in `llmTranslateBundle.test.ts` which is updated in Task 5).

- [ ] **Step 6: Commit**

  ```bash
  git add packages/cli/src/commands/llm/translate.ts \
          packages/cli/src/commands/llm/translate.unit.test.ts
  git commit -m "refactor(cli): construct OpenRouterClient in llmTranslateCommandAction"
  ```

---

## Task 5: Remove `callOpenRouter` and finalize remaining test files

All callers of `callOpenRouter` have been migrated. Now remove it and clean up all remaining references.

**Files:**
- Modify: `packages/cli/src/commands/llm/openrouterClient.ts`
- Modify: `packages/cli/src/commands/llm/openrouterClient.test.ts`
- Modify: `packages/cli/src/commands/llm/llmTranslateBundle.test.ts`

- [ ] **Step 1: Remove `callOpenRouter` from `openrouterClient.ts`**

  Delete everything from `callOpenRouter` through the end of the file:
  - The `callOpenRouter` function (lines ~36-125)
  - The `sleep` helper function (lines ~127-129)
  - The `OPENROUTER_URL`, `MAX_ATTEMPTS`, `BASE_DELAY_MS`, `REQUEST_TIMEOUT_MS` constants (lines 1-4)

  The file should now contain only:
  - The `import OpenAI from "openai"` statement
  - The three exported env var constants
  - The four exported types (`OpenRouterMessage`, `OpenRouterUsage`, `OpenRouterResponse`)
  - The `OpenRouterClient` class

- [ ] **Step 2: Remove old `callOpenRouter` tests from `openrouterClient.test.ts`**

  Delete the entire `describe("callOpenRouter", () => { ... })` block and its associated helpers (`makeResponse`, `makeSuccessBody`, `BASE_ARGS`). Also remove the `vi.stubGlobal` / `vi.unstubAllGlobals` lines that were used for fetch mocking.

  Keep:
  - The `vi.hoisted(...)` + `vi.mock("openai", ...)` block
  - The `describe("OpenRouterClient", ...)` block

- [ ] **Step 3: Finish `llmTranslateBundle.test.ts` — update integration tests**

  The non-integration tests and `OpenRouterClient` import were already handled in Task 3. Here, add `client` to all integration test calls inside `runIf(...)`:

  Each `llmTranslateBundle({ ... })` call inside the integration suite (lines ~22-174) is missing `client`. Add it to every one:
  ```typescript
  client: new OpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY! }),
  ```
  These only run when `process.env.OPENROUTER_API_KEY` is set (`runIf`), so the non-null assertion is safe.

- [ ] **Step 4: Run the full test suite**

  ```bash
  cd packages/cli && pnpm test
  ```
  (`pnpm test` runs `tsc --noEmit && vitest run --coverage --test-timeout=10000`)

  Expected: all tests pass, type check clean. The integration tests in `llmTranslateBundle.test.ts` will be skipped (no real API key in CI).

- [ ] **Step 5: Commit**

  ```bash
  git add packages/cli/src/commands/llm/openrouterClient.ts \
          packages/cli/src/commands/llm/openrouterClient.test.ts \
          packages/cli/src/commands/llm/llmTranslateBundle.test.ts
  git commit -m "refactor(cli): remove callOpenRouter, complete OpenRouter SDK migration"
  ```
