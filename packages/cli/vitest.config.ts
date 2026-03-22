import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/old-unused/**",
      ...(process.env.CI ? ["**/commands/llm/**"] : []),
    ],
  },
});
