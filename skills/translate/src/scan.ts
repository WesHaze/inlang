import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import fs from "node:fs"
import {
  loadProjectFromDirectory,
  selectBundleNested,
  hasMissingTranslations,
  type InlangProject,
  type Declaration,
  type Variant,
  type VariableReference,
} from "@inlang/sdk"

type Config = {
  bundleBatchSize: number
  interpretationContext: string
  hallucinationRetries: number
}

type MissingLocale = { locale: string; existingMessageId: string | null }

type ScanBundle = {
  id: string
  declarations: Declaration[]
  selectors: VariableReference[]
  sourceVariants: Array<Pick<Variant, "matches" | "pattern">>
  existingTranslations: Record<string, Array<Pick<Variant, "matches" | "pattern">>>
  missingLocales: MissingLocale[]
}

type ScanOutput = {
  project: { baseLocale: string; locales: string[] }
  interpretationContext: string
  batches: Array<{ bundles: ScanBundle[] }>
}

export async function generateScanOutput(project: InlangProject, config: Config): Promise<ScanOutput> {
  const settings = await project.settings.get()
  const { baseLocale, locales } = settings
  const targetLocales = locales.filter((l) => l !== baseLocale)

  const allBundles = await selectBundleNested(project.db).selectAll().execute()

  const missingBundles: ScanBundle[] = []

  for (const bundle of allBundles) {
    const sourceMessage = bundle.messages.find((m) => m.locale === baseLocale)
    if (!sourceMessage || sourceMessage.variants.length === 0) continue

    const missingLocales: MissingLocale[] = []
    const existingTranslations: Record<string, Array<Pick<Variant, "matches" | "pattern">>> = {}

    for (const locale of targetLocales) {
      const message = bundle.messages.find((m) => m.locale === locale)
      if (hasMissingTranslations(bundle, [locale])) {
        missingLocales.push({ locale, existingMessageId: message?.id ?? null })
      } else {
        existingTranslations[locale] = message!.variants.map((v) => ({
          matches: v.matches,
          pattern: v.pattern,
        }))
      }
    }

    if (missingLocales.length === 0) continue

    missingBundles.push({
      id: bundle.id,
      declarations: bundle.declarations,
      selectors: sourceMessage.selectors,
      sourceVariants: sourceMessage.variants.map((v) => ({ matches: v.matches, pattern: v.pattern })),
      existingTranslations,
      missingLocales,
    })
  }

  const batches: Array<{ bundles: ScanBundle[] }> = []
  for (let i = 0; i < missingBundles.length; i += config.bundleBatchSize) {
    batches.push({ bundles: missingBundles.slice(i, i + config.bundleBatchSize) })
  }

  return {
    project: { baseLocale, locales },
    interpretationContext: config.interpretationContext,
    batches,
  }
}

// Script entry — discovers *.inlang project in CWD, outputs batch JSON to stdout
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Usage: node scripts/scan.js\n" +
        "Discovers *.inlang project in CWD, outputs batch JSON to stdout.\n" +
        "Configure via config.json in the skill directory.\n"
    )
    process.exit(0)
  }

  const cwd = process.cwd()
  const matches = fs
    .readdirSync(cwd, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith(".inlang"))
    .map((e) => resolve(cwd, e.name))

  if (matches.length === 0) {
    process.stderr.write("Error: no *.inlang project found in current directory.\n")
    process.exit(1)
  }
  if (matches.length > 1) {
    process.stderr.write(
      `Error: multiple *.inlang projects found. Run from the correct directory:\n${matches.join("\n")}\n`
    )
    process.exit(1)
  }

  const projectPath = matches[0]!

  const configPath = fileURLToPath(new URL("../config.json", import.meta.url))

  let config: Config = { bundleBatchSize: 20, interpretationContext: "", hallucinationRetries: 3 }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"))
    config = {
      bundleBatchSize: Number.isInteger(raw.bundleBatchSize) && raw.bundleBatchSize > 0 ? raw.bundleBatchSize : 20,
      interpretationContext: typeof raw.interpretationContext === "string" ? raw.interpretationContext : "",
      hallucinationRetries:
        Number.isInteger(raw.hallucinationRetries) && raw.hallucinationRetries > 0 ? raw.hallucinationRetries : 3,
    }
  } catch {
    // Use defaults if config.json is missing or invalid
  }

  const project = await loadProjectFromDirectory({ path: projectPath, fs })

  const errors = await project.errors.get()
  if (errors.length > 0) {
    await project.close()
    for (const err of errors) {
      process.stderr.write(`Project error: ${err.message}\n`)
    }
    process.exit(1)
  }

  const output = await generateScanOutput(project, config)
  await project.close()

  if (output.batches.length === 0) {
    process.stderr.write("No missing translations found. Nothing to do.\n")
    process.exit(0)
  }

  process.stdout.write(JSON.stringify(output) + "\n")
}
