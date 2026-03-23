import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
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
import { OpenRouterClient, OPENROUTER_API_KEY_ENV } from "./openrouterClient.js";
import { generateFixtureKeys } from "./fixtures.js";
import { DEFAULT_MODEL } from "./translate.js";

// These tests require a real OpenRouter API key.
// They will be skipped unless INLANG_OPENROUTER_API_KEY is set.
const runIf = process.env[OPENROUTER_API_KEY_ENV]
  ? describe
  : describe.skip;

runIf("llmTranslateBundle (integration)", () => {
  const integrationClient = new OpenRouterClient({ apiKey: process.env[OPENROUTER_API_KEY_ENV]! });

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
      client: integrationClient,
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
      allFixtures.find((k) => k.id?.startsWith("simple"))!,           // plain text
      allFixtures.find((k) => k.id?.startsWith("single_var"))!,       // single variable
      allFixtures.find((k) => k.id?.startsWith("multi_var"))!,        // multi-variable
      allFixtures.find((k) => k.id?.startsWith("markup"))!,           // markup nodes
      allFixtures.find((k) => k.id?.startsWith("long"))!,             // long string
      allFixtures.find((k) => k.id?.startsWith("edge_var_start"))!,   // edge: var at start
      allFixtures.find((k) => k.id?.startsWith("edge_markup_var"))!,  // edge: markup + var
      allFixtures.find((k) => k.id?.startsWith("emoji_before_var"))!, // emoji before variable
      allFixtures.find((k) => k.id?.startsWith("emoji_after_var"))!,  // emoji after variable
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
          client: integrationClient,
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
  }, 90_000);

  it("EDGE: preserves emoji in text nodes adjacent to expression nodes", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en", locales: ["en", "de", "fr"] },
      }),
    });

    // Three emoji-placement shapes: emoji before var, emoji after var, emoji sandwiching var
    const emojiCases = [
      {
        id: "emoji_before_var",
        pattern: [
          { type: "text" as const, value: "🎉 " },
          { type: "expression" as const, arg: { type: "variable-reference" as const, name: "name" } },
          { type: "text" as const, value: " joined the team!" },
        ],
      },
      {
        id: "emoji_after_var",
        pattern: [
          { type: "text" as const, value: "You have " },
          { type: "expression" as const, arg: { type: "variable-reference" as const, name: "count" } },
          { type: "text" as const, value: " new messages ✉️" },
        ],
      },
      {
        id: "emoji_sandwich_var",
        pattern: [
          { type: "text" as const, value: "🔥 " },
          { type: "expression" as const, arg: { type: "variable-reference" as const, name: "name" } },
          { type: "text" as const, value: " 🚀" },
        ],
      },
    ];

    for (const { id, pattern } of emojiCases) {
      await insertBundleNested(project.db, {
        id,
        messages: [{ id: `${id}_msg`, bundleId: id, locale: "en", variants: [{ id: `${id}_var`, messageId: `${id}_msg`, pattern }] }],
      });
    }

    const bundles = await selectBundleNested(project.db).execute();
    const extractEmoji = (s: string) =>
      [...s.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]!);

    for (const bundle of bundles) {
      const result = await llmTranslateBundle({
        bundle,
        sourceLocale: "en",
        targetLocales: ["de", "fr"],
        client: integrationClient,
        model: DEFAULT_MODEL,
      });
      expect(result.error, `${bundle.id}: unexpected error`).toBeUndefined();

      const srcPattern = bundle.messages.find((m) => m.locale === "en")!.variants[0]!.pattern ?? [];
      for (const locale of ["de", "fr"]) {
        const msg = result.data!.messages.find((m: NewMessageNested) => m.locale === locale);
        const tgtPattern = (msg!.variants[0] as NewVariant | undefined)?.pattern ?? [];
        expect(tgtPattern, `${bundle.id}/${locale}: node count changed`).toHaveLength(srcPattern.length);

        srcPattern.forEach((srcNode, i) => {
          const tgtNode = tgtPattern[i]!;
          if (srcNode.type === "expression") {
            expect(tgtNode, `${bundle.id}/${locale}[${i}]: expression node mutated`).toEqual(srcNode);
          }
          if (srcNode.type === "text" && "value" in srcNode) {
            const srcEmoji = extractEmoji(srcNode.value);
            if (srcEmoji.length > 0) {
              expect(tgtNode.type, `${bundle.id}/${locale}[${i}]: text node type changed`).toBe("text");
              const tgtValue = "value" in tgtNode ? String(tgtNode.value) : "";
              for (const emoji of srcEmoji) {
                expect(tgtValue, `${bundle.id}/${locale}[${i}]: emoji '${emoji}' was dropped`).toContain(emoji);
              }
            }
          }
        });
      }
    }
  }, 60_000);

  it("EDGE: adjacent variables with single-space separator are preserved in order", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en", locales: ["en", "de", "ja"] },
      }),
    });

    // {firstName} {lastName} — the space is meaningful and the order must not be
    // swapped even in languages where family name conventionally comes first (e.g. Japanese).
    await insertBundleNested(project.db, {
      id: "adjacent_vars",
      messages: [{
        id: "adjacent_vars_msg", bundleId: "adjacent_vars", locale: "en",
        variants: [{
          id: "adjacent_vars_var", messageId: "adjacent_vars_msg",
          pattern: [
            { type: "expression", arg: { type: "variable-reference", name: "firstName" } },
            { type: "text", value: " " },
            { type: "expression", arg: { type: "variable-reference", name: "lastName" } },
          ],
        }],
      }],
    });

    const [bundle] = await selectBundleNested(project.db).execute();
    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en",
      targetLocales: ["de", "ja"],
      client: integrationClient,
      model: DEFAULT_MODEL,
    });

    expect(result.error).toBeUndefined();

    const srcPattern = bundle!.messages[0]!.variants[0]!.pattern;
    for (const locale of ["de", "ja"]) {
      const msg = result.data!.messages.find((m: NewMessageNested) => m.locale === locale);
      const tgtPattern = (msg!.variants[0] as NewVariant | undefined)?.pattern ?? [];
      expect(tgtPattern, `${locale}: node count changed`).toHaveLength(srcPattern.length);
      // Expression nodes must be identical and in original order
      expect(tgtPattern[0], `${locale}: firstName node changed`).toEqual(srcPattern[0]);
      expect(tgtPattern[2], `${locale}: lastName node changed`).toEqual(srcPattern[2]);
      // Space separator must survive (may be adjusted to locale convention, but must be non-empty)
      expect(tgtPattern[1]?.type, `${locale}: separator node type changed`).toBe("text");
    }
  }, 30_000);

  it("EDGE: variable-only pattern is returned unchanged (no text to translate)", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en", locales: ["en", "de", "ja"] },
      }),
    });

    await insertBundleNested(project.db, {
      id: "var_only",
      messages: [{
        id: "var_only_msg", bundleId: "var_only", locale: "en",
        variants: [{
          id: "var_only_var", messageId: "var_only_msg",
          pattern: [
            { type: "expression", arg: { type: "variable-reference", name: "count" } },
          ],
        }],
      }],
    });

    const [bundle] = await selectBundleNested(project.db).execute();
    const result = await llmTranslateBundle({
      bundle: bundle!,
      sourceLocale: "en",
      targetLocales: ["de", "ja"],
      client: integrationClient,
      model: DEFAULT_MODEL,
    });

    expect(result.error).toBeUndefined();

    for (const locale of ["de", "ja"]) {
      const msg = result.data!.messages.find((m: NewMessageNested) => m.locale === locale);
      expect(msg, `missing ${locale} message`).toBeDefined();
      const tgtPattern = (msg!.variants[0] as NewVariant | undefined)?.pattern ?? [];
      expect(tgtPattern, `${locale}: pattern length changed`).toHaveLength(1);
      expect(tgtPattern[0], `${locale}: expression node mutated`).toEqual({
        type: "expression",
        arg: { type: "variable-reference", name: "count" },
      });
    }
  }, 30_000);

  it("RTL: Arabic translation produces Arabic script and preserves variables", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en", locales: ["en", "ar"] },
      }),
    });

    await insertBundleNested(project.db, {
      id: "rtl_plain",
      messages: [{
        id: "rtl_plain_msg", bundleId: "rtl_plain", locale: "en",
        variants: [{ id: "rtl_plain_var", messageId: "rtl_plain_msg", pattern: [{ type: "text" as const, value: "Save your changes before leaving." }] }],
      }],
    });

    await insertBundleNested(project.db, {
      id: "rtl_with_var",
      messages: [{
        id: "rtl_with_var_msg", bundleId: "rtl_with_var", locale: "en",
        variants: [{
          id: "rtl_with_var_v", messageId: "rtl_with_var_msg",
          pattern: [
            { type: "text" as const, value: "Hello " },
            { type: "expression" as const, arg: { type: "variable-reference" as const, name: "name" } },
            { type: "text" as const, value: ", your account is ready." },
          ],
        }],
      }],
    });

    const bundles = await selectBundleNested(project.db).execute();
    const arabicScript = /[\u0600-\u06FF]/;

    for (const bundle of bundles) {
      const result = await llmTranslateBundle({
        bundle,
        sourceLocale: "en",
        targetLocales: ["ar"],
        client: integrationClient,
        model: DEFAULT_MODEL,
      });
      expect(result.error, `${bundle.id}: unexpected error`).toBeUndefined();

      const msg = result.data!.messages.find((m: NewMessageNested) => m.locale === "ar");
      expect(msg, `${bundle.id}: missing ar message`).toBeDefined();
      const tgtPattern = (msg!.variants[0] as NewVariant | undefined)?.pattern ?? [];

      // At least one text node must contain Arabic script characters.
      const hasArabic = tgtPattern.some(
        (n) => n.type === "text" && "value" in n && arabicScript.test(String(n.value)),
      );
      expect(hasArabic, `${bundle.id}: no Arabic script found in translated pattern`).toBe(true);

      // Expression nodes must be preserved unchanged.
      const srcPattern = bundle.messages[0]!.variants[0]!.pattern ?? [];
      srcPattern.forEach((srcNode, i) => {
        if (srcNode.type === "expression") {
          expect(tgtPattern[i], `${bundle.id}/ar[${i}]: expression node mutated`).toEqual(srcNode);
        }
      });
    }
  }, 30_000);

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
      client: integrationClient,
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
  // Use a mock client that throws if called — the skip path must return before any API call.
  const neverCalledClient = { complete: vi.fn().mockRejectedValue(new Error("API must not be called on the skip path")) } as unknown as OpenRouterClient;
  const result = await llmTranslateBundle({
    bundle: bundle!,
    sourceLocale: "en-gb",
    targetLocales: ["nl"],
    client: neverCalledClient,
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


}); // llmTranslateBundle (unit)
