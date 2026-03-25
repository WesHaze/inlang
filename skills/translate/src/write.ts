import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import fsPromises from "node:fs/promises"
import { Type, type Static } from "@sinclair/typebox"
import {
  loadProjectFromDirectory,
  saveProjectToDirectory,
  upsertBundleNested,
  Declaration,
  VariableReference,
  Pattern,
  type InlangProject,
} from "@inlang/sdk"

const VariantShape = Type.Object({
  matches: Type.Array(Type.Any()),
  pattern: Pattern,
})

const WriteTranslationSchema = Type.Object({
  bundleId: Type.String(),
  locale: Type.String(),
  declarations: Type.Array(Declaration),
  selectors: Type.Array(VariableReference),
  existingMessageId: Type.Union([Type.String(), Type.Null()]),
  variants: Type.Array(VariantShape),
})

type WriteTranslation = Static<typeof WriteTranslationSchema>

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
  let raw = ""
  process.stdin.setEncoding("utf8")
  for await (const chunk of process.stdin) {
    raw += chunk
  }

  const input = JSON.parse(raw)
  const projectPath: string = input.projectPath
  const project = await loadProjectFromDirectory({ path: projectPath, fs })

  try {
    await writeTranslations(project, input)
    await saveProjectToDirectory({ fs: fsPromises, path: projectPath, project })
  } finally {
    await project.close()
  }
}
