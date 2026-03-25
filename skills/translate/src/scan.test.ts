import { describe, expect, it } from "vitest"
import { insertBundleNested, loadProjectInMemory, newProject } from "@inlang/sdk"
import { generateScanOutput } from "./scan.js"

const defaultConfig = { bundleBatchSize: 20, interpretationContext: "test context", hallucinationRetries: 3, force: false }

async function makeProject(locales = ["en", "de"]) {
  return loadProjectInMemory({
    blob: await newProject({ settings: { baseLocale: "en", locales } }),
  })
}

describe("generateScanOutput", () => {
  it("identifies missing locales and populates bundle data correctly", async () => {
    const project = await makeProject(["en", "de", "fr"])
    await insertBundleNested(project.db, {
      id: "welcome",
      declarations: [{ type: "input-variable", name: "name" }],
      messages: [
        { id: "m-en", bundleId: "welcome", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }] },
        { id: "m-de", bundleId: "welcome", locale: "de", variants: [{ id: "v-de", messageId: "m-de", matches: [], pattern: [{ type: "text", value: "Hallo" }] }] },
        // fr is missing
      ],
    })
    const output = await generateScanOutput("test-project", project, defaultConfig)
    const bundle = output.batches[0]!.bundles[0]!
    expect(bundle.targetLocales).toEqual([{ locale: "fr", existingMessageId: null }])
    expect(bundle.existingTranslations["de"]).toBeDefined()
    expect(bundle.sourceVariants[0]!.pattern).toEqual([{ type: "text", value: "Hello" }])
    expect(bundle.declarations).toEqual([{ type: "input-variable", name: "name" }])
  })

  it("excludes fully translated bundles", async () => {
    const project = await makeProject()
    await insertBundleNested(project.db, {
      id: "complete",
      messages: [
        { id: "m-en", bundleId: "complete", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }] },
        { id: "m-de", bundleId: "complete", locale: "de", variants: [{ id: "v-de", messageId: "m-de", matches: [], pattern: [{ type: "text", value: "Hallo" }] }] },
      ],
    })
    const output = await generateScanOutput("test-project", project, defaultConfig)
    expect(output.batches).toHaveLength(0)
  })

  it("includes all bundles when force is true", async () => {
    const project = await makeProject()
    await insertBundleNested(project.db, {
      id: "complete",
      messages: [
        { id: "m-en", bundleId: "complete", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Hello" }] }] },
        { id: "m-de", bundleId: "complete", locale: "de", variants: [{ id: "v-de", messageId: "m-de", matches: [], pattern: [{ type: "text", value: "Hallo" }] }] },
      ],
    })
    const output = await generateScanOutput("test-project", project, { ...defaultConfig, force: true })
    expect(output.batches[0]!.bundles[0]!.targetLocales).toEqual([{ locale: "de", existingMessageId: "m-de" }])
  })

  it("batches bundles by bundleBatchSize", async () => {
    const project = await makeProject()
    for (const id of ["b1", "b2", "b3"]) {
      await insertBundleNested(project.db, {
        id,
        messages: [{ id: `m-${id}`, bundleId: id, locale: "en", variants: [{ id: `v-${id}`, messageId: `m-${id}`, matches: [], pattern: [{ type: "text", value: "Hello" }] }] }],
      })
    }
    const output = await generateScanOutput("test-project", project, { ...defaultConfig, bundleBatchSize: 2 })
    expect(output.batches).toHaveLength(2)
  })
})
