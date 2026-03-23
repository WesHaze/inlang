import { Command } from "commander";
import fs from "node:fs/promises";
import {
  saveProjectToDirectory,
  selectBundleNested,
  upsertBundleNested,
  type InlangProject,
} from "@inlang/sdk";
import { projectOption } from "../../utilities/globalFlags.js";
import { getInlangProject } from "../../utilities/getInlangProject.js";
import { log, logError } from "../../utilities/log.js";
import { llmTranslateBundles } from "./llmTranslateBundle.js";
import {
  OpenRouterClient,
  type OpenRouterUsage,
  OPENROUTER_API_KEY_ENV,
  OPENROUTER_SITE_URL_ENV,
  OPENROUTER_SITE_NAME_ENV,
} from "./openrouterClient.js";

export const DEFAULT_MODEL = "openai/gpt-4o-mini";

/** @internal exported for testing */
export function formatUsage(usage: OpenRouterUsage): string {
  const parts: string[] = [];
  if (usage.promptTokens > 0)     parts.push(`prompt: ${usage.promptTokens}`);
  if (usage.completionTokens > 0) parts.push(`completion: ${usage.completionTokens}`);
  if (usage.cachedTokens > 0)     parts.push(`cached: ${usage.cachedTokens}`);
  if (usage.thinkingTokens > 0)   parts.push(`thinking: ${usage.thinkingTokens}`);
  return parts.length > 0
    ? `${usage.totalTokens} tokens (${parts.join(", ")})`
    : `${usage.totalTokens} tokens`;
}

export const translate = new Command()
  .command("translate")
  .requiredOption(projectOption.flags, projectOption.description)
  .option("--model <id>", "OpenRouter model ID.", DEFAULT_MODEL)
  .option("--locale <locale>", "Override source locale from project settings.")
  .option(
    "--targetLocales <locales...>",
    "Space-separated list of target locales (also accepts comma-separated), e.g. --targetLocales fr de ja.",
  )
  .option("--context <text>", "Inline brand/style instructions for the LLM.")
  .option(
    "--context-file <path>",
    "Path to a markdown file with brand/style instructions (takes precedence over --context).",
  )
  .option(
    "--batch-size <n>",
    "Bundles per LLM call.",
    (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) throw new Error(`--batch-size must be a positive integer, got: "${v}"`);
      return n;
    },
    10,
  )
  .option("--force", "Overwrite existing translations.", false)
  .option("--dry-run", "Preview translation plan. Skips API key check and makes no API calls.", false)
  .option("-q, --quiet", "Suppress per-bundle logging.", false)
  .option("--api-key <key>", "OpenRouter API key (overrides INLANG_OPENROUTER_API_KEY env var).")
  .description("Translate bundles using an LLM via OpenRouter.")
  .action(async (args: { project: string }) => {
    let exitCode = 0;
    try {
      const project = await getInlangProject({ projectPath: args.project });
      const options = translate.opts();

      // Resolve context string
      let context: string | undefined;
      if (options.contextFile) {
        context = await fs.readFile(options.contextFile, "utf8");
      } else if (options.context) {
        context = options.context;
      }

      const settings = await project.settings.get();
      const sourceLocale: string = options.locale ?? settings.baseLocale;
      const targetLocales: string[] = options.targetLocales
        ? (options.targetLocales as string[]).flatMap((s: string) => s.split(","))
        : settings.locales.filter((l: string) => l !== sourceLocale);

      const projectLocales = new Set(settings.locales as string[]);
      for (const locale of targetLocales) {
        if (!projectLocales.has(locale)) {
          log.warn(
            `Target locale "${locale}" is not in the project's locales array. It will be created but may not be picked up by your app.`,
          );
        }
      }

      const { successCount, errorCount } = await llmTranslateCommandAction({
        project,
        sourceLocale,
        targetLocales,
        model: options.model,
        apiKey: options.apiKey,
        context,
        batchSize: options.batchSize,
        force: options.force,
        dryRun: options.dryRun,
        quiet: options.quiet,
      });

      if (!options.dryRun) {
        if (successCount > 0) {
          await saveProjectToDirectory({ fs, path: args.project, project });
        }
        if (errorCount > 0) exitCode = 1;
      }
    } catch (error) {
      logError(error);
      exitCode = 1;
    } finally {
      process.exit(exitCode);
    }
  });

export type LlmTranslateCommandActionArgs = {
  project: InlangProject;
  sourceLocale: string;
  targetLocales: string[];
  model: string;
  apiKey?: string;
  context?: string;
  batchSize?: number;
  force?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
};

