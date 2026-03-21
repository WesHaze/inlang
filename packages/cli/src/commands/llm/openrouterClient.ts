const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;

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
    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, { method: "POST", headers, body });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200);
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const text = await response.text();
      lastError = new Error(`OpenRouter HTTP ${response.status}: ${text}`);
      const isTransient = response.status === 429 || response.status >= 500;
      if (isTransient && attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200);
        continue;
      }
      throw lastError;
    }

    const data = await response.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const u = data?.usage ?? {};

    const usage: OpenRouterUsage = {
      promptTokens: u.prompt_tokens ?? 0,
      completionTokens: u.completion_tokens ?? 0,
      cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
      thinkingTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: u.total_tokens ?? 0,
    };

    return { content, usage };
  }

  throw lastError ?? new Error("OpenRouter request failed after all attempts");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
