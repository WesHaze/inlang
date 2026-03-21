import { describe, expect, it } from "vitest";
import {
  insertBundleNested,
  loadProjectInMemory,
  newProject,
  selectBundleNested,
  type NewMessageNested,
  type NewVariant,
  type Pattern,
} from "@inlang/sdk";
import { llmTranslateBundle } from "./llmTranslateBundle.js";

// These tests require a real OpenRouter API key.
// They will be skipped in CI unless OPENROUTER_API_KEY is set.
const runIf = process.env.OPENROUTER_API_KEY
  ? describe
  : describe.skip;

runIf("llmTranslateBundle (integration)", () => {
  it("translates a simple text bundle from en-gb to nl", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl"] },
      }),
    });

    await insertBundleNested(project.db, {
      id: "greeting",
      messages: [
        {
          id: "greeting_en",
          bundleId: "greeting",
          locale: "en-gb",
          variants: [
            {
              id: "greeting_en_v",
              messageId: "greeting_en",
              pattern: [{ type: "text", value: "Hello World" }],
            },
          ],
        },
      ],
    });

    const [bundle] = await selectBundleNested(project.db).execute();
    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: "openai/gpt-4o-mini",
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.usage).toBeDefined();
    expect(result.usage!.totalTokens).toBeGreaterThan(0);

    const nlMessage = result.data!.messages.find(
      (m: NewMessageNested) => m.locale === "nl",
    );
    expect(nlMessage).toBeDefined();
    expect(nlMessage!.variants).toHaveLength(1);
    const variant = nlMessage!.variants[0] as NewVariant | undefined;
    const pattern = variant!.pattern ?? [];
    expect(pattern).toHaveLength(1);
    expect(pattern[0]!.type).toBe("text");
    expect((pattern[0] as { type: "text"; value: string }).value).not.toBe("");
  }, 20_000);

  it("EDGE: preserves expression nodes (variables) in translated pattern", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl"] },
      }),
    });

    await insertBundleNested(project.db, {
      id: "welcome",
      messages: [
        {
          id: "welcome_en",
          bundleId: "welcome",
          locale: "en-gb",
          variants: [
            {
              id: "welcome_en_v",
              messageId: "welcome_en",
              pattern: [
                { type: "text", value: "Hello " },
                {
                  type: "expression",
                  arg: { type: "variable-reference", name: "name" },
                },
                { type: "text", value: ", welcome back!" },
              ],
            },
          ],
        },
      ],
    });

    const [bundle] = await selectBundleNested(project.db).execute();
    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: "openai/gpt-4o-mini",
    });

    expect(result.error).toBeUndefined();
    const nlMessage = result.data!.messages.find(
      (m: NewMessageNested) => m.locale === "nl",
    );
    const variant = nlMessage!.variants[0] as NewVariant | undefined;
    const pattern = variant!.pattern ?? [];

    // Expression node must be preserved exactly
    const expressionNode = pattern.find(
      (n: Pattern[number]) => n.type === "expression",
    );
    expect(expressionNode).toEqual({
      type: "expression",
      arg: { type: "variable-reference", name: "name" },
    });
  }, 20_000);

  it("skips already-translated variants unless force is true", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl"] },
      }),
    });

    await insertBundleNested(project.db, {
      id: "existing",
      messages: [
        {
          id: "existing_en",
          bundleId: "existing",
          locale: "en-gb",
          variants: [
            {
              id: "existing_en_v",
              messageId: "existing_en",
              pattern: [{ type: "text", value: "Save" }],
            },
          ],
        },
        {
          id: "existing_nl",
          bundleId: "existing",
          locale: "nl",
          variants: [
            {
              id: "existing_nl_v",
              messageId: "existing_nl",
              pattern: [{ type: "text", value: "Opslaan" }],
            },
          ],
        },
      ],
    });

    const [bundle] = await selectBundleNested(project.db).execute();
    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: "openai/gpt-4o-mini",
    });

    // Should return data (unchanged bundle) without calling OpenRouter
    expect(result.data).toBeDefined();
    // The nl variant should still be "Opslaan" (not re-translated)
    const nlMessage = result.data!.messages.find(
      (m: NewMessageNested) => m.locale === "nl",
    );
    const variant = nlMessage!.variants[0] as NewVariant | undefined;
    const nlPattern = variant!.pattern ?? [];
    expect(
      (nlPattern[0] as { type: "text"; value: string }).value,
    ).toBe("Opslaan");
  }, 5_000);

});

// Unit test — runs unconditionally, no API key required
it("returns error when no API key is provided", async () => {
  const project = await loadProjectInMemory({
    blob: await newProject({
      settings: { baseLocale: "en-gb", locales: ["en-gb", "nl"] },
    }),
  });

  await insertBundleNested(project.db, {
    id: "test",
    messages: [
      {
        id: "test_en",
        bundleId: "test",
        locale: "en-gb",
        variants: [
          {
            id: "test_en_v",
            messageId: "test_en",
            pattern: [{ type: "text", value: "Test" }],
          },
        ],
      },
    ],
  });

  const [bundle] = await selectBundleNested(project.db).execute();
  const savedKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const result = await llmTranslateBundle({
    bundle: bundle!,
    sourceLocale: "en-gb",
    targetLocales: ["nl"],
    openrouterApiKey: undefined,
    model: "openai/gpt-4o-mini",
  });

  process.env.OPENROUTER_API_KEY = savedKey;
  expect(result.error).toMatch(/OPENROUTER_API_KEY/);
});
