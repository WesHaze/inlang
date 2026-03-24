import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import fsPromises from "node:fs/promises"
import { resolve } from "node:path"
import {
  loadProjectFromDirectory,
  saveProjectToDirectory,
  upsertBundleNested,
  type Declaration,
  type InlangProject,
  type Variant,
  type VariableReference,
} from "@inlang/sdk"

type WriteTranslation = {
  bundleId: string
  locale: string
  declarations: Declaration[]
  selectors: VariableReference[]
  existingMessageId: string | null
  variants: Array<Pick<Variant, "matches" | "pattern">>
}

export async function writeTranslations(
  project: InlangProject,
  input: { translations: WriteTranslation[] }
): Promise<void> {
  // Group by bundleId so each bundle is upserted once
  const byBundle = new Map<string, WriteTranslation[]>()
  for (const t of input.translations) {
    const group = byBundle.get(t.bundleId) ?? []
    group.push(t)
    byBundle.set(t.bundleId, group)
  }

  for (const [bundleId, translations] of byBundle) {
    const first = translations[0]!
    await upsertBundleNested(project.db, {
      id: bundleId,
      declarations: first.declarations,
      messages: translations.map((t) => {
        const messageId = t.existingMessageId ?? randomUUID()
        return {
          id: messageId,
          bundleId,
          locale: t.locale,
          selectors: t.selectors,
          variants: t.variants.map((v) => ({
            id: randomUUID(),
            messageId,
            matches: v.matches,
            pattern: v.pattern,
          })),
        }
      }),
    })
  }
}

// Script entry
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Usage: node dist/write.js < input.json\n" +
        "Reads passing translations from stdin, writes to the *.inlang project in CWD.\n" +
        "\nInput shape: { translations: [{ bundleId, locale, declarations, selectors, existingMessageId, variants }] }\n"
    )
    process.exit(0)
  }

  const cwd = process.cwd()
  const entries = fs.readdirSync(cwd, { withFileTypes: true })
  const matches = entries
    .filter((e) => e.isDirectory() && e.name.endsWith(".inlang"))
    .map((e) => resolve(cwd, e.name))

  if (matches.length === 0) {
    process.stderr.write("Error: no *.inlang project found in current directory.\n")
    process.exit(1)
  }
  if (matches.length > 1) {
    process.stderr.write(
      `Error: multiple *.inlang projects found:\n${matches.join("\n")}\n`
    )
    process.exit(1)
  }

  const projectPath = matches[0]!
  const project = await loadProjectFromDirectory({ path: projectPath, fs })

  let raw = ""
  process.stdin.setEncoding("utf8")
  for await (const chunk of process.stdin) {
    raw += chunk
  }

  try {
    await writeTranslations(project, JSON.parse(raw))
    await saveProjectToDirectory({ fs: fsPromises, path: projectPath, project })
  } finally {
    await project.close()
  }
}
