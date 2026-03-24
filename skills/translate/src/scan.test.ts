import { describe, expect, it } from "vitest"
import { insertBundleNested, loadProjectInMemory, newProject } from "@inlang/sdk"
import { generateScanOutput } from "./scan.js"

const defaultConfig = { bundleBatchSize: 20, interpretationContext: "test context", hallucinationRetries: 3 }

async function makeProject(locales = ["en", "de"]) {
  return loadProjectInMemory({
    blob: await newProject({ settings: { baseLocale: "en", locales } }),
  })
}

describe("generateScanOutput", () => {
  it("returns correct project metadata", async () => {
    const project = await makeProject(["en", "de", "fr"])
    const output = await generateScanOutput(project, defaultConfig)
    expect(output.project.baseLocale).toBe("en")
    expect(output.project.locales).toEqual(["en", "de", "fr"])
    expect(output.interpretationContext).toBe("test context")
  })

  it("returns empty batches when no bundles exist", async () => {
    const project = await makeProject()
    const output = await generateScanOutput(project, defaultConfig)
    expect(output.batches).toHaveLength(0)
  })

  it("excludes bundles where all target locales are complete", async () => {
    const project = await makeProject(["en", "de"])
    await insertBundleNested(project.db, {
      id: "complete",
      messages: [
        { id: "m-en", bundleId: "complete", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }] },
        { id: "m-de", bundleId: "complete", locale: "de", variants: [{ id: "v-de", messageId: "m-de", matches: [], pattern: [{ type: "text", value: "Hallo" }] }] },
      ],
    })
    const output = await generateScanOutput(project, defaultConfig)
    expect(output.batches).toHaveLength(0)
  })

  it("finds missing locale with existingMessageId null when no message exists", async () => {
    const project = await makeProject(["en", "de"])
    await insertBundleNested(project.db, {
      id: "welcome",
      messages: [
        { id: "m-en", bundleId: "welcome", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }] },
      ],
    })
    const output = await generateScanOutput(project, defaultConfig)
    const bundle = output.batches[0]!.bundles[0]!
    expect(bundle.id).toBe("welcome")
    expect(bundle.missingLocales).toEqual([{ locale: "de", existingMessageId: null }])
  })

  it("finds missing locale with existingMessageId when message exists but has no variants", async () => {
    const project = await makeProject(["en", "de"])
    await insertBundleNested(project.db, {
      id: "welcome",
      messages: [
        { id: "m-en", bundleId: "welcome", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }] },
        { id: "m-de", bundleId: "welcome", locale: "de", variants: [] },
      ],
    })
    const output = await generateScanOutput(project, defaultConfig)
    const bundle = output.batches[0]!.bundles[0]!
    expect(bundle.missingLocales).toEqual([{ locale: "de", existingMessageId: "m-de" }])
  })

  it("includes sourceVariants from the base locale", async () => {
    const project = await makeProject(["en", "de"])
    await insertBundleNested(project.db, {
      id: "welcome",
      messages: [
        { id: "m-en", bundleId: "welcome", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }] },
      ],
    })
    const output = await generateScanOutput(project, defaultConfig)
    const bundle = output.batches[0]!.bundles[0]!
    expect(bundle.sourceVariants[0]!.pattern).toEqual([{ type: "text", value: "Hello" }])
  })

  it("includes existingTranslations for complete locales", async () => {
    const project = await makeProject(["en", "de", "fr"])
    await insertBundleNested(project.db, {
      id: "welcome",
      messages: [
        { id: "m-en", bundleId: "welcome", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }] },
        { id: "m-de", bundleId: "welcome", locale: "de", variants: [{ id: "v-de", messageId: "m-de", matches: [], pattern: [{ type: "text", value: "Hallo" }] }] },
        // fr is missing
      ],
    })
    const output = await generateScanOutput(project, defaultConfig)
    const bundle = output.batches[0]!.bundles[0]!
    expect(bundle.existingTranslations["de"]).toBeDefined()
    expect(bundle.existingTranslations["fr"]).toBeUndefined()
    expect(bundle.missingLocales).toEqual([{ locale: "fr", existingMessageId: null }])
  })

  it("includes declarations in scan output", async () => {
    const project = await makeProject(["en", "de"])
    await insertBundleNested(project.db, {
      id: "with-decl",
      declarations: [{ type: "input-variable", name: "count" }],
      messages: [
        { id: "m-en", bundleId: "with-decl", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }] },
      ],
    })
    const output = await generateScanOutput(project, defaultConfig)
    const bundle = output.batches[0]!.bundles[0]!
    expect(bundle.declarations).toEqual([{ type: "input-variable", name: "count" }])
  })

  it("skips bundle where source message has no variants", async () => {
    const project = await makeProject(["en", "de"])
    await insertBundleNested(project.db, {
      id: "empty-source",
      messages: [
        { id: "m-en", bundleId: "empty-source", locale: "en", variants: [] },
      ],
    })
    const output = await generateScanOutput(project, defaultConfig)
    expect(output.batches).toHaveLength(0)
  })

  it("batches bundles by bundleBatchSize", async () => {
    const project = await makeProject(["en", "de"])
    // Insert 3 bundles, batch size 2 → 2 batches
    for (const id of ["b1", "b2", "b3"]) {
      await insertBundleNested(project.db, {
        id,
        messages: [{ id: `m-${id}`, bundleId: id, locale: "en", variants: [{ id: `v-${id}`, messageId: `m-${id}`, matches: [], pattern: [{ type: "text", value: "Hello" }] }] }],
      })
    }
    const output = await generateScanOutput(project, { ...defaultConfig, bundleBatchSize: 2 })
    expect(output.batches).toHaveLength(2)
    expect(output.batches[0]!.bundles).toHaveLength(2)
    expect(output.batches[1]!.bundles).toHaveLength(1)
  })
})
