import { describe, it, expect } from "vitest";
import { extractJson } from "./jsonExtractor.js";

describe("extractJson", () => {
  it("parses clean JSON object", () => {
    expect(extractJson('{"fr":["hello"]}')).toEqual({ fr: ["hello"] });
  });

  it("strips ```json fences", () => {
    expect(extractJson("```json\n{\"fr\":[\"hello\"]}\n```")).toEqual({ fr: ["hello"] });
  });

  it("strips ``` fences (no language specifier)", () => {
    expect(extractJson("```\n{\"fr\":[\"hello\"]}\n```")).toEqual({ fr: ["hello"] });
  });

  it("extracts JSON from preamble text", () => {
    expect(extractJson('Here is the translation: {"fr":["hello"]}')).toEqual({ fr: ["hello"] });
  });

  it("extracts JSON from postamble text", () => {
    expect(extractJson('{"fr":["hello"]} Hope that helps!')).toEqual({ fr: ["hello"] });
  });

  it("removes trailing commas before }", () => {
    expect(extractJson('{"fr":["hello"],}')).toEqual({ fr: ["hello"] });
  });

  it("removes trailing commas before ]", () => {
    expect(extractJson('{"fr":["hello",]}')).toEqual({ fr: ["hello"] });
  });

  it("replaces single quotes with double quotes", () => {
    expect(extractJson("{'fr':['hello']}")).toEqual({ fr: ["hello"] });
  });

  it("throws on input with no JSON-like content", () => {
    expect(() => extractJson("Here is your translation!")).toThrow();
  });

  it("throws on mismatched bracket types after extraction", () => {
    // '[' opens but no ']' exists — balanced scan finds no closing bracket
    expect(() => extractJson("[1, 2, 3}")).toThrow("No closing bracket found");
  });

  it("handles combination of fences + trailing comma + single quotes", () => {
    expect(extractJson("```json\n{'fr':['hello',]}\n```")).toEqual({ fr: ["hello"] });
  });

  it("handles JSON values containing bracket characters in strings", () => {
    expect(extractJson('{"key": "press {enter}"}')).toEqual({ key: "press {enter}" });
  });

  it("does not corrupt apostrophes in double-quoted string values", () => {
    expect(extractJson('{"fr":"it\'s a test"}')).toEqual({ fr: "it's a test" });
  });

  it("does not corrupt apostrophes in nested array values", () => {
    expect(extractJson('{"fr":["it\'s fine","don\'t stop"]}')).toEqual({
      fr: ["it's fine", "don't stop"],
    });
  });

  // Known limitation: the single-quote fallback is a global replace. When the
  // outer delimiters are single quotes AND a value contains an apostrophe, the
  // fallback corrupts the value. This test documents the known failure mode.
  it("fallback corrupts apostrophes inside single-quoted values (known limitation)", () => {
    // {'fr': "it's done"} — first parse fails (single-quoted key), fallback
    // applies global replace producing {"fr": "it"s done"} which also fails.
    expect(() => extractJson("{'fr': \"it's done\"}")).toThrow();
  });
});
