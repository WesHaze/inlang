import path from "node:path";
import os from "node:os";
import fsPromises from "node:fs/promises";
import { test, expect } from "vitest";
import {
  insertBundleNested,
  loadProjectInMemory,
  newProject,
  selectBundleNested,
} from "@inlang/sdk";
import { llmTranslateCommandAction, DEFAULT_MODEL } from "./translate.js";
import { generateFixtureKeys } from "./fixtures.js";
import { OPENROUTER_API_KEY_ENV } from "./openrouterClient.js";

test.runIf(process.env[OPENROUTER_API_KEY_ENV])(
  "llmTranslateCommandAction translates fixture keys end-to-end",
  async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl", "de"] },
      }),
    });

    // Use first 20 fixture keys — these are all simple text patterns (variable/multi-variable fixtures start later in the set)
    const fixtureKeys = generateFixtureKeys().slice(0, 20);
    await Promise.all(fixtureKeys.map((key) => insertBundleNested(project.db, key)));

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl", "de"],
      model: DEFAULT_MODEL,
      batchSize: 20,
    });

    const bundles = await selectBundleNested(project.db).execute();
    expect(bundles.length).toBe(fixtureKeys.length);

    // Verify that at least one bundle has target-locale messages with non-empty patterns
    const hasNlMessage = bundles.some((b) =>
      b.messages.some(
        (m) =>
          m.locale === "nl" &&
          m.variants.some((v) => v.pattern && v.pattern.length > 0),
      ),
    );
    const hasDeMessage = bundles.some((b) =>
      b.messages.some(
        (m) =>
          m.locale === "de" &&
          m.variants.some((v) => v.pattern && v.pattern.length > 0),
      ),
    );
    expect(hasNlMessage).toBe(true);
    expect(hasDeMessage).toBe(true);
  },
  { timeout: 60_000 },
);

// Two bundles used for context-contrast tests
const EXPLANATION_BUNDLE = {
  id: "ctx_explanation",
  messages: [
    {
      id: "ctx_explanation_msg",
      bundleId: "ctx_explanation",
      locale: "en",
      variants: [
        {
          id: "ctx_explanation_var",
          messageId: "ctx_explanation_msg",
          pattern: [
            {
              type: "text" as const,
              value:
                "When an error occurs, the system will automatically retry the operation up to three times and then notify you of the final result so you understand what happened.",
            },
          ],
        },
      ],
    },
  ],
};

const INSTRUCTION_BUNDLE = {
  id: "ctx_instruction",
  messages: [
    {
      id: "ctx_instruction_msg",
      bundleId: "ctx_instruction",
      locale: "en",
      variants: [
        {
          id: "ctx_instruction_var",
          messageId: "ctx_instruction_msg",
          pattern: [
            {
              type: "text" as const,
              value: "Click the button to save your changes before leaving the page.",
            },
          ],
        },
      ],
    },
  ],
};

const KINDERGARTEN_CONTEXT = `
You are translating for a kindergarten teacher's app.
Use very simple, warm, friendly, and encouraging language.
Add gentle, nurturing phrasing. Use "Let's" and "You can" constructions.
Speak as if explaining to a 5-year-old — simple words, short sentences, lots of warmth.
`.trim();

const DRILL_INSTRUCTOR_CONTEXT = `
You are translating for a military drill instructor's app.
Use terse, commanding, no-nonsense language.
Omit pleasantries. Use imperative voice. Be blunt and direct.
Short sentences. No fluff. Bark orders, don't explain.
`.trim();

/** Extract the first text node value for a given bundle/locale from a query result. */
function getTranslatedText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bundles: any[],
  bundleId: string,
  locale: string,
): string {
  const bundle = bundles.find((b: { id: string }) => b.id === bundleId);
  const msg = bundle?.messages.find((m: { locale: string }) => m.locale === locale);
  const node = msg?.variants[0]?.pattern.find((n: { type: string }) => n.type === "text");
  return node && "value" in node ? String(node.value) : "";
}

