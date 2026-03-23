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

    // Use first 20 fixture keys — covers simple, variable, and multi-variable patterns
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
