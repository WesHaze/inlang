import { describe, expect, it } from "vitest"
import { insertBundleNested, loadProjectInMemory, newProject, selectBundleNested } from "@inlang/sdk"
import { generateScanOutput } from "./scan.js"
import { validateTranslations } from "./validate.js"
import { writeTranslations } from "./write.js"

const defaultConfig = { bundleBatchSize: 20, interpretationContext: "", hallucinationRetries: 3, force: false }

describe("integration: scan → validate → write", () => {
  it("translates a simple missing variant end-to-end", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({ settings: { baseLocale: "en", locales: ["en", "de"] } }),
    })

    await insertBundleNested(project.db, {
      id: "greeting",
      messages: [
        {
          id: "msg-en",
          bundleId: "greeting",
          locale: "en",
          variants: [
            {
              id: "v-en",
              messageId: "msg-en",
              matches: [],
              pattern: [
                { type: "text", value: "Hello " },
                { type: "expression", arg: { type: "variable-reference", name: "name" } },
                { type: "text", value: "!" },
              ],
            },
          ],
        },
      ],
    })

    // 1. Scan
    const scanOutput = await generateScanOutput("test-project", project, defaultConfig)
    expect(scanOutput.batches).toHaveLength(1)
    const bundle = scanOutput.batches[0]!.bundles[0]!
    expect(bundle.id).toBe("greeting")
    expect(bundle.targetLocales).toEqual([{ locale: "de", existingMessageId: null }])

    // 2. Simulate agent: produce translation (only text nodes changed)
    const sourceVariant = bundle.sourceVariants[0]!
    const translatedVariant = {
      matches: sourceVariant.matches,
      pattern: sourceVariant.pattern.map((node) =>
        node.type === "text" ? { ...node, value: node.value === "Hello " ? "Hallo " : "!" } : node
      ),
    }

    // 3. Validate
    expect(() =>
      validateTranslations({
        translations: [
          {
            bundleId: bundle.id,
            locale: "de",
            sourceVariants: bundle.sourceVariants,
            variants: [translatedVariant],
          },
        ],
      })
    ).not.toThrow()

    // 4. Write
    await writeTranslations(project, {
      translations: [
        {
          bundleId: bundle.id,
          locale: "de",
          declarations: bundle.declarations,
          selectors: bundle.selectors,
          existingMessageId: bundle.targetLocales[0]!.existingMessageId,
          variants: [translatedVariant],
        },
      ],
    })

    // 5. Assert
    const result = await selectBundleNested(project.db)
      .where("bundle.id", "=", "greeting")
      .executeTakeFirstOrThrow()

    const deMessage = result.messages.find((m) => m.locale === "de")
    expect(deMessage).toBeDefined()
    expect(deMessage!.variants).toHaveLength(1)
    expect(deMessage!.variants[0]!.pattern[0]).toMatchObject({ type: "text", value: "Hallo " })
    expect(deMessage!.variants[0]!.pattern[1]).toMatchObject({ type: "expression" })
    expect(deMessage!.variants[0]!.pattern[2]).toMatchObject({ type: "text", value: "!" })

    // Source locale unchanged
    const enMessage = result.messages.find((m) => m.locale === "en")
    expect(enMessage!.variants[0]!.pattern[0]).toMatchObject({ value: "Hello " })
  })

  it("scan does not include the bundle again after write", async () => {
    const project = await loadProjectInMemory({
      blob: await newProject({ settings: { baseLocale: "en", locales: ["en", "de"] } }),
    })

    await insertBundleNested(project.db, {
      id: "btn",
      messages: [
        { id: "m-en", bundleId: "btn", locale: "en", variants: [{ id: "v-en", messageId: "m-en", matches: [], pattern: [{ type: "text", value: "Save" }] }] },
      ],
    })

    const before = await generateScanOutput("test-project", project, defaultConfig)
    expect(before.batches[0]!.bundles).toHaveLength(1)

    await writeTranslations(project, {
      translations: [
        { bundleId: "btn", locale: "de", declarations: [], selectors: [], existingMessageId: null, variants: [{ matches: [], pattern: [{ type: "text", value: "Speichern" }] }] },
      ],
    })

    const after = await generateScanOutput("test-project", project, defaultConfig)
    expect(after.batches).toHaveLength(0)
  })
})
