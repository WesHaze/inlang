/**
 * Unit tests for llmTranslateBundle and llmTranslateBundles.
 * OpenRouterClient is mocked — no real API calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  insertBundleNested,
  loadProjectInMemory,
  newProject,
  selectBundleNested,
  type NewMessageNested,
  type NewVariant,
} from "@inlang/sdk";
import { llmTranslateBundle, llmTranslateBundles } from "./llmTranslateBundle.js";
import type { OpenRouterClient } from "./openrouterClient.js";

const mockComplete = vi.fn();
const mockClient = { complete: mockComplete } as unknown as OpenRouterClient;

beforeEach(() => {
  vi.clearAllMocks();
  mockComplete.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUsage = {
  promptTokens: 10,
  completionTokens: 5,
  cachedTokens: 0,
  thinkingTokens: 0,
  totalTokens: 15,
};

function mockOk(content: string) {
  return { content, usage: mockUsage };
}

const MODEL = "openai/gpt-4o-mini";

async function makeProject(locales: string[] = ["en-gb", "nl"]) {
  return loadProjectInMemory({
    blob: await newProject({
      settings: { baseLocale: locales[0]!, locales },
    }),
  });
}

async function insertSimpleBundle(
  db: Awaited<ReturnType<typeof makeProject>>["db"],
  id: string,
  enValue: string,
  nlValue?: string,
) {
  await insertBundleNested(db, {
    id,
    messages: [
      {
        id: `${id}_en`,
        bundleId: id,
        locale: "en-gb",
        variants: [{ id: `${id}_en_v`, messageId: `${id}_en`, pattern: [{ type: "text" as const, value: enValue }] }],
      },
      ...(nlValue !== undefined
        ? [{
            id: `${id}_nl`,
            bundleId: id,
            locale: "nl",
            variants: [{ id: `${id}_nl_v`, messageId: `${id}_nl`, pattern: [{ type: "text" as const, value: nlValue }] }],
          }]
        : []),
    ],
  });
}

// ---------------------------------------------------------------------------
// llmTranslateBundle — source locale not found
// ---------------------------------------------------------------------------

describe("llmTranslateBundle — source locale not found", () => {
  it("returns error when source locale is absent from the bundle", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "fr", // not in bundle
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(result.error).toMatch(/Source locale "fr" not found/);
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundle — source locale in target list is skipped
// ---------------------------------------------------------------------------

describe("llmTranslateBundle — source locale in target list", () => {
  it("skips the source locale when it appears in targetLocales", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    // Only en-gb in targets — nothing to translate, no API call
    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["en-gb"],
      client: mockClient,
      model: MODEL,
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("translates only non-source locales when source is mixed into targets", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    mockComplete.mockResolvedValueOnce(
      mockOk(JSON.stringify({ nl: [{ type: "text", value: "Hallo" }] })),
    );

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["en-gb", "nl"], // en-gb should be filtered out
      client: mockClient,
      model: MODEL,
    });

    expect(result.error).toBeUndefined();
    const nlMsg = result.data!.messages.find((m: NewMessageNested) => m.locale === "nl");
    expect(nlMsg).toBeDefined();
    // en-gb should not appear twice
    const enMsgs = result.data!.messages.filter((m: NewMessageNested) => m.locale === "en-gb");
    expect(enMsgs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundle — bundle with zero source variants
// ---------------------------------------------------------------------------

describe("llmTranslateBundle — zero source variants", () => {
  it("returns early without API call when source message has no variants", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertBundleNested(project.db, {
      id: "empty",
      messages: [{ id: "empty_en", bundleId: "empty", locale: "en-gb", variants: [] }],
    });
    const [bundle] = await selectBundleNested(project.db).execute();

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(mockComplete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundle — partial pre-existing translations
// ---------------------------------------------------------------------------

describe("llmTranslateBundle — partial pre-existing translations", () => {
  it("only translates locales that are missing, skips already-translated ones", async () => {
    const project = await makeProject(["en-gb", "nl", "de"]);
    // nl already has a translation; de does not
    await insertBundleNested(project.db, {
      id: "partial",
      messages: [
        {
          id: "partial_en",
          bundleId: "partial",
          locale: "en-gb",
          variants: [{ id: "partial_en_v", messageId: "partial_en", pattern: [{ type: "text", value: "Save" }] }],
        },
        {
          id: "partial_nl",
          bundleId: "partial",
          locale: "nl",
          variants: [{ id: "partial_nl_v", messageId: "partial_nl", pattern: [{ type: "text", value: "Opslaan" }] }],
        },
      ],
    });
    const [bundle] = await selectBundleNested(project.db).execute();

    mockComplete.mockResolvedValueOnce(
      mockOk(JSON.stringify({ de: [{ type: "text", value: "Speichern" }] })),
    );

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl", "de"],
      client: mockClient,
      model: MODEL,
    });

    expect(result.error).toBeUndefined();

    // nl should still be "Opslaan" (untouched)
    const nl = result.data!.messages.find((m: NewMessageNested) => m.locale === "nl");
    expect((nl!.variants[0] as NewVariant).pattern![0]).toMatchObject({ type: "text", value: "Opslaan" });

    // de should be "Speichern" (newly translated)
    const de = result.data!.messages.find((m: NewMessageNested) => m.locale === "de");
    expect((de!.variants[0] as NewVariant).pattern![0]).toMatchObject({ type: "text", value: "Speichern" });

    // API was called with only "de", not "nl"
    const callArgs = mockComplete.mock.calls[0]!;
    expect(callArgs[0].messages[1]!.content).toContain('"de"');
    expect(callArgs[0].messages[1]!.content).not.toContain('"nl":[...pattern...]');
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundle — force=true overwrites existing translations
// ---------------------------------------------------------------------------

describe("llmTranslateBundle — force flag", () => {
  it("force=true re-translates an already-complete bundle", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "save", "Save", "Opslaan");
    const [bundle] = await selectBundleNested(project.db).execute();

    mockComplete.mockResolvedValueOnce(
      mockOk(JSON.stringify({ nl: [{ type: "text", value: "Bewaren" }] })),
    );

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
      force: true,
    });

    expect(mockComplete).toHaveBeenCalledTimes(1);
    const nl = result.data!.messages.find((m: NewMessageNested) => m.locale === "nl");
    expect((nl!.variants[0] as NewVariant).pattern![0]).toMatchObject({ type: "text", value: "Bewaren" });
  });

  it("force=false skips already-translated locale (no API call)", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "save", "Save", "Opslaan");
    const [bundle] = await selectBundleNested(project.db).execute();

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
      force: false,
    });

    expect(mockComplete).not.toHaveBeenCalled();
    const nl = result.data!.messages.find((m: NewMessageNested) => m.locale === "nl");
    expect((nl!.variants[0] as NewVariant).pattern![0]).toMatchObject({ type: "text", value: "Opslaan" });
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundle — context forwarded into prompt
// ---------------------------------------------------------------------------

describe("llmTranslateBundle — context forwarded", () => {
  it("includes context string in the LLM user message", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    mockComplete.mockResolvedValueOnce(
      mockOk(JSON.stringify({ nl: [{ type: "text", value: "Hallo" }] })),
    );

    await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
      context: "Formal tone, B2B SaaS product",
    });

    const userMessage = mockComplete.mock.calls[0]![0].messages[1]!.content;
    expect(userMessage).toContain("Formal tone, B2B SaaS product");
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundle — model forwarded to client.complete
// ---------------------------------------------------------------------------

describe("llmTranslateBundle — model propagation", () => {
  it("passes the model argument through to client.complete", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    mockComplete.mockResolvedValueOnce(
      mockOk(JSON.stringify({ nl: [{ type: "text", value: "Hallo" }] })),
    );

    await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: "anthropic/claude-3.5-haiku",
    });

    expect(mockComplete.mock.calls[0]![0].model).toBe("anthropic/claude-3.5-haiku");
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundle — retry logic
// ---------------------------------------------------------------------------

describe("llmTranslateBundle — retry on invalid JSON", () => {
  it("retries when LLM returns invalid JSON and succeeds on second attempt", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    mockComplete
      .mockResolvedValueOnce(mockOk("not valid json"))
      .mockResolvedValueOnce(mockOk(JSON.stringify({ nl: [{ type: "text", value: "Hallo" }] })));

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(result.error).toBeUndefined();
    const nl = result.data!.messages.find((m: NewMessageNested) => m.locale === "nl");
    expect(nl).toBeDefined();
  });
});

describe("llmTranslateBundle — retry on non-object response", () => {
  it("retries when LLM returns a bare array and succeeds on second attempt", async () => {
    const project = await makeProject(["en-gb", "nl", "de"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    mockComplete
      .mockResolvedValueOnce(mockOk("[1, 2, 3]")) // bare array — wrong structure, shape guard fires for multi-locale
      .mockResolvedValueOnce(mockOk(JSON.stringify({ nl: [{ type: "text", value: "Hallo" }], de: [{ type: "text", value: "Hallo" }] })));

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl", "de"],
      client: mockClient,
      model: MODEL,
    });

    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(result.data!.messages.find((m: NewMessageNested) => m.locale === "nl")).toBeDefined();
    expect(result.data!.messages.find((m: NewMessageNested) => m.locale === "de")).toBeDefined();
  });
});

describe("llmTranslateBundle — retry on validation failure", () => {
  it("retries the locale when validation fails on first attempt", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    mockComplete
      // First attempt: nl pattern has wrong length
      .mockResolvedValueOnce(mockOk(JSON.stringify({ nl: [{ type: "text", value: "Hallo" }, { type: "text", value: "extra" }] })))
      // Second attempt: correct
      .mockResolvedValueOnce(mockOk(JSON.stringify({ nl: [{ type: "text", value: "Hallo" }] })));

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(mockComplete).toHaveBeenCalledTimes(2);
    const nl = result.data!.messages.find((m: NewMessageNested) => m.locale === "nl");
    expect(nl).toBeDefined();
  });
});

describe("llmTranslateBundle — connection error on last retry returns error", () => {
  it("returns { error } after all retries exhausted with connection errors", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    mockComplete.mockRejectedValue(new Error("connection refused"));

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(mockComplete).toHaveBeenCalledTimes(1); // OpenRouterClient handles transport retries; throws propagate immediately
    expect(result.error).toMatch(/connection refused/);
  });
});

describe("llmTranslateBundle — usage accumulation across retries", () => {
  it("accumulates usage from all attempts including structurally failed ones", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    const usage1 = { promptTokens: 10, completionTokens: 3, cachedTokens: 0, thinkingTokens: 0, totalTokens: 13 };
    const usage2 = { promptTokens: 8, completionTokens: 4, cachedTokens: 0, thinkingTokens: 0, totalTokens: 12 };

    mockComplete
      .mockResolvedValueOnce({ content: "not json", usage: usage1 }) // parse fails, usage still counted
      .mockResolvedValueOnce({ content: JSON.stringify({ nl: [{ type: "text", value: "Hallo" }] }), usage: usage2 });

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(result.usage!.totalTokens).toBe(usage1.totalTokens + usage2.totalTokens);
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundle — multiple source variants
// ---------------------------------------------------------------------------

describe("llmTranslateBundle — multiple source variants", () => {
  it("translates each variant in a separate API call", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertBundleNested(project.db, {
      id: "plural",
      messages: [
        {
          id: "plural_en",
          bundleId: "plural",
          locale: "en-gb",
          variants: [
            {
              id: "plural_en_one",
              messageId: "plural_en",
              matches: [{ type: "literal-match", key: "count", value: "one" }],
              pattern: [{ type: "text", value: "1 item" }],
            },
            {
              id: "plural_en_other",
              messageId: "plural_en",
              matches: [{ type: "literal-match", key: "count", value: "other" }],
              pattern: [{ type: "text", value: "{count} items" }],
            },
          ],
        },
      ],
    });
    const [bundle] = await selectBundleNested(project.db).execute();

    mockComplete
      .mockResolvedValueOnce(mockOk(JSON.stringify({ nl: [{ type: "text", value: "1 item" }] })))
      .mockResolvedValueOnce(mockOk(JSON.stringify({ nl: [{ type: "text", value: "{count} items" }] })));

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(mockComplete).toHaveBeenCalledTimes(2);
    const nl = result.data!.messages.find((m: NewMessageNested) => m.locale === "nl");
    expect(nl!.variants).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundle — fenced JSON response
// ---------------------------------------------------------------------------

describe("llmTranslateBundle — fenced JSON response", () => {
  it("succeeds without retrying when LLM wraps response in markdown fences", async () => {
    const project = await makeProject();
    await insertSimpleBundle(project.db, "greet", "hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    const pattern = JSON.stringify([{ type: "text", value: "hallo" }]);
    mockComplete.mockResolvedValueOnce(
      mockOk(`\`\`\`json\n{"nl":${pattern}}\n\`\`\``),
    );

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: MODEL,
      client: mockClient,
    });

    expect(result.error).toBeUndefined();
    expect(result.translated).toBe(true);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundle — bare-array normalization (single locale)
// ---------------------------------------------------------------------------

describe("llmTranslateBundle — bare-array normalization", () => {
  it("succeeds when LLM returns a bare array for a single target locale", async () => {
    const project = await makeProject();
    await insertSimpleBundle(project.db, "greet", "hello");
    const [bundle] = await selectBundleNested(project.db).execute();

    const pattern = [{ type: "text", value: "hallo" }];
    // LLM returns just the pattern array, not wrapped in {"nl":[...]}
    mockComplete.mockResolvedValueOnce(mockOk(JSON.stringify(pattern)));

    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: MODEL,
      client: mockClient,
    });

    expect(result.error).toBeUndefined();
    expect(result.translated).toBe(true);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const nl = result.data!.messages.find((m: NewMessageNested) => m.locale === "nl");
    expect(nl?.variants[0]?.pattern).toEqual([{ type: "text", value: "hallo" }]);
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundles — batch path
// ---------------------------------------------------------------------------

describe("llmTranslateBundles — happy path", () => {
  it("translates multiple bundles in a single API call", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "a", "Hello");
    await insertSimpleBundle(project.db, "b", "Save");
    const bundles = await selectBundleNested(project.db).execute();

    // The batch call uses a key-based format; we need to return entries for all workMap keys
    mockComplete.mockResolvedValueOnce(
      mockOk(
        JSON.stringify(
          Object.fromEntries(
            bundles.map((b) => [
              `${b.id}::${b.messages[0]!.variants[0]!.id}`,
              { nl: [{ type: "text", value: b.id === "a" ? "Hallo" : "Opslaan" }] },
            ]),
          ),
        ),
      ),
    );

    const result = await llmTranslateBundles({
      bundles,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.error).toBeUndefined();
    expect(result.results[1]!.error).toBeUndefined();
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
});

describe("llmTranslateBundles — all bundles already translated", () => {
  it("returns early without API call when nothing needs translating", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "done", "Save", "Opslaan");
    const bundles = await selectBundleNested(project.db).execute();

    const result = await llmTranslateBundles({
      bundles,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(mockComplete).not.toHaveBeenCalled();
    expect(result.results[0]!.data).toBeDefined();
    expect(result.results[0]!.error).toBeUndefined();
  });
});

describe("llmTranslateBundles — empty bundle list", () => {
  it("returns empty results without API call", async () => {
    const result = await llmTranslateBundles({
      bundles: [],
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(mockComplete).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(0);
    expect(result.usage.totalTokens).toBe(0);
  });
});

describe("llmTranslateBundles — JSON parse failure returns errors (not silent success)", () => {
  it("returns error results when LLM response cannot be parsed after all retries", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const bundles = await selectBundleNested(project.db).execute();

    mockComplete.mockResolvedValue(mockOk("not valid json"));

    const result = await llmTranslateBundles({
      bundles,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(mockComplete).toHaveBeenCalledTimes(3); // MAX_RETRIES
    expect(result.results[0]!.error).toBeDefined();
    expect(result.results[0]!.error).toMatch(/parse/i);
  });
});

describe("llmTranslateBundles — API error propagates to all results", () => {
  it("returns error for every bundle when client.complete throws", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "a", "Hello");
    await insertSimpleBundle(project.db, "b", "Save");
    const bundles = await selectBundleNested(project.db).execute();

    mockComplete.mockRejectedValue(new Error("API down"));

    const result = await llmTranslateBundles({
      bundles,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.error).toMatch(/API down/);
    expect(result.results[1]!.error).toMatch(/API down/);
  });
});

describe("llmTranslateBundles — retries on transient failures", () => {
  it("retries on bad JSON and succeeds on second attempt", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const bundles = await selectBundleNested(project.db).execute();
    const key = `${bundles[0]!.id}::${bundles[0]!.messages[0]!.variants[0]!.id}`;

    mockComplete
      .mockResolvedValueOnce(mockOk("not json"))
      .mockResolvedValueOnce(mockOk(JSON.stringify({ [key]: { nl: [{ type: "text", value: "Hallo" }] } })));

    const result = await llmTranslateBundles({
      bundles,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(result.results[0]!.error).toBeUndefined();
  });
});

describe("llmTranslateBundles — usage accumulated across retries", () => {
  it("sums usage from all attempts including failed ones", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "Hello");
    const bundles = await selectBundleNested(project.db).execute();
    const key = `${bundles[0]!.id}::${bundles[0]!.messages[0]!.variants[0]!.id}`;

    const badUsage = { promptTokens: 5, completionTokens: 1, cachedTokens: 0, thinkingTokens: 0, totalTokens: 6 };
    const goodUsage = { promptTokens: 8, completionTokens: 3, cachedTokens: 0, thinkingTokens: 0, totalTokens: 11 };

    mockComplete
      .mockResolvedValueOnce({ content: "bad json", usage: badUsage })
      .mockResolvedValueOnce({ content: JSON.stringify({ [key]: { nl: [{ type: "text", value: "Hallo" }] } }), usage: goodUsage });

    const result = await llmTranslateBundles({
      bundles,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(result.usage.totalTokens).toBe(badUsage.totalTokens + goodUsage.totalTokens);
  });
});

describe("llmTranslateBundles — bundle with missing source locale returns error", () => {
  it("returns error for a bundle whose source locale is absent and still translates others", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "good", "Hello");
    const bundles = await selectBundleNested(project.db).execute();
    // Inject a bundle with no en-gb message directly
    const noSource = {
      id: "no-source",
      messages: [{ id: "no-source_nl", bundleId: "no-source", locale: "nl", variants: [] }],
    };
    const mixedBundles = [...bundles, noSource as any];
    const key = `${bundles[0]!.id}::${bundles[0]!.messages[0]!.variants[0]!.id}`;

    mockComplete.mockResolvedValueOnce(
      mockOk(JSON.stringify({ [key]: { nl: [{ type: "text", value: "Hallo" }] } })),
    );

    const result = await llmTranslateBundles({
      bundles: mixedBundles,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(result.results).toHaveLength(2);
    // good bundle translated successfully
    expect(result.results[0]!.error).toBeUndefined();
    expect(result.results[0]!.data).toBeDefined();
    // no-source bundle returns an error, not a silent success
    expect(result.results[1]!.error).toMatch(/Source locale "en-gb" not found/);
    expect(result.results[1]!.data).toBeUndefined();
  });
});

describe("llmTranslateBundles — all bundles missing source locale (mistyped --locale)", () => {
  it("returns errors for all bundles without making an API call", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "a", "Hello");
    await insertSimpleBundle(project.db, "b", "Save");
    const bundles = await selectBundleNested(project.db).execute();

    const result = await llmTranslateBundles({
      bundles,
      sourceLocale: "fr", // mistyped — not in any bundle
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(mockComplete).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.error).toMatch(/Source locale "fr" not found/);
    expect(result.results[1]!.error).toMatch(/Source locale "fr" not found/);
  });
});

// ---------------------------------------------------------------------------
// llmTranslateBundles — bare-array single-locale fallback
// ---------------------------------------------------------------------------

describe("llmTranslateBundles — bare-array single-locale fallback", () => {
  it("succeeds when LLM returns a bare array instead of {key:{locale:[...]}} for a single target locale", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertSimpleBundle(project.db, "greet", "hello");
    const bundles = await selectBundleNested(project.db).execute();
    const variantId = bundles[0]!.messages[0]!.variants[0]!.id;
    const key = `greet::${variantId}`;

    // LLM returns { key: [...] } — bare array as the value instead of { key: { nl: [...] } }
    mockComplete.mockResolvedValueOnce(
      mockOk(JSON.stringify({ [key]: [{ type: "text", value: "hallo" }] })),
    );

    const result = await llmTranslateBundles({
      bundles,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      client: mockClient,
      model: MODEL,
    });

    expect(result.results[0]!.error).toBeUndefined();
    expect(result.results[0]!.translated).toBe(true);
    const nl = result.results[0]!.data!.messages.find((m: NewMessageNested) => m.locale === "nl");
    expect(nl?.variants[0]?.pattern).toEqual([{ type: "text", value: "hallo" }]);
  });
});
