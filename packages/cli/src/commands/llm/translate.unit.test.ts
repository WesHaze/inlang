/**
 * Unit tests for llmTranslateCommandAction.
 * llmTranslateBundles is mocked — no real API calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  insertBundleNested,
  loadProjectInMemory,
  newProject,
} from "@inlang/sdk";
import { llmTranslateCommandAction, DEFAULT_MODEL } from "./translate.js";

vi.mock("./llmTranslateBundle.js");
import { llmTranslateBundles } from "./llmTranslateBundle.js";

const emptyUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, thinkingTokens: 0, totalTokens: 0 };

async function makeProject(locales = ["en-gb", "nl"]) {
  return loadProjectInMemory({
    blob: await newProject({ settings: { baseLocale: locales[0]!, locales } }),
  });
}

async function insertBundle(db: any, id: string, value = "Hello") {
  await insertBundleNested(db, {
    id,
    messages: [
      {
        id: `${id}_en`,
        bundleId: id,
        locale: "en-gb",
        variants: [{ id: `${id}_en_v`, messageId: `${id}_en`, pattern: [{ type: "text", value }] }],
      },
    ],
  });
}

function makeMockResult(bundleId: string) {
  return {
    data: {
      id: bundleId,
      messages: [
        { id: `${bundleId}_en`, bundleId, locale: "en-gb", variants: [] },
        { id: `${bundleId}_nl`, bundleId, locale: "nl", variants: [{ id: `${bundleId}_nl_v`, messageId: `${bundleId}_nl`, pattern: [{ type: "text" as const, value: "Vertaald" }] }] },
      ],
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [], usage: emptyUsage });
});

// ---------------------------------------------------------------------------
// dry-run
// ---------------------------------------------------------------------------

describe("llmTranslateCommandAction — dry-run", () => {
  it("does not call llmTranslateBundles when dryRun=true", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "greet");

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: DEFAULT_MODEL,
      dryRun: true,
    });

    expect(llmTranslateBundles).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// empty bundle list
// ---------------------------------------------------------------------------

describe("llmTranslateCommandAction — empty project", () => {
  it("returns without calling llmTranslateBundles when there are no bundles", async () => {
    const project = await makeProject();
    // No bundles inserted

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: DEFAULT_MODEL,
    });

    expect(llmTranslateBundles).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// --force forwarded
// ---------------------------------------------------------------------------

describe("llmTranslateCommandAction — force flag", () => {
  it("passes force=true to llmTranslateBundles", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "greet");

    vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [makeMockResult("greet")], usage: emptyUsage });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: DEFAULT_MODEL,
      force: true,
    });

    expect(vi.mocked(llmTranslateBundles).mock.calls[0]![0].force).toBe(true);
  });

  it("passes force=false (default) to llmTranslateBundles", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "greet");

    vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [makeMockResult("greet")], usage: emptyUsage });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: DEFAULT_MODEL,
    });

    expect(vi.mocked(llmTranslateBundles).mock.calls[0]![0].force).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// --context forwarded
// ---------------------------------------------------------------------------

describe("llmTranslateCommandAction — context forwarded", () => {
  it("passes context string to llmTranslateBundles", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "greet");

    vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [makeMockResult("greet")], usage: emptyUsage });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: DEFAULT_MODEL,
      context: "Formal B2B tone",
    });

    expect(vi.mocked(llmTranslateBundles).mock.calls[0]![0].context).toBe("Formal B2B tone");
  });

  it("passes undefined context when not provided", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "greet");

    vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [makeMockResult("greet")], usage: emptyUsage });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: DEFAULT_MODEL,
    });

    expect(vi.mocked(llmTranslateBundles).mock.calls[0]![0].context).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// --model forwarded
// ---------------------------------------------------------------------------

describe("llmTranslateCommandAction — model forwarded", () => {
  it("passes the model string to llmTranslateBundles", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "greet");

    vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [makeMockResult("greet")], usage: emptyUsage });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: "anthropic/claude-3.5-haiku",
    });

    expect(vi.mocked(llmTranslateBundles).mock.calls[0]![0].model).toBe("anthropic/claude-3.5-haiku");
  });
});

// ---------------------------------------------------------------------------
// --source-locale / source locale in target list
// ---------------------------------------------------------------------------

describe("llmTranslateCommandAction — source locale in target list", () => {
  it("still calls llmTranslateBundles (filtering happens inside); bundle count is correct", async () => {
    const project = await makeProject(["en-gb", "nl"]);
    await insertBundle(project.db, "greet");

    vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [makeMockResult("greet")], usage: emptyUsage });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["en-gb", "nl"], // source appears in targets
      model: DEFAULT_MODEL,
    });

    // The action still calls translate — the skip happens inside llmTranslateBundles
    expect(llmTranslateBundles).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(llmTranslateBundles).mock.calls[0]![0];
    expect(callArg.targetLocales).toContain("en-gb");
  });
});

// ---------------------------------------------------------------------------
// OPENROUTER_API_KEY missing outside dry-run
// ---------------------------------------------------------------------------

describe("llmTranslateCommandAction — missing API key", () => {
  it("throws when OPENROUTER_API_KEY is not set and dryRun=false", async () => {
    const project = await makeProject();
    const savedKey = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.OPENROUTER_API_KEY;
      await expect(
        llmTranslateCommandAction({
          project,
          sourceLocale: "en-gb",
          targetLocales: ["nl"],
          model: DEFAULT_MODEL,
        }),
      ).rejects.toThrow(/OPENROUTER_API_KEY/);
    } finally {
      process.env.OPENROUTER_API_KEY = savedKey;
    }
  });

  it("does not throw when dryRun=true and OPENROUTER_API_KEY is missing", async () => {
    const project = await makeProject();
    const savedKey = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.OPENROUTER_API_KEY;
      await expect(
        llmTranslateCommandAction({
          project,
          sourceLocale: "en-gb",
          targetLocales: ["nl"],
          model: DEFAULT_MODEL,
          dryRun: true,
        }),
      ).resolves.not.toThrow();
    } finally {
      process.env.OPENROUTER_API_KEY = savedKey;
    }
  });

  it("does not throw when apiKey arg is provided and OPENROUTER_API_KEY env var is absent", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "greet");
    vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [makeMockResult("greet")], usage: emptyUsage });

    const savedKey = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.OPENROUTER_API_KEY;
      await expect(
        llmTranslateCommandAction({
          project,
          sourceLocale: "en-gb",
          targetLocales: ["nl"],
          model: DEFAULT_MODEL,
          apiKey: "explicit-key",
        }),
      ).resolves.not.toThrow();
    } finally {
      process.env.OPENROUTER_API_KEY = savedKey;
    }
  });
});

// ---------------------------------------------------------------------------
// --api-key forwarded
// ---------------------------------------------------------------------------

describe("llmTranslateCommandAction — api-key forwarded", () => {
  it("passes apiKey arg to llmTranslateBundles as openrouterApiKey", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "greet");
    vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [makeMockResult("greet")], usage: emptyUsage });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: DEFAULT_MODEL,
      apiKey: "my-explicit-key",
    });

    expect(vi.mocked(llmTranslateBundles).mock.calls[0]![0].openrouterApiKey).toBe("my-explicit-key");
  });

  it("apiKey arg takes precedence over OPENROUTER_API_KEY env var", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "greet");
    vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [makeMockResult("greet")], usage: emptyUsage });

    const savedKey = process.env.OPENROUTER_API_KEY;
    try {
      process.env.OPENROUTER_API_KEY = "env-key";
      await llmTranslateCommandAction({
        project,
        sourceLocale: "en-gb",
        targetLocales: ["nl"],
        model: DEFAULT_MODEL,
        apiKey: "arg-key",
      });
    } finally {
      process.env.OPENROUTER_API_KEY = savedKey;
    }

    expect(vi.mocked(llmTranslateBundles).mock.calls[0]![0].openrouterApiKey).toBe("arg-key");
  });
});

// ---------------------------------------------------------------------------
// batch-size chunking
// ---------------------------------------------------------------------------

describe("llmTranslateCommandAction — batch-size chunking", () => {
  it("calls llmTranslateBundles once per chunk", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "a");
    await insertBundle(project.db, "b");
    await insertBundle(project.db, "c");

    vi.mocked(llmTranslateBundles)
      .mockResolvedValueOnce({ results: [makeMockResult("a"), makeMockResult("b")], usage: emptyUsage })
      .mockResolvedValueOnce({ results: [makeMockResult("c")], usage: emptyUsage });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: DEFAULT_MODEL,
      batchSize: 2, // 3 bundles → 2 chunks
    });

    expect(llmTranslateBundles).toHaveBeenCalledTimes(2);
    expect(vi.mocked(llmTranslateBundles).mock.calls[0]![0].bundles).toHaveLength(2);
    expect(vi.mocked(llmTranslateBundles).mock.calls[1]![0].bundles).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// targetLocales normalization
// ---------------------------------------------------------------------------

describe("llmTranslateCommandAction — targetLocales normalization", () => {
  it("trims whitespace and drops empty entries before dispatching", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "greet");

    vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [makeMockResult("greet")], usage: emptyUsage });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: [" nl", "", " ", "nl"],
      model: DEFAULT_MODEL,
    });

    const dispatched = vi.mocked(llmTranslateBundles).mock.calls[0]![0].targetLocales;
    expect(dispatched).toEqual(["nl", "nl"]);
  });

  it("drops a trailing empty string produced by a trailing comma", async () => {
    const project = await makeProject();
    await insertBundle(project.db, "greet");

    vi.mocked(llmTranslateBundles).mockResolvedValue({ results: [makeMockResult("greet")], usage: emptyUsage });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl", ""],
      model: DEFAULT_MODEL,
    });

    const dispatched = vi.mocked(llmTranslateBundles).mock.calls[0]![0].targetLocales;
    expect(dispatched).toEqual(["nl"]);
  });
});
