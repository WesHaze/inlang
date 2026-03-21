import { describe, expect, it } from "vitest";
import {
  serializePattern,
  validateTranslatedPattern,
} from "./astSerializer.js";
import type { Pattern } from "@inlang/sdk";

// Simple source pattern with text and an expression
const sourceWithExpression: Pattern = [
  { type: "text", value: "Hello " },
  { type: "expression", arg: { type: "variable-reference", name: "name" } },
  { type: "text", value: "!" },
];

// Source with an empty text node between two expressions
const sourceWithEmptyText: Pattern = [
  { type: "expression", arg: { type: "variable-reference", name: "a" } },
  { type: "text", value: "" },
  { type: "expression", arg: { type: "variable-reference", name: "b" } },
];

// Source with markup nodes
const sourceWithMarkup: Pattern = [
  { type: "text", value: "Click " },
  { type: "markup-start", name: "b" },
  { type: "text", value: "here" },
  { type: "markup-end", name: "b" },
];

// Source with markup that has optional fields present
const sourceWithMarkupOptions: Pattern = [
  { type: "markup-standalone", name: "br", options: [], attributes: [] },
];

describe("serializePattern", () => {
  it("returns a JSON string of the pattern array", () => {
    const result = serializePattern([{ type: "text", value: "Hello" }]);
    expect(result).toBe('[{"type":"text","value":"Hello"}]');
  });
});

describe("validateTranslatedPattern", () => {
  it("returns invalid when translated is not an array", () => {
    const result = validateTranslatedPattern(sourceWithExpression, { type: "text", value: "Hi" });
    expect(result.valid).toBe(false);
  });

  it("returns invalid when array length differs", () => {
    const result = validateTranslatedPattern(sourceWithExpression, [
      { type: "text", value: "Hallo" },
    ]);
    expect(result.valid).toBe(false);
    expect((result as any).error).toMatch(/length/);
  });

  it("returns invalid when a non-text node is modified", () => {
    const translated = [
      { type: "text", value: "Hallo " },
      { type: "expression", arg: { type: "variable-reference", name: "WRONG" } },
      { type: "text", value: "!" },
    ];
    const result = validateTranslatedPattern(sourceWithExpression, translated);
    expect(result.valid).toBe(false);
    expect((result as any).error).toMatch(/Non-text node/);
  });

  it("returns invalid when a text node changes its type", () => {
    const translated = [
      { type: "expression", arg: { type: "variable-reference", name: "x" } },
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
      { type: "text", value: "!" },
    ];
    const result = validateTranslatedPattern(sourceWithExpression, translated);
    expect(result.valid).toBe(false);
  });

  it("returns invalid when a non-empty source text node becomes empty", () => {
    const translated = [
      { type: "text", value: "" },
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
      { type: "text", value: "!" },
    ];
    const result = validateTranslatedPattern(sourceWithExpression, translated);
    expect(result.valid).toBe(false);
    expect((result as any).error).toMatch(/empty/);
  });

  it("EDGE: allows empty source text node to remain empty in translation", () => {
    const translated = [
      { type: "expression", arg: { type: "variable-reference", name: "a" } },
      { type: "text", value: "" },
      { type: "expression", arg: { type: "variable-reference", name: "b" } },
    ];
    const result = validateTranslatedPattern(sourceWithEmptyText, translated);
    expect(result.valid).toBe(true);
  });

  it("accepts a correctly translated pattern with expression", () => {
    const translated = [
      { type: "text", value: "Hallo " },
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
      { type: "text", value: "!" },
    ];
    const result = validateTranslatedPattern(sourceWithExpression, translated);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.pattern).toEqual(translated);
    }
  });

  it("accepts markup nodes where optional fields differ (undefined vs [])", () => {
    const translated = [
      { type: "text", value: "Klik " },
      { type: "markup-start", name: "b", options: [], attributes: [] },
      { type: "text", value: "hier" },
      { type: "markup-end", name: "b", options: [], attributes: [] },
    ];
    const result = validateTranslatedPattern(sourceWithMarkup, translated);
    expect(result.valid).toBe(true);
  });

  it("accepts markup-standalone with options normalised", () => {
    const translated = [{ type: "markup-standalone", name: "br" }];
    const result = validateTranslatedPattern(sourceWithMarkupOptions, translated);
    expect(result.valid).toBe(true);
  });

  it("EDGE: returns invalid when LLM returns null", () => {
    const result = validateTranslatedPattern(sourceWithExpression, null);
    expect(result.valid).toBe(false);
  });
});