test.runIf(process.env[OPENROUTER_API_KEY_ENV])(
  "llmTranslateCommandAction: kindergarten vs drill-instructor inline context produces different translations",
  async () => {
    const project1 = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en", locales: ["en", "de"] },
      }),
    });
    await insertBundleNested(project1.db, EXPLANATION_BUNDLE);
    await insertBundleNested(project1.db, INSTRUCTION_BUNDLE);
    await llmTranslateCommandAction({
      project: project1,
      sourceLocale: "en",
      targetLocales: ["de"],
      model: DEFAULT_MODEL,
      context: KINDERGARTEN_CONTEXT,
      batchSize: 5,
    });

    const project2 = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en", locales: ["en", "de"] },
      }),
    });
    await insertBundleNested(project2.db, EXPLANATION_BUNDLE);
    await insertBundleNested(project2.db, INSTRUCTION_BUNDLE);
    await llmTranslateCommandAction({
      project: project2,
      sourceLocale: "en",
      targetLocales: ["de"],
      model: DEFAULT_MODEL,
      context: DRILL_INSTRUCTOR_CONTEXT,
      batchSize: 5,
    });

    const bundles1 = await selectBundleNested(project1.db).execute();
    const bundles2 = await selectBundleNested(project2.db).execute();

    const explanation1 = getTranslatedText(bundles1, "ctx_explanation", "de");
    const explanation2 = getTranslatedText(bundles2, "ctx_explanation", "de");
    const instruction1 = getTranslatedText(bundles1, "ctx_instruction", "de");
    const instruction2 = getTranslatedText(bundles2, "ctx_instruction", "de");

    // Both contexts must produce non-empty translations
    expect(explanation1).not.toBe("");
    expect(explanation2).not.toBe("");
    expect(instruction1).not.toBe("");
    expect(instruction2).not.toBe("");

    // Opposite contexts must produce different output for at least one bundle
    const explanationsDiffer = explanation1 !== explanation2;
    const instructionsDiffer = instruction1 !== instruction2;
    expect(explanationsDiffer || instructionsDiffer).toBe(true);
  },
  { timeout: 120_000 },
);

test.runIf(process.env[OPENROUTER_API_KEY_ENV])(
  "llmTranslateCommandAction: context-file (drill instructor) produces different translations than context (kindergarten)",
  async () => {
    // Write drill instructor context to a temp file, then read it back — this
    // exercises the same path as --context-file in the Commander action handler.
    const tempFile = path.join(os.tmpdir(), `drill-context-${Date.now()}.md`);
    await fsPromises.writeFile(tempFile, DRILL_INSTRUCTOR_CONTEXT, "utf8");
    const fileContext = await fsPromises.readFile(tempFile, "utf8");
    await fsPromises.unlink(tempFile);

    const project1 = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en", locales: ["en", "de"] },
      }),
    });
    await insertBundleNested(project1.db, EXPLANATION_BUNDLE);
    await insertBundleNested(project1.db, INSTRUCTION_BUNDLE);
    await llmTranslateCommandAction({
      project: project1,
      sourceLocale: "en",
      targetLocales: ["de"],
      model: DEFAULT_MODEL,
      context: KINDERGARTEN_CONTEXT,
      batchSize: 5,
    });

    const project2 = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en", locales: ["en", "de"] },
      }),
    });
    await insertBundleNested(project2.db, EXPLANATION_BUNDLE);
    await insertBundleNested(project2.db, INSTRUCTION_BUNDLE);
    await llmTranslateCommandAction({
      project: project2,
      sourceLocale: "en",
      targetLocales: ["de"],
      model: DEFAULT_MODEL,
      context: fileContext, // loaded from temp file — same as --context-file
      batchSize: 5,
    });

    const bundles1 = await selectBundleNested(project1.db).execute();
    const bundles2 = await selectBundleNested(project2.db).execute();

    const explanation1 = getTranslatedText(bundles1, "ctx_explanation", "de");
    const explanation2 = getTranslatedText(bundles2, "ctx_explanation", "de");
    const instruction1 = getTranslatedText(bundles1, "ctx_instruction", "de");
    const instruction2 = getTranslatedText(bundles2, "ctx_instruction", "de");

    // Both must produce non-empty translations
    expect(explanation1).not.toBe("");
    expect(explanation2).not.toBe("");
    expect(instruction1).not.toBe("");
    expect(instruction2).not.toBe("");

    // Context loaded from file must produce different output than inline kindergarten context
    const explanationsDiffer = explanation1 !== explanation2;
    const instructionsDiffer = instruction1 !== instruction2;
    expect(explanationsDiffer || instructionsDiffer).toBe(true);
  },
  { timeout: 120_000 },
);