export async function llmTranslateCommandAction(
  args: LlmTranslateCommandActionArgs,
): Promise<{ successCount: number; errorCount: number }> {
  const {
    project,
    sourceLocale,
    model,
    context,
    batchSize = 10,
    force = false,
    dryRun = false,
    quiet = false,
  } = args;

  const targetLocales = [...new Set(args.targetLocales.map((s) => s.trim()).filter(Boolean))];

  const bundles = await selectBundleNested(project.db).execute();

  if (bundles.length === 0) {
    log.warn(
      "No bundles found. Check your project setup with `inlang validate`.",
    );
    return { successCount: 0, errorCount: 0 };
  }

  // Validate source locale exists in at least one bundle
  const hasSourceLocale = bundles.some((b) =>
    b.messages.some((m) => m.locale === sourceLocale),
  );
  if (!hasSourceLocale) {
    throw new Error(
      `Source locale "${sourceLocale}" has no messages in this project. Check --locale or your project settings.`,
    );
  }

  if (dryRun) {
    log.info(
      `Dry run: would translate ${bundles.length} bundle(s) in batches of ${batchSize} from "${sourceLocale}" to [${targetLocales.join(", ")}] using model "${model}".`,
    );
    return { successCount: 0, errorCount: 0 };
  }

  const apiKey = args.apiKey ?? process.env[OPENROUTER_API_KEY_ENV];
  if (!apiKey) {
    throw new Error(`${OPENROUTER_API_KEY_ENV} is required unless --dry-run is used.`);
  }

  const client = new OpenRouterClient({
    apiKey,
    siteUrl: process.env[OPENROUTER_SITE_URL_ENV],
    siteName: process.env[OPENROUTER_SITE_NAME_ENV],
  });

  const chunks: typeof bundles[] = [];
  for (let i = 0; i < bundles.length; i += batchSize) {
    chunks.push(bundles.slice(i, i + batchSize));
  }

  const chunkResults = await Promise.all(
    chunks.map(async (chunk, chunkIdx) => {
      const { results, usage } = await llmTranslateBundles({ bundles: chunk, sourceLocale, targetLocales, model, client, context, force, quiet });
      let chunkSuccess = 0;
      let chunkErrors = 0;
      const chunkFailed: string[] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const bundle = chunk[i]!;
        if (result.error) {
          chunkErrors++;
          log.warn(`  [${bundle.id}] error: ${result.error}`);
          continue;
        }
        if (result.data && result.translated) {
          try {
            await upsertBundleNested(project.db, result.data);
            chunkSuccess++;
          } catch (upsertErr) {
            chunkErrors++;
            log.warn(
              `  [${bundle.id}] failed to upsert: ${upsertErr instanceof Error ? upsertErr.message : String(upsertErr)}`,
            );
          }
        } else if (result.attempted) {
          chunkFailed.push(bundle.id);
        }
      }
      if (!quiet) {
        log.info(`  [batch ${chunkIdx + 1}/${chunks.length}] ${formatUsage(usage)}`);
      }
      return { usage, successCount: chunkSuccess, errorCount: chunkErrors, failedIds: chunkFailed };
    }),
  );

  const totalUsage: OpenRouterUsage = {
    promptTokens:     chunkResults.reduce((sum, r) => sum + r.usage.promptTokens, 0),
    completionTokens: chunkResults.reduce((sum, r) => sum + r.usage.completionTokens, 0),
    cachedTokens:     chunkResults.reduce((sum, r) => sum + r.usage.cachedTokens, 0),
    thinkingTokens:   chunkResults.reduce((sum, r) => sum + r.usage.thinkingTokens, 0),
    totalTokens:      chunkResults.reduce((sum, r) => sum + r.usage.totalTokens, 0),
  };
  const successCount = chunkResults.reduce((sum, r) => sum + r.successCount, 0);
  const errorCount = chunkResults.reduce((sum, r) => sum + r.errorCount, 0);
  const failedIds = chunkResults.flatMap((r) => r.failedIds);

  log.success(
    `LLM translate complete. ${successCount} bundle(s) translated, ${errorCount} error(s). ${formatUsage(totalUsage)} used.`,
  );

  if (failedIds.length > 0) {
    log.warn(
      `Could not translate ${failedIds.length} bundle(s) (LLM validation failed for all locales):\n${failedIds.map((id) => `  - ${id}`).join("\n")}`,
    );
  }

  return { successCount, errorCount };
}
