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

export const DEFAULT_MODEL = "openai/gpt-5-mini";

export const translate = new Command()
  .command("translate")
  .requiredOption(projectOption.flags, projectOption.description)
  .option("--model <id>", "OpenRouter model ID.", DEFAULT_MODEL)
  .option("--locale <locale>", "Override source locale from project settings.")
  .option(
    "--targetLocales <locales...>",
    "Target locales for translation (comma-separated).",
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
    200,
  )
  .option("--force", "Overwrite existing translations.", false)
  .option("--dry-run", "Preview what would be translated without writing.", false)
  .option("-q, --quiet", "Suppress per-bundle logging.", false)
  .option("--api-key <key>", "OpenRouter API key (overrides OPENROUTER_API_KEY env var).")
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

      await llmTranslateCommandAction({
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
        await saveProjectToDirectory({ fs, path: args.project, project });
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
): Promise<void> {
  const {
    project,
    sourceLocale,
    targetLocales,
    model,
    context,
    batchSize = 200,
    force = false,
    dryRun = false,
    quiet = false,
  } = args;

  const apiKey = args.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!dryRun && !apiKey) {
    throw new Error("OPENROUTER_API_KEY is required unless --dry-run is used.");
  }

  const bundles = await selectBundleNested(project.db).execute();

  if (bundles.length === 0) {
    log.warn(
      "No bundles found. Check your project setup with `inlang validate`.",
    );
    return;
  }

  if (dryRun) {
    log.info(
      `Dry run: would translate ${bundles.length} bundle(s) in batches of ${batchSize} from "${sourceLocale}" to [${targetLocales.join(", ")}] using model "${model}".`,
    );
    return;
  }

  const chunks: typeof bundles[] = [];
  for (let i = 0; i < bundles.length; i += batchSize) {
    chunks.push(bundles.slice(i, i + batchSize));
  }

  let totalTokens = 0;
  let successCount = 0;
  let errorCount = 0;

  const batchResults = await Promise.all(
    chunks.map((chunk, chunkIdx) =>
      llmTranslateBundles({ bundles: chunk, sourceLocale, targetLocales, model, openrouterApiKey: apiKey, context, force })
        .then(async ({ results, usage }) => {
          totalTokens += usage.totalTokens;
          await Promise.all(
            results.map(async (result, i) => {
              const bundle = chunk[i]!;
              if (result.error) {
                errorCount++;
                log.warn(`  [${bundle.id}] error: ${result.error}`);
                return;
              }
              if (result.data) {
                try {
                  await upsertBundleNested(project.db, result.data);
                  successCount++;
                } catch (upsertErr) {
                  errorCount++;
                  log.warn(
                    `  [${bundle.id}] failed to upsert: ${upsertErr instanceof Error ? upsertErr.message : String(upsertErr)}`,
                  );
                }
              }
            }),
          );
          if (!quiet) {
            log.info(`  [batch ${chunkIdx + 1}/${chunks.length}] ${usage.totalTokens} tokens`);
          }
        }),
    ),
  );

  void batchResults; // results processed inline above

  log.success(
    `LLM translate complete. ${successCount} bundle(s) translated, ${errorCount} error(s). Total tokens used: ${totalTokens}.`,
  );
}