test.runIf(process.env[OPENROUTER_API_KEY_ENV])(
  "llmTranslateCommandAction: --force replaces a stale existing translation",
  async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en", locales: ["en", "de"] },
      }),
    });

    // Pre-seed a German translation with an obviously wrong placeholder value.
    await insertBundleNested(project.db, {
      id: "force_test",
      messages: [
        {
          id: "force_test_en", bundleId: "force_test", locale: "en",
          variants: [{ id: "force_test_en_v", messageId: "force_test_en", pattern: [{ type: "text" as const, value: "Save changes" }] }],
        },
        {
          id: "force_test_de", bundleId: "force_test", locale: "de",
          variants: [{ id: "force_test_de_v", messageId: "force_test_de", pattern: [{ type: "text" as const, value: "PLACEHOLDER_DO_NOT_KEEP" }] }],
        },
      ],
    });

    // Without --force the placeholder must be left untouched.
    await llmTranslateCommandAction({
      project,
      sourceLocale: "en",
      targetLocales: ["de"],
      model: DEFAULT_MODEL,
      force: false,
    });

    const bundlesAfterNoForce = await selectBundleNested(project.db).execute();
    const deAfterNoForce = getTranslatedText(bundlesAfterNoForce, "force_test", "de");
    expect(deAfterNoForce).toBe("PLACEHOLDER_DO_NOT_KEEP");

    // With --force the placeholder must be replaced by a real translation.
    await llmTranslateCommandAction({
      project,
      sourceLocale: "en",
      targetLocales: ["de"],
      model: DEFAULT_MODEL,
      force: true,
    });

    const bundlesAfterForce = await selectBundleNested(project.db).execute();
    const deAfterForce = getTranslatedText(bundlesAfterForce, "force_test", "de");
    expect(deAfterForce).not.toBe("");
    expect(deAfterForce).not.toBe("PLACEHOLDER_DO_NOT_KEEP");
  },
  { timeout: 60_000 },
);

test.runIf(process.env[OPENROUTER_API_KEY_ENV])(
  "llmTranslateCommandAction: without --force, completed locales are skipped and missing locales are translated",
  async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en", locales: ["en", "de", "fr"] },
      }),
    });

    // de is already translated; fr is missing.
    await insertBundleNested(project.db, {
      id: "mixed_complete",
      messages: [
        {
          id: "mixed_complete_en", bundleId: "mixed_complete", locale: "en",
          variants: [{ id: "mixed_complete_en_v", messageId: "mixed_complete_en", pattern: [{ type: "text" as const, value: "Confirm your booking" }] }],
        },
        {
          id: "mixed_complete_de", bundleId: "mixed_complete", locale: "de",
          variants: [{ id: "mixed_complete_de_v", messageId: "mixed_complete_de", pattern: [{ type: "text" as const, value: "EXISTING_DE_KEEP_ME" }] }],
        },
      ],
    });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en",
      targetLocales: ["de", "fr"],
      model: DEFAULT_MODEL,
      force: false,
    });

    const bundles = await selectBundleNested(project.db).execute();
    const deResult = getTranslatedText(bundles, "mixed_complete", "de");
    const frResult = getTranslatedText(bundles, "mixed_complete", "fr");

    // Existing de translation must not be touched.
    expect(deResult).toBe("EXISTING_DE_KEEP_ME");
    // Missing fr translation must now be filled.
    expect(frResult).not.toBe("");
  },
  { timeout: 60_000 },
);
