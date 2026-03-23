import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callOpenRouter, OpenRouterClient } from "./openrouterClient.js";

const mockSend = vi.hoisted(() => vi.fn());

vi.mock("@openrouter/sdk", () => {
  class MockOpenRouter {
    chat = { send: mockSend };
  }
  return { OpenRouter: MockOpenRouter };
});

const BASE_ARGS = {
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user" as const, content: "hello" }],
  apiKey: "test-key",
};

function makeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = { "Content-Type": "application/json" },
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function makeSuccessBody(content = "ok") {
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

describe("callOpenRouter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns content and mapped usage on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, makeSuccessBody("translated")));

    const result = await callOpenRouter(BASE_ARGS);

    expect(result.content).toBe("translated");
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      cachedTokens: 2,
      thinkingTokens: 0,
      totalTokens: 15,
    });
  });

  it("retries on HTTP 429 and succeeds on second attempt", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(429, { error: { message: "rate limited" } }))
      .mockResolvedValueOnce(makeResponse(200, makeSuccessBody("ok")));

    const result = await callOpenRouter(BASE_ARGS);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.content).toBe("ok");
  });

  it("retries on HTTP 500 and succeeds on second attempt", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(500, { error: { message: "server error" } }))
      .mockResolvedValueOnce(makeResponse(200, makeSuccessBody()));

    await callOpenRouter(BASE_ARGS);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws immediately on non-retryable 4xx (400)", async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(400, { error: { message: "bad request" } }));

    await expect(callOpenRouter(BASE_ARGS)).rejects.toThrow("bad request");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on 401 without retry", async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(401, { error: { message: "unauthorized" } }));

    await expect(callOpenRouter(BASE_ARGS)).rejects.toThrow(/401/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on 404 without retry", async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(404, { error: { message: "model not found" } }));

    await expect(callOpenRouter(BASE_ARGS)).rejects.toThrow(/model not found/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on network error (fetch throws) and succeeds on next attempt", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(makeResponse(200, makeSuccessBody()));

    const result = await callOpenRouter(BASE_ARGS);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.content).toBe("ok");
  });

  it("retries on AbortError (timeout) and uses correct error message", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    vi.mocked(fetch)
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(makeResponse(200, makeSuccessBody()));

    await callOpenRouter(BASE_ARGS);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws after all MAX_ATTEMPTS (5) are exhausted on 429", async () => {
    // Use mockImplementation (not mockResolvedValue) so each call gets a fresh
    // Response whose body hasn't been consumed yet.
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(makeResponse(429, { error: { message: "still rate limited" } })),
    );

    await expect(callOpenRouter(BASE_ARGS)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(5);
  }, 15_000); // backoff: ~500 + 1000 + 2000 + 4000 ms ≈ 7.5 s

  it("throws after all MAX_ATTEMPTS exhausted on persistent network error", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("connection refused"));

    await expect(callOpenRouter(BASE_ARGS)).rejects.toThrow("connection refused");
    expect(fetch).toHaveBeenCalledTimes(5);
  }, 15_000); // backoff: ~500 + 1000 + 2000 + 4000 ms ≈ 7.5 s

  it("returns empty content string when choices[0] is missing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse(200, { choices: [], usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 } }),
    );

    const result = await callOpenRouter(BASE_ARGS);
    expect(result.content).toBe("");
  });

  it("returns all-zero usage when usage field is missing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse(200, { choices: [{ message: { content: "hi" } }] }),
    );

    const result = await callOpenRouter(BASE_ARGS);
    expect(result.usage.promptTokens).toBe(0);
    expect(result.usage.totalTokens).toBe(0);
  });

  it("throws with descriptive message on non-JSON response body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("not json at all", { status: 200, headers: { "Content-Type": "text/plain" } }),
    );

    await expect(callOpenRouter(BASE_ARGS)).rejects.toThrow(/non-JSON/);
  });

  it("uses the model, apiKey, and messages from args", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(200, makeSuccessBody()));

    await callOpenRouter({ ...BASE_ARGS, model: "anthropic/claude-3.5-haiku", apiKey: "my-key" });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("anthropic/claude-3.5-haiku");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer my-key");
  });
});

describe("OpenRouterClient", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  function makeSuccessResult(content = "ok") {
    return {
      choices: [{ message: { content, role: "assistant" } }],
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        promptTokensDetails: { cachedTokens: 2 },
        completionTokensDetails: { reasoningTokens: 0 },
      },
    };
  }

  it("returns content and mapped usage on success", async () => {
    mockSend.mockResolvedValueOnce(makeSuccessResult("translated"));

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
    mockSend.mockResolvedValueOnce(makeSuccessResult());

    const client = new OpenRouterClient({ apiKey: "k" });
    await client.complete({ model: "m", messages: [{ role: "user", content: "hi" }] });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        chatGenerationParams: expect.objectContaining({ temperature: 0.1 }),
      }),
    );
  });

  it("wraps SDK errors as plain Error with status info", async () => {
    mockSend.mockRejectedValueOnce({ status: 401, message: "unauthorized" });

    const client = new OpenRouterClient({ apiKey: "k" });
    await expect(
      client.complete({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/401/);
  });

  it("returns empty string when choices array is empty", async () => {
    mockSend.mockResolvedValueOnce({ choices: [], usage: {} });

    const client = new OpenRouterClient({ apiKey: "k" });
    const result = await client.complete({ model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("");
  });

  it("wraps timeout error (status 408) as plain Error", async () => {
    mockSend.mockRejectedValueOnce({ status: 408, message: "Request Timeout" });

    const client = new OpenRouterClient({ apiKey: "k" });
    await expect(
      client.complete({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/408|timeout/i);
  });
});
