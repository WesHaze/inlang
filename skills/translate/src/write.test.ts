import { describe, expect, it } from "vitest"
import { insertBundleNested, loadProjectInMemory, newProject, selectBundleNested, upsertBundleNested } from "@inlang/sdk"
import { writeTranslations } from "./write.js"

async function makeProjectWithSource() {
  const project = await loadProjectInMemory({
    blob: await newProject({ settings: { baseLocale: "en", locales: ["en", "de"] } }),
  })
  await insertBundleNested(project.db, {
    id: "welcome",
    messages: [
      {
        id: "m-en",
        bundleId: "welcome",
        locale: "en",
        variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }],
      },
    ],
  })
  return project
}

describe("writeTranslations", () => {
  it("writes a new translation when existingMessageId is null", async () => {
    const project = await makeProjectWithSource()

    await writeTranslations(project, {
      translations: [
        {
          bundleId: "welcome",
          locale: "de",
          declarations: [],
          selectors: [],
          existingMessageId: null,
          variants: [{ matches: [], pattern: [{ type: "text", value: "Hallo" }] }],
        },
      ],
    })

    const bundle = await selectBundleNested(project.db)
      .where("bundle.id", "=", "welcome")
      .executeTakeFirstOrThrow()
    const deMessage = bundle.messages.find((m) => m.locale === "de")
    expect(deMessage).toBeDefined()
    expect(deMessage!.variants).toHaveLength(1)
    expect(deMessage!.variants[0]!.pattern).toEqual([{ type: "text", value: "Hallo" }])
  })

  it("writes to an existing message when existingMessageId is provided", async () => {
    const project = await makeProjectWithSource()

    // Create an empty de message first (upsert to handle the already-existing bundle)
    await upsertBundleNested(project.db, {
      id: "welcome",
      messages: [
        { id: "m-en", bundleId: "welcome", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }] },
        { id: "m-de", bundleId: "welcome", locale: "de", variants: [] },
      ],
    })

    await writeTranslations(project, {
      translations: [
        {
          bundleId: "welcome",
          locale: "de",
          declarations: [],
          selectors: [],
          existingMessageId: "m-de",
          variants: [{ matches: [], pattern: [{ type: "text", value: "Hallo" }] }],
        },
      ],
    })

    const bundle = await selectBundleNested(project.db)
      .where("bundle.id", "=", "welcome")
      .executeTakeFirstOrThrow()
    const deMessage = bundle.messages.find((m) => m.locale === "de")
    expect(deMessage!.id).toBe("m-de")
    expect(deMessage!.variants[0]!.pattern).toEqual([{ type: "text", value: "Hallo" }])
  })

  it("does not overwrite existing translations for other locales", async () => {
    const project = await makeProjectWithSource()

    await writeTranslations(project, {
      translations: [
        {
          bundleId: "welcome",
          locale: "de",
          declarations: [],
          selectors: [],
          existingMessageId: null,
          variants: [{ matches: [], pattern: [{ type: "text", value: "Hallo" }] }],
        },
      ],
    })

    const bundle = await selectBundleNested(project.db)
      .where("bundle.id", "=", "welcome")
      .executeTakeFirstOrThrow()
    const enMessage = bundle.messages.find((m) => m.locale === "en")
    expect(enMessage!.variants[0]!.pattern).toEqual([{ type: "text", value: "Hello" }])
  })

  it("handles multiple translations for the same bundle in one call", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({ settings: { baseLocale: "en", locales: ["en", "de", "fr"] } }),
    })
    await insertBundleNested(project.db, {
      id: "multi",
      messages: [
        { id: "m-en", bundleId: "multi", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }] },
      ],
    })

    await writeTranslations(project, {
      translations: [
        { bundleId: "multi", locale: "de", declarations: [], selectors: [], existingMessageId: null, variants: [{ matches: [], pattern: [{ type: "text", value: "Hallo" }] }] },
        { bundleId: "multi", locale: "fr", declarations: [], selectors: [], existingMessageId: null, variants: [{ matches: [], pattern: [{ type: "text", value: "Bonjour" }] }] },
      ],
    })

    const bundle = await selectBundleNested(project.db)
      .where("bundle.id", "=", "multi")
      .executeTakeFirstOrThrow()
    expect(bundle.messages.filter((m) => m.locale === "de")).toHaveLength(1)
    expect(bundle.messages.filter((m) => m.locale === "fr")).toHaveLength(1)
  })

  it("generates valid UUIDs for new message and variant ids", async () => {
    const project = await makeProjectWithSource()

    await writeTranslations(project, {
      translations: [
        {
          bundleId: "welcome",
          locale: "de",
          declarations: [],
          selectors: [],
          existingMessageId: null,
          variants: [{ matches: [], pattern: [{ type: "text", value: "Hallo" }] }],
        },
      ],
    })

    const bundle = await selectBundleNested(project.db)
      .where("bundle.id", "=", "welcome")
      .executeTakeFirstOrThrow()
    const deMessage = bundle.messages.find((m) => m.locale === "de")
    expect(deMessage!.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(deMessage!.variants[0]!.id).toMatch(/^[0-9a-f-]{36}$/)
  })
})
