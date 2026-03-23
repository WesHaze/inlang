import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenRouterClient } from "./openrouterClient.js";

const mockSend = vi.hoisted(() => vi.fn());

vi.mock("@openrouter/sdk", () => {
  class MockOpenRouter {
    chat = { send: mockSend };
  }
  return { OpenRouter: MockOpenRouter };
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
