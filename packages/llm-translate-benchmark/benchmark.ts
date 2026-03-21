#!/usr/bin/env npx tsx
/**
 * LLM Translate Benchmark
 *
 * Tests different batch sizes and locale strategies and records
 * token usage to results/runs.json and results/runs.csv.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-... npx tsx benchmark.ts [--model openai/gpt-5-mini] [--batch-sizes 5,10,20] [--dry-run]
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  insertBundleNested,
  loadProjectInMemory,
  newProject,
  selectBundleNested,
} from "@inlang/sdk";
import { generateFixtureKeys } from "./fixtures/keys.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "results");
const RUNS_JSON = path.join(RESULTS_DIR, "runs.json");
const RUNS_CSV = path.join(RESULTS_DIR, "runs.csv");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const modelArg = args.find((_, i) => args[i - 1] === "--model") ?? "openai/gpt-5-mini";
const batchSizesArg = args.find((_, i) => args[i - 1] === "--batch-sizes") ?? "5,10,20,50,100";
const dryRun = args.includes("--dry-run");

const BATCH_SIZES = batchSizesArg.split(",").map(Number);
const STRATEGIES: Array<"multi-locale" | "per-locale"> = ["multi-locale", "per-locale"];
const SOURCE_LOCALE = "en-gb";
const TARGET_LOCALES = ["nl", "de", "fr", "es"];
const MODEL = modelArg;

const apiKey = process.env.OPENROUTER_API_KEY;
if (!dryRun && !apiKey) {
  console.error("OPENROUTER_API_KEY is required unless --dry-run is used.");
  process.exit(1);
}

// ── Types ─────────────────────────────────────────────────────────────────

type BenchmarkRecord = {
  runId: string;
  timestamp: string;
  command: string;
  model: string;
  strategy: "multi-locale" | "per-locale";
  batchSize: number;
  keyCount: number;
  locales: string[];
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  successCount: number;
  rejectedCount: number;
  durationMs: number;
};

// ── OpenRouter call ───────────────────────────────────────────────────────

async function callOpenRouter(
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<{
  content: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  totalTokens: number;
}> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.1 }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter HTTP ${response.status}: ${text}`);
  }

  const data = await response.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  const u = data?.usage ?? {};

  return {
    content,
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    thinkingTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}

// ── Serialization helpers ─────────────────────────────────────────────────

function validatePattern(source: unknown[], translated: unknown): boolean {
  if (!Array.isArray(translated)) return false;
  if (translated.length !== source.length) return false;
  for (let i = 0; i < source.length; i++) {
    const src = source[i] as Record<string, unknown>;
    const tgt = translated[i] as Record<string, unknown>;
    if (src["type"] !== "text") {
      if (JSON.stringify(src) !== JSON.stringify(tgt)) return false;
    }
  }
  return true;
}

// ── Experiment runner ─────────────────────────────────────────────────────

type Bundle = Awaited<ReturnType<ReturnType<typeof selectBundleNested>["execute"]>>[0];

async function runExperiment(
  runId: string,
  keys: Bundle[],
  batchSize: number,
  strategy: "multi-locale" | "per-locale",
): Promise<BenchmarkRecord[]> {
  const records: BenchmarkRecord[] = [];

  // Chunk keys into batches
  const chunks: Bundle[][] = [];
  for (let i = 0; i < keys.length; i += batchSize) {
    chunks.push(keys.slice(i, i + batchSize));
  }

  const localesToTest =
    strategy === "multi-locale" ? [TARGET_LOCALES] : TARGET_LOCALES.map((l) => [l]);

  for (const chunk of chunks) {
    for (const locales of localesToTest) {
      // Build the multi-key prompt for this chunk
      const keyEntries: Record<string, { sourceLocale: string; pattern: unknown; targetLocales: string[] }> = {};

      for (const bundle of chunk) {
        const srcMessage = bundle.messages.find((m) => m.locale === SOURCE_LOCALE);
        if (!srcMessage) continue;
        const srcVariant = srcMessage.variants[0];
        if (!srcVariant) continue;
        keyEntries[bundle.id] = {
          sourceLocale: SOURCE_LOCALE,
          pattern: srcVariant.pattern,
          targetLocales: locales,
        };
      }

      const systemPrompt =
        `You are a UI localisation expert. ` +
        `For each key, translate only the "value" field of nodes where "type" is "text". ` +
        `Return the full pattern array with all non-text nodes exactly as given.`;

      const userContent = [
        `Translate the following keys. For each key, translate from "${SOURCE_LOCALE}" to: ${locales.join(", ")}.`,
        ``,
        `Respond ONLY with a JSON object: { "bundleId": { "locale": [...pattern array...] } }`,
        ``,
        `Keys:`,
        JSON.stringify(keyEntries, null, 2),
      ].join("\n");

      if (dryRun) {
        console.log(
          `[DRY RUN] strategy=${strategy} batchSize=${batchSize} chunk=${chunk.length} locales=${locales.join(",")}`,
        );
        console.log(`  Prompt length: ${userContent.length} chars`);
        continue;
      }

      const start = Date.now();
      let result;
      try {
        result = await callOpenRouter([
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ]);
      } catch (err) {
        console.error(`  [ERROR] ${err}`);
        continue;
      }
      const durationMs = Date.now() - start;

      // Validate response
      let successCount = 0;
      let rejectedCount = 0;

      let translations: Record<string, Record<string, unknown[]>> = {};
      try {
        translations = JSON.parse(result.content);
      } catch {
        console.warn("  [WARN] Failed to parse LLM response as JSON");
        rejectedCount = chunk.length * locales.length;
      }

      for (const bundle of chunk) {
        const srcMessage = bundle.messages.find((m) => m.locale === SOURCE_LOCALE);
        if (!srcMessage) continue;
        const srcVariant = srcMessage.variants[0];
        if (!srcVariant) continue;

        for (const locale of locales) {
          const translated = translations?.[bundle.id]?.[locale];
          if (validatePattern(srcVariant.pattern as unknown[], translated)) {
            successCount++;
          } else {
            rejectedCount++;
            console.warn(
              `  [WARN] Validation failed: ${bundle.id} → ${locale}`,
            );
          }
        }
      }

      const record: BenchmarkRecord = {
        runId,
        timestamp: new Date().toISOString(),
        command: `npx tsx benchmark.ts ${args.join(" ")}`,
        model: MODEL,
        strategy,
        batchSize,
        keyCount: chunk.length,
        locales,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        cachedTokens: result.cachedTokens,
        thinkingTokens: result.thinkingTokens,
        totalTokens: result.totalTokens,
        successCount,
        rejectedCount,
        durationMs,
      };

      records.push(record);
      console.log(
        `  [${strategy}] batchSize=${batchSize} keys=${chunk.length} locales=${locales.join(",")} tokens=${result.totalTokens} success=${successCount} rejected=${rejectedCount} ms=${durationMs}`,
      );
    }
  }

  return records;
}

// ── Results I/O ───────────────────────────────────────────────────────────

function loadExistingRuns(): BenchmarkRecord[] {
  try {
    return JSON.parse(fs.readFileSync(RUNS_JSON, "utf8"));
  } catch {
    return [];
  }
}

function saveRuns(records: BenchmarkRecord[]): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(RUNS_JSON, JSON.stringify(records, null, 2), "utf8");
}

function saveCsv(records: BenchmarkRecord[]): void {
  if (records.length === 0) return;
  const header = Object.keys(records[0]!).join(",");
  const rows = records.map((r) =>
    Object.values(r)
      .map((v) => (Array.isArray(v) ? `"${v.join(";")}"` : String(v)))
      .join(","),
  );
  fs.writeFileSync(RUNS_CSV, [header, ...rows].join("\n"), "utf8");
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\nLLM Translate Benchmark`);
  console.log(`Model       : ${MODEL}`);
  console.log(`Batch sizes : ${BATCH_SIZES.join(", ")}`);
  console.log(`Strategies  : ${STRATEGIES.join(", ")}`);
  console.log(`Dry run     : ${dryRun}`);
  console.log(`\nLoading fixture keys...`);

  const project = await loadProjectInMemory({
    blob: await newProject({
      settings: { baseLocale: SOURCE_LOCALE, locales: [SOURCE_LOCALE, ...TARGET_LOCALES] },
    }),
  });

  const fixtureKeys = generateFixtureKeys();
  console.log(`Inserting ${fixtureKeys.length} fixture keys...`);

  for (const key of fixtureKeys) {
    await insertBundleNested(project.db, key);
  }

  const allBundles = await selectBundleNested(project.db).execute();
  console.log(`Loaded ${allBundles.length} bundles.\n`);

  const runId = randomUUID();
  const existingRuns = loadExistingRuns();
  const newRecords: BenchmarkRecord[] = [];

  for (const batchSize of BATCH_SIZES) {
    for (const strategy of STRATEGIES) {
      console.log(`\n── batchSize=${batchSize} strategy=${strategy} ──`);
      const records = await runExperiment(runId, allBundles, batchSize, strategy);
      newRecords.push(...records);
    }
  }

  if (!dryRun && newRecords.length > 0) {
    const allRuns = [...existingRuns, ...newRecords];
    saveRuns(allRuns);
    saveCsv(allRuns);
    console.log(`\nResults written to results/runs.json and results/runs.csv`);
    console.log(`Total new records: ${newRecords.length}`);

    // Summary by batchSize + strategy
    console.log("\n── Summary ──");
    console.log(
      `${"Strategy".padEnd(15)} ${"BatchSize".padEnd(10)} ${"AvgTokens".padEnd(12)} ${"AvgSuccess".padEnd(12)} ${"AvgRejected"}`,
    );
    const grouped = new Map<string, BenchmarkRecord[]>();
    for (const r of newRecords) {
      const key = `${r.strategy}::${r.batchSize}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    }
    for (const [key, recs] of grouped) {
      const [strategy, batchSize] = key.split("::");
      const avgTokens = Math.round(recs.reduce((s, r) => s + r.totalTokens, 0) / recs.length);
      const avgSuccess = (recs.reduce((s, r) => s + r.successCount, 0) / recs.length).toFixed(1);
      const avgRejected = (recs.reduce((s, r) => s + r.rejectedCount, 0) / recs.length).toFixed(1);
      console.log(
        `${strategy!.padEnd(15)} ${batchSize!.padEnd(10)} ${String(avgTokens).padEnd(12)} ${avgSuccess.padEnd(12)} ${avgRejected}`,
      );
    }

    // Grand totals across all cells in this run
    const totalPrompt = newRecords.reduce((s, r) => s + r.promptTokens, 0);
    const totalCompletion = newRecords.reduce((s, r) => s + r.completionTokens, 0);
    const totalCached = newRecords.reduce((s, r) => s + r.cachedTokens, 0);
    const totalThinking = newRecords.reduce((s, r) => s + r.thinkingTokens, 0);
    const totalAll = newRecords.reduce((s, r) => s + r.totalTokens, 0);
    const totalSuccess = newRecords.reduce((s, r) => s + r.successCount, 0);
    const totalRejected = newRecords.reduce((s, r) => s + r.rejectedCount, 0);
    const totalDuration = newRecords.reduce((s, r) => s + r.durationMs, 0);

    console.log("\n── Run totals ──");
    console.log(`  Prompt tokens     : ${totalPrompt.toLocaleString()}`);
    console.log(`  Completion tokens : ${totalCompletion.toLocaleString()}`);
    console.log(`  Cached tokens     : ${totalCached.toLocaleString()}`);
    console.log(`  Thinking tokens   : ${totalThinking.toLocaleString()}`);
    console.log(`  Total tokens      : ${totalAll.toLocaleString()}`);
    console.log(`  Success / Rejected: ${totalSuccess} / ${totalRejected}`);
    console.log(`  Wall time         : ${(totalDuration / 1000).toFixed(1)}s`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
