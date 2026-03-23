import { OpenRouter } from "@openrouter/sdk";

export const OPENROUTER_API_KEY_ENV = "INLANG_OPENROUTER_API_KEY";
export const OPENROUTER_SITE_URL_ENV = "INLANG_OPENROUTER_SITE_URL";
export const OPENROUTER_SITE_NAME_ENV = "INLANG_OPENROUTER_SITE_NAME";

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

export class OpenRouterClient {
  /** Exposed for testing (verify which key was used to construct the client). */
  readonly apiKey: string;
  private readonly client: OpenRouter;

  constructor(args: {
    apiKey: string;
    siteUrl?: string;
    siteName?: string;
  }) {
    this.apiKey = args.apiKey;

    this.client = new OpenRouter({
      apiKey: args.apiKey,
      httpReferer: args.siteUrl,
      xTitle: args.siteName,
      retryConfig: { strategy: "backoff", backoff: { initialInterval: 500, maxInterval: 8000, exponent: 2, maxElapsedTime: 60_000 }, retryConnectionErrors: true },
      timeoutMs: 60_000,
    });
  }

  async complete(args: {
    model: string;
    messages: OpenRouterMessage[];
    temperature?: number;
  }): Promise<OpenRouterResponse> {
    let result: Awaited<ReturnType<typeof this.client.chat.send>>;
    try {
      result = await this.client.chat.send({
        chatGenerationParams: {
          model: args.model,
          messages: args.messages as Parameters<typeof this.client.chat.send>[0]["chatGenerationParams"]["messages"],
          temperature: args.temperature ?? 0.1,
          stream: false,
        },
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new Error(
        `OpenRouter ${status ?? "error"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const rawContent = result.choices[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : "";
    const u = result.usage;

    return {
      content,
      usage: {
        promptTokens: u?.promptTokens ?? 0,
        completionTokens: u?.completionTokens ?? 0,
        cachedTokens: u?.promptTokensDetails?.cachedTokens ?? 0,
        thinkingTokens: u?.completionTokensDetails?.reasoningTokens ?? 0,
        totalTokens: u?.totalTokens ?? 0,
      },
    };
  }
}
