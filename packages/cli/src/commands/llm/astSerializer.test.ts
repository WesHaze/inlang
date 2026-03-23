import { describe, expect, it } from "vitest";
import {
  serializePattern,
  validateTranslatedPattern,
  rebuildPatternFromString,
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

describe("rebuildPatternFromString", () => {
  it("wraps a plain string as a single text node when source has no variables", () => {
    const source: Pattern = [{ type: "text", value: "Save" }];
    const result = rebuildPatternFromString("Opslaan", source);
    expect(result).toEqual([{ type: "text", value: "Opslaan" }]);
  });

  it("reconstructs [text, expr, text] when variable is in the middle", () => {
    // "Hello {name}!" → "Hallo {name}!"
    const source: Pattern = [
      { type: "text", value: "Hello " },
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
      { type: "text", value: "!" },
    ];
    const result = rebuildPatternFromString("Hallo {name}!", source);
    expect(result).toEqual([
      { type: "text", value: "Hallo " },
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
      { type: "text", value: "!" },
    ]);
  });

  it("reconstructs [text, expr] when variable is at the end — trailing empty text", () => {
    // "Remove {label}" → "Entfernen {label}"
    const source: Pattern = [
      { type: "text", value: "Remove " },
      { type: "expression", arg: { type: "variable-reference", name: "label" } },
    ];
    const result = rebuildPatternFromString("Entfernen {label}", source);
    expect(result).toEqual([
      { type: "text", value: "Entfernen " },
      { type: "expression", arg: { type: "variable-reference", name: "label" } },
    ]);
  });

  it("reconstructs [expr, text] when variable is at the start — leading empty text", () => {
    // "{count}/2000" stays "{count}/2000" but translated text part may change
    const source: Pattern = [
      { type: "expression", arg: { type: "variable-reference", name: "count" } },
      { type: "text", value: "/2000" },
    ];
    const result = rebuildPatternFromString("{count}/2000", source);
    expect(result).toEqual([
      { type: "expression", arg: { type: "variable-reference", name: "count" } },
      { type: "text", value: "/2000" },
    ]);
  });

  it("reconstructs multi-variable pattern [text, expr, text, expr, text]", () => {
    // "From {start} to {end}" → "Von {start} bis {end}"
    const source: Pattern = [
      { type: "text", value: "From " },
      { type: "expression", arg: { type: "variable-reference", name: "start" } },
      { type: "text", value: " to " },
      { type: "expression", arg: { type: "variable-reference", name: "end" } },
      { type: "text", value: "." },
    ];
    const result = rebuildPatternFromString("Von {start} bis {end}.", source);
    expect(result).toEqual([
      { type: "text", value: "Von " },
      { type: "expression", arg: { type: "variable-reference", name: "start" } },
      { type: "text", value: " bis " },
      { type: "expression", arg: { type: "variable-reference", name: "end" } },
      { type: "text", value: "." },
    ]);
  });

  it("inserts source expression node even when LLM dropped the variable from the string", () => {
    // LLM returned "Entfernen" — forgot to include {label}
    const source: Pattern = [
      { type: "text", value: "Remove " },
      { type: "expression", arg: { type: "variable-reference", name: "label" } },
    ];
    const result = rebuildPatternFromString("Entfernen", source);
    // Expression is preserved from source; trailing text is empty
    expect(result).toEqual([
      { type: "text", value: "Entfernen" },
      { type: "expression", arg: { type: "variable-reference", name: "label" } },
    ]);
  });

  it("result length always matches source length", () => {
    const source: Pattern = [
      { type: "text", value: "Hello " },
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
      { type: "text", value: ", welcome back!" },
    ];
    const cases = [
      "Hallo {name}, willkommen zurück!",
      "Hallo {name}",   // trailing text missing
      "Hallo",          // variable dropped
    ];
    for (const str of cases) {
      expect(rebuildPatternFromString(str, source)).toHaveLength(source.length);
    }
  });

  it("handles emoji and symbols directly adjacent to {varName} with no whitespace", () => {
    // e.g. source "🍆{name}" — emoji immediately before variable, no space
    const source: Pattern = [
      { type: "text", value: "🍆" },
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
    ];
    const result = rebuildPatternFromString("🍆{name}", source);
    expect(result).toEqual([
      { type: "text", value: "🍆" },
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
    ]);
    expect(validateTranslatedPattern(source, result).valid).toBe(true);
  });

  it("handles symbol immediately after {varName} with no whitespace", () => {
    // e.g. source "{count}%" — percent sign directly after variable
    const source: Pattern = [
      { type: "expression", arg: { type: "variable-reference", name: "count" } },
      { type: "text", value: "%" },
    ];
    const result = rebuildPatternFromString("{count}%", source);
    expect(result).toEqual([
      { type: "expression", arg: { type: "variable-reference", name: "count" } },
      { type: "text", value: "%" },
    ]);
    expect(validateTranslatedPattern(source, result).valid).toBe(true);
  });

  it("result passes validateTranslatedPattern after rebuild", () => {
    const source: Pattern = [
      { type: "text", value: "Remove " },
      { type: "expression", arg: { type: "variable-reference", name: "label" } },
    ];
    const rebuilt = rebuildPatternFromString("Entfernen {label}", source);
    const validation = validateTranslatedPattern(source, rebuilt);
    expect(validation.valid).toBe(true);
  });
});

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
    expect((result as any).error).toMatch(/changed type/);
  });

  it("allows leading text node to become empty (word-order shift in target language)", () => {
    // e.g. "Hello {name}!" → "{name} hallo!" where leading "Hello " disappears
    const translated = [
      { type: "text", value: "" },
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
      { type: "text", value: "!" },
    ];
    const result = validateTranslatedPattern(sourceWithExpression, translated);
    expect(result.valid).toBe(true);
  });

  it("allows trailing text node to become empty (word-order shift in target language)", () => {
    // e.g. "Last updated {t} ago" → "Mis à jour il y a {t}" where trailing " ago" disappears
    const translated = [
      { type: "text", value: "Bonjour " },
      { type: "expression", arg: { type: "variable-reference", name: "name" } },
      { type: "text", value: "" },
    ];
    const result = validateTranslatedPattern(sourceWithExpression, translated);
    expect(result.valid).toBe(true);
  });

  it("returns invalid when an interior text node becomes empty", () => {
    // Interior nodes (not first/last) must stay non-empty
    const sourceInterior: Pattern = [
      { type: "expression", arg: { type: "variable-reference", name: "a" } },
      { type: "text", value: " and " },
      { type: "expression", arg: { type: "variable-reference", name: "b" } },
    ];
    const translated = [
      { type: "expression", arg: { type: "variable-reference", name: "a" } },
      { type: "text", value: "" },
      { type: "expression", arg: { type: "variable-reference", name: "b" } },
    ];
    const result = validateTranslatedPattern(sourceInterior, translated);
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

  it("EDGE: empty source text node with non-string LLM value is rejected", () => {
    const translated = [
      { type: "expression", arg: { type: "variable-reference", name: "a" } },
      { type: "text", value: 42 }, // number instead of string — must fail
      { type: "expression", arg: { type: "variable-reference", name: "b" } },
    ];
    const result = validateTranslatedPattern(sourceWithEmptyText, translated);
    expect(result.valid).toBe(false);
    expect((result as any).error).toMatch(/not a string/);
  });

  it("EDGE: unknown node type is deep-compared and passes when identical to source", () => {
    const unknownNode = { type: "future-node-type", data: "x" };
    const source: Pattern = [unknownNode as any];
    const translated = [{ type: "future-node-type", data: "x" }];
    const result = validateTranslatedPattern(source, translated);
    expect(result.valid).toBe(true);
  });

  it("EDGE: unknown node type fails when modified by LLM", () => {
    const unknownNode = { type: "future-node-type", data: "x" };
    const source: Pattern = [unknownNode as any];
    const translated = [{ type: "future-node-type", data: "CHANGED" }];
    const result = validateTranslatedPattern(source, translated);
    expect(result.valid).toBe(false);
  });

  it("accepts markup nodes where LLM reorders JSON keys", () => {
    // Source: { type: "markup-start", name: "b" }
    // LLM returns same data but with keys in different order: { name: "b", type: "markup-start" }
    const translated = [
      { type: "text", value: "Klik " },
      { name: "b", type: "markup-start" }, // keys reordered by LLM
      { type: "text", value: "hier" },
      { name: "b", type: "markup-end" },   // keys reordered by LLM
    ];
    const result = validateTranslatedPattern(sourceWithMarkup, translated);
    expect(result.valid).toBe(true);
  });
});
