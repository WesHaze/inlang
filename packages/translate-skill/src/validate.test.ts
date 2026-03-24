import { describe, expect, it } from "vitest"
import { validateTranslations } from "./validate.js"

const sourceVariants = [
  {
    matches: [],
    pattern: [
      { type: "text" as const, value: "Hello " },
      { type: "expression" as const, arg: { type: "variable-reference" as const, name: "name" } },
    ],
  },
]

describe("validateTranslations", () => {
  it("passes a valid translation", () => {
    expect(() =>
      validateTranslations({
        translations: [
          {
            bundleId: "welcome",
            locale: "fr",
            sourceVariants,
            variants: [
              {
                matches: [],
                pattern: [
                  { type: "text" as const, value: "Bonjour " },
                  { type: "expression" as const, arg: { type: "variable-reference" as const, name: "name" } },
                ],
              },
            ],
          },
        ],
      })
    ).not.toThrow()
  })

  it("throws when variant count differs from source", () => {
    expect(() =>
      validateTranslations({
        translations: [
          {
            bundleId: "welcome",
            locale: "fr",
            sourceVariants,
            variants: [
              { matches: [], pattern: [{ type: "text" as const, value: "Bonjour " }] },
              { matches: [], pattern: [{ type: "text" as const, value: "extra" }] },
            ],
          },
        ],
      })
    ).toThrow("variant count")
  })

  it("throws when a node type differs from source node type", () => {
    expect(() =>
      validateTranslations({
        translations: [
          {
            bundleId: "welcome",
            locale: "fr",
            sourceVariants,
            variants: [
              {
                matches: [],
                pattern: [
                  { type: "text" as const, value: "Bonjour " },
                  { type: "text" as const, value: "wrong — should be expression" },
                ],
              },
            ],
          },
        ],
      })
    ).toThrow("node 1 type changed from 'expression' to 'text'")
  })

  it("throws when pattern fails typebox schema", () => {
    expect(() =>
      validateTranslations({
        translations: [
          {
            bundleId: "welcome",
            locale: "fr",
            sourceVariants: [{ matches: [], pattern: [{ type: "text" as const, value: "Hello" }] }],
            variants: [
              {
                matches: [],
                // @ts-expect-error — intentional invalid data
                pattern: [{ type: "invalid-node-type", value: "Bonjour" }],
              },
            ],
          },
        ],
      })
    ).toThrow()
  })

  it("throws when translated pattern has more nodes than source", () => {
    expect(() =>
      validateTranslations({
        translations: [
          {
            bundleId: "welcome",
            locale: "fr",
            sourceVariants: [{ matches: [], pattern: [{ type: "text" as const, value: "Hello" }] }],
            variants: [
              {
                matches: [],
                pattern: [
                  { type: "text" as const, value: "Bonjour" },
                  { type: "text" as const, value: " extra node" },
                ],
              },
            ],
          },
        ],
      })
    ).toThrow("node count mismatch")
  })

  it("includes bundle id and locale in error message", () => {
    expect(() =>
      validateTranslations({
        translations: [
          {
            bundleId: "my-bundle",
            locale: "de",
            sourceVariants: [{ matches: [], pattern: [{ type: "text" as const, value: "Hello" }] }],
            variants: [],
          },
        ],
      })
    ).toThrow("my-bundle")
  })
})
