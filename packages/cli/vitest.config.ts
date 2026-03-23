import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/old-unused/**",
      // Exclude live OpenRouter API tests on CI (no API key available).
      // Unit tests (*.unit.test.ts, astSerializer.test.ts, llmTranslateBundleUnit.test.ts) still run.
      ...(process.env.CI
        ? [
            "**/commands/llm/openrouterClient.test.ts",
            "**/commands/llm/llmTranslateBundle.test.ts",
            "**/commands/llm/translate.test.ts",
          ]
        : []),
    ],
  },
});
