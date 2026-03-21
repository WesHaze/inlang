import { test, expect } from "vitest";
import {
  insertBundleNested,
  loadProjectInMemory,
  newProject,
  selectBundleNested,
} from "@inlang/sdk";
import { llmTranslateCommandAction } from "./translate.js";

test.runIf(process.env.OPENROUTER_API_KEY)(
  "llmTranslateCommandAction translates missing locales end-to-end",
  async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({
        settings: { baseLocale: "en-gb", locales: ["en-gb", "nl"] },
      }),
    });

    await insertBundleNested(project.db, {
      id: "hello",
      messages: [
        {
          id: "hello_en",
          bundleId: "hello",
          locale: "en-gb",
          variants: [
            {
              id: "hello_en_v",
              messageId: "hello_en",
              pattern: [{ type: "text", value: "Hello World" }],
            },
          ],
        },
      ],
    });

    await llmTranslateCommandAction({
      project,
      sourceLocale: "en-gb",
      targetLocales: ["nl"],
      model: "openai/gpt-4o-mini",
      concurrency: 1,
      batchSize: 10,
    });

    const bundles = await selectBundleNested(project.db).execute();
    const messages = bundles[0]?.messages;
    expect(messages?.length).toBe(2);
    expect(messages?.find((m) => m.locale === "nl")).toBeDefined();
  },
  { timeout: 20_000 },
);
