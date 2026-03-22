import { describe, expect, it, afterEach, beforeEach } from "vitest";
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
import { generateFixtureKeys } from "./fixtures.js";
import { DEFAULT_MODEL } from "./translate.js";

// These tests require a real OpenRouter API key.
// They will be skipped unless OPENROUTER_API_KEY is set.
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
      model: DEFAULT_MODEL,
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

  it("translates a representative sample of fixture keys (simple, variable, markup, edge)", async () => {
    const allFixtures = generateFixtureKeys();
    // Pick one from each category in the fixture set
    const sample = [
      allFixtures.find((k) => k.id?.startsWith("simple"))!,       // plain text
      allFixtures.find((k) => k.id?.startsWith("single_var"))!,   // single variable
      allFixtures.find((k) => k.id?.startsWith("multi_var"))!,    // multi-variable
      allFixtures.find((k) => k.id?.startsWith("markup"))!,       // markup nodes
      allFixtures.find((k) => k.id?.startsWith("long"))!,         // long string
      allFixtures.find((k) => k.id?.startsWith("edge_var_start"))!, // edge: var at start
      allFixtures.find((k) => k.id?.startsWith("edge_markup_var"))!, // edge: markup + var
    ];

    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl", "de"] },
      }),
    });

    await Promise.all(sample.map((key) => insertBundleNested(project.db, key)));
    const bundles = await selectBundleNested(project.db).execute();

    await Promise.all(
      bundles.map(async (bundle) => {
        const result = await llmTranslateBundle({
          bundle,
          sourceLocale: "en-gb",
          targetLocales: ["nl", "de"],
          model: DEFAULT_MODEL,
        });

        expect(result.error).toBeUndefined();
        expect(result.data).toBeDefined();

        const srcPattern = bundle.messages.find((m) => m.locale === "en-gb")!.variants[0]!.pattern ?? [];
        for (const locale of ["nl", "de"]) {
          const msg = result.data!.messages.find((m: NewMessageNested) => m.locale === locale);
          expect(msg, `missing ${locale} message for ${bundle.id}`).toBeDefined();
          const tgtPattern = (msg!.variants[0] as NewVariant | undefined)?.pattern ?? [];
          expect(tgtPattern).toHaveLength(srcPattern.length);
          // Verify node types are preserved (non-text nodes must not become text nodes)
          srcPattern.forEach((srcNode, i) => {
            expect(tgtPattern[i]!.type, `${locale}[${i}]: node type changed`).toBe(srcNode.type);
          });
        }
      }),
    );
  }, 60_000);

  it("EDGE: preserves expression nodes (variables) in translated pattern", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl", "fr", "de"] },
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
      targetLocales: ["nl", "fr", "de"],
      model: DEFAULT_MODEL,
    });

    expect(result.error).toBeUndefined();

    for (const locale of ["nl", "fr", "de"]) {
      const msg = result.data!.messages.find((m: NewMessageNested) => m.locale === locale);
      expect(msg, `missing ${locale} message`).toBeDefined();
      const pattern = (msg!.variants[0] as NewVariant | undefined)?.pattern ?? [];
      const expressionNode = pattern.find((n: Pattern[number]) => n.type === "expression");
      expect(expressionNode, `${locale}: expression node missing`).toEqual({
        type: "expression",
        arg: { type: "variable-reference", name: "name" },
      });
    }
  }, 45_000);

});

describe("llmTranslateBundle (unit)", () => {
it("skips already-translated variants without calling OpenRouter", async () => {
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
  // Pass a deliberately invalid key — if the function called OpenRouter it would get a 401 error.
  // The skip path must return { data } before any API call is attempted.
  const result = await llmTranslateBundle({
    bundle: bundle!,
    sourceLocale: "en-gb",
    targetLocales: ["nl"],
    openrouterApiKey: "invalid-key-should-not-be-used",
    model: DEFAULT_MODEL,
  });

  // Function should return { data } with no error — skip path runs before any API call
  expect(result.error).toBeUndefined();
  expect(result.data).toBeDefined();
  const nlMessage = result.data!.messages.find(
    (m: NewMessageNested) => m.locale === "nl",
  );
  const variant = nlMessage!.variants[0] as NewVariant | undefined;
  const nlPattern = variant!.pattern ?? [];
  expect(
    (nlPattern[0] as { type: "text"; value: string }).value,
  ).toBe("Opslaan");
});

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
  try {
    delete process.env.OPENROUTER_API_KEY;
    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      openrouterApiKey: undefined,
      model: DEFAULT_MODEL,
    });
    expect(result.error).toMatch(/OPENROUTER_API_KEY/);
  } finally {
    process.env.OPENROUTER_API_KEY = savedKey;
  }
});

}); // llmTranslateBundle (unit)
