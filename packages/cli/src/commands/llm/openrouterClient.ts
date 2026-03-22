const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 60_000;

export type OpenRouterMessage = {
  role: "system" | "user";
  content: string;
};

export type OpenRouterUsage = {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;    // prompt_tokens_details.cached_tokens ?? 0
  thinkingTokens: number;  // completion_tokens_details.reasoning_tokens ?? 0
  totalTokens: number;
};

export type OpenRouterResponse = {
  content: string;
  usage: OpenRouterUsage;
};

/**
 * Calls the OpenRouter chat completions endpoint with exponential backoff
 * retry on transient errors (HTTP 429, 5xx).
 *
 * Required env vars used by callers:
 *   OPENROUTER_SITE_URL  → HTTP-Referer header
 *   OPENROUTER_SITE_NAME → X-Title header
 */
export async function callOpenRouter(args: {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  apiKey: string;
  siteUrl?: string;
  siteName?: string;
}): Promise<OpenRouterResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.apiKey}`,
    "Content-Type": "application/json",
  };
  if (args.siteUrl) headers["HTTP-Referer"] = args.siteUrl;
  if (args.siteName) headers["X-Title"] = args.siteName;

  const body = JSON.stringify({
    model: args.model,
    messages: args.messages,
    temperature: args.temperature ?? 0.1,
  });

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, { method: "POST", headers, body, signal: controller.signal });
    } catch (err) {
      clearTimeout(timeoutId);
      const isAbort = err instanceof Error && err.name === "AbortError";
      lastError = isAbort
        ? new Error(`OpenRouter request timed out after ${REQUEST_TIMEOUT_MS}ms (attempt ${attempt}/${MAX_ATTEMPTS})`)
        : err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200);
        continue;
      }
      throw lastError;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      // Try to extract a human-readable message from the JSON error body
      let message = text;
      try {
        const errBody = JSON.parse(text) as Record<string, unknown>;
        const inner = errBody["error"] as Record<string, unknown> | undefined;
        if (typeof inner?.["message"] === "string") message = inner["message"];
      } catch { /* use raw text */ }
      lastError = new Error(`OpenRouter HTTP ${response.status}: ${message}`);
      const isTransient = response.status === 429 || response.status >= 500;
      if (isTransient && attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200);
        continue;
      }
      throw lastError;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      throw new Error(
        `OpenRouter returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const d = data as Record<string, unknown>;
    const rawContent = (d?.["choices"] as any)?.[0]?.message?.content;
    const content: string = typeof rawContent === "string" ? rawContent : "";
    const u = (d?.["usage"] as any) ?? {};

    const usage: OpenRouterUsage = {
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
      cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
      thinkingTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: u.total_tokens ?? 0,
    };

    return { content, usage };
  }

  // Fallback: unreachable in normal operation but guards against future logic changes
  // where the inline throws above might be removed. Keeps the return type Promise<OpenRouterResponse>.
  throw lastError ?? new Error("OpenRouter request failed after all attempts");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
