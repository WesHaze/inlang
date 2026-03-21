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
import { llmTranslateBundle } from "./llmTranslateBundle.js";

export const translate = new Command()
  .command("translate")
  .requiredOption(projectOption.flags, projectOption.description)
  .option("--model <id>", "OpenRouter model ID.", "openai/gpt-4o-mini")
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
    "Bundles per parallel batch.",
    (v) => parseInt(v, 10),
    20,
  )
  .option(
    "--concurrency <n>",
    "Number of parallel batches.",
    (v) => parseInt(v, 10),
    4,
  )
  .option("--force", "Overwrite existing translations.", false)
  .option("--dry-run", "Preview what would be translated without writing.", false)
  .option("-q, --quiet", "Suppress per-bundle logging.", false)
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
        ? options.targetLocales[0]?.split(",")
        : settings.locales.filter((l: string) => l !== sourceLocale);

      await llmTranslateCommandAction({
        project,
        sourceLocale,
        targetLocales,
        model: options.model,
        context,
        concurrency: options.concurrency,
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
  context?: string;
  concurrency?: number;
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
    concurrency = 4,
    batchSize = 20,
    force = false,
    dryRun = false,
    quiet = false,
  } = args;

  const apiKey = process.env.OPENROUTER_API_KEY;
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
      `Dry run: would translate ${bundles.length} bundle(s) from "${sourceLocale}" to [${targetLocales.join(", ")}] using model "${model}".`,
    );
    return;
  }

  // Chunk bundles into batches; batches run with limited concurrency
  const chunks: typeof bundles[] = [];
  for (let i = 0; i < bundles.length; i += batchSize) {
    chunks.push(bundles.slice(i, i + batchSize));
  }

  let totalTokens = 0;
  let successCount = 0;
  let errorCount = 0;

  await mapWithConcurrency(chunks, concurrency, async (chunk, chunkIdx) => {
    for (const bundle of chunk) {
      const result = await llmTranslateBundle({
        bundle,
        sourceLocale,
        targetLocales,
        model,
        context,
        force,
      });

      if (result.error) {
        errorCount++;
        log.warn(`  [${bundle.id}] error: ${result.error}`);
        continue;
      }

      if (result.data) {
        await upsertBundleNested(project.db, result.data);
        successCount++;

        if (!quiet && result.usage) {
          totalTokens += result.usage.totalTokens;
          log.info(
            `  [chunk ${chunkIdx + 1}/${chunks.length}] ${bundle.id} — ${result.usage.totalTokens} tokens`,
          );
        }
      }
    }
  });

  log.success(
    `LLM translate complete. ${successCount} bundle(s) translated, ${errorCount} error(s). Total tokens: ${totalTokens}.`,
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      results[current] = await mapper(items[current]!, current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker()),
  );
  return results;
}
