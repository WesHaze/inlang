import { fileURLToPath } from "node:url"
import { Value } from "@sinclair/typebox/value"
import { Pattern, type Variant } from "@inlang/sdk"

type VariantShape = Pick<Variant, "matches" | "pattern">

type TranslationToValidate = {
  bundleId: string
  locale: string
  sourceVariants: VariantShape[]
  variants: VariantShape[]
}

export function validateTranslations(input: { translations: TranslationToValidate[] }): void {
  for (const t of input.translations) {
    const label = `bundle '${t.bundleId}' [${t.locale}]`

    if (t.variants.length !== t.sourceVariants.length) {
      throw new Error(
        `${label}: variant count mismatch (expected ${t.sourceVariants.length}, got ${t.variants.length})`
      )
    }

    for (let i = 0; i < t.variants.length; i++) {
      const src = t.sourceVariants[i]!
      const tgt = t.variants[i]!

      if (!Value.Check(Pattern, tgt.pattern)) {
        const errors = Value.Errors(Pattern, tgt.pattern)
        throw new Error(`${label} variant ${i}: ${errors.First()?.message ?? "pattern schema violation"}`)
      }

      if (src.pattern.length !== tgt.pattern.length) {
        throw new Error(
          `${label} variant ${i}: node count mismatch (expected ${src.pattern.length}, got ${tgt.pattern.length})`
        )
      }

      for (let j = 0; j < src.pattern.length; j++) {
        const srcNode = src.pattern[j]!
        const tgtNode = tgt.pattern[j]
        if (srcNode.type !== tgtNode!.type) {
          throw new Error(
            `${label} variant ${i}: node ${j} type changed from '${srcNode.type}' to '${tgtNode!.type}'`
          )
        }
      }
    }
  }
}

// Script entry — reads stdin, validates, exits non-zero on failure
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Usage: node dist/validate.js < input.json\n" +
        "Validates translation JSON from stdin. Exits non-zero and prints error to stderr on failure.\n" +
        "\nInput shape: { translations: [{ bundleId, locale, sourceVariants, variants }] }\n"
    )
    process.exit(0)
  }

  let raw = ""
  process.stdin.setEncoding("utf8")
  for await (const chunk of process.stdin) {
    raw += chunk
  }

  try {
    validateTranslations(JSON.parse(raw))
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n")
    process.exit(1)
  }
}
