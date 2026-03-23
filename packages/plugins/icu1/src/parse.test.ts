import { describe, expect, it } from "vitest";
import { parseMessage } from "./parse.js";
import type { Declaration, Match, Pattern, VariantImport } from "@inlang/sdk";

const baseArgs = {
  bundleId: "bundle",
  locale: "en",
};

describe("parseMessage", () => {
  it("parses text and arguments", () => {
    const parsed = parseMessage({
      ...baseArgs,
      messageSource: "Hello {name}!",
    });

    expect(parsed.declarations).toEqual([
      { type: "input-variable", name: "name" },
    ] satisfies Declaration[]);
    expect(parsed.selectors).toEqual([]);
    expect(parsed.variants).toEqual([
      {
        messageBundleId: "bundle",
        messageLocale: "en",
        matches: [],
        pattern: [
          { type: "text", value: "Hello " },
          {
            type: "expression",
            arg: { type: "variable-reference", name: "name" },
          },
          { type: "text", value: "!" },
        ],
      },
    ] satisfies VariantImport[]);
  });

  it("parses select cases", () => {
    const parsed = parseMessage({
      ...baseArgs,
      messageSource: "{gender, select, male {He} female {She} other {They}}",
    });

    expect(parsed.declarations).toEqual(
      expect.arrayContaining([
        { type: "input-variable", name: "gender" },
      ] satisfies Declaration[]),
    );
    expect(parsed.selectors).toEqual([
      { type: "variable-reference", name: "gender" },
    ]);

    const matches = parsed.variants.map((variant) => variant.matches ?? []);
    expect(matches).toEqual(
      expect.arrayContaining([
        [{ type: "literal-match", key: "gender", value: "male" }],
        [{ type: "literal-match", key: "gender", value: "female" }],
        [{ type: "catchall-match", key: "gender" }],
      ]),
    );
  });

  it("declares selector inputs without interpolation", () => {
    const parsed = parseMessage({
      ...baseArgs,
      messageSource: "{count, plural, one {item} other {items}}",
    });

    expect(parsed.declarations).toEqual(
      expect.arrayContaining([
        { type: "input-variable", name: "count" },
      ] satisfies Declaration[]),
    );
  });

  it("parses plurals with offset, exact, and pound", () => {
    const parsed = parseMessage({
      ...baseArgs,
      messageSource:
        "{count, plural, offset:1 =0 {no items} one {# item} other {# items}}",
    });

    expect(parsed.declarations).toEqual(
      expect.arrayContaining([
        { type: "input-variable", name: "count" },
        {
          type: "local-variable",
          name: "countPluralOffset1",
          value: {
            type: "expression",
            arg: { type: "variable-reference", name: "count" },
            annotation: {
              type: "function-reference",
              name: "plural",
              options: [
                { name: "offset", value: { type: "literal", value: "1" } },
              ],
            },
          },
        },
      ] satisfies Declaration[]),
    );

    expect(parsed.selectors).toEqual([
      { type: "variable-reference", name: "countPluralOffset1" },
    ]);

    const matches = parsed.variants.map((variant) => variant.matches ?? []);
    expect(matches).toEqual(
      expect.arrayContaining([
        [{ type: "literal-match", key: "countPluralOffset1", value: "0" }],
        [{ type: "literal-match", key: "countPluralOffset1", value: "one" }],
        [{ type: "catchall-match", key: "countPluralOffset1" }],
      ]),
    );

    const pattern = parsed.variants.find((variant) =>
      (variant.matches ?? []).some(
        (match: Match) =>
          match.type === "literal-match" && match.value === "one",
      ),
    )?.pattern as Pattern;

    expect(pattern).toEqual([
      {
        type: "expression",
        arg: { type: "variable-reference", name: "count" },
        annotation: {
          type: "function-reference",
          name: "icu:pound",
          options: [],
        },
      },
      { type: "text", value: " item" },
    ]);
  });

  it("parses selectordinal", () => {
    const parsed = parseMessage({
      ...baseArgs,
      messageSource:
        "{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}",
    });

    expect(parsed.declarations).toEqual(
      expect.arrayContaining([
        { type: "input-variable", name: "place" },
        {
          type: "local-variable",
          name: "placeOrdinal",
          value: {
            type: "expression",
            arg: { type: "variable-reference", name: "place" },
            annotation: {
              type: "function-reference",
              name: "plural",
              options: [
                { name: "type", value: { type: "literal", value: "ordinal" } },
              ],
            },
          },
        },
      ] satisfies Declaration[]),
    );
  });

  it("avoids local variable name collisions with input variables", () => {
    const parsed = parseMessage({
      ...baseArgs,
      messageSource: "{countPlural} {count, plural, one {one} other {other}}",
    });

    expect(parsed.declarations).toEqual(
      expect.arrayContaining([
        { type: "input-variable", name: "countPlural" },
        expect.objectContaining({
          type: "local-variable",
          name: "countPlural1",
        }),
      ] satisfies Declaration[]),
    );
    expect(parsed.selectors).toEqual([
      { type: "variable-reference", name: "countPlural1" },
    ]);
  });

  it("parses function arguments with style", () => {
    const parsed = parseMessage({
      ...baseArgs,
      messageSource: "The time is {when, time, short}.",
    });

    const pattern = parsed.variants[0]?.pattern as Pattern;
    expect(pattern[1]).toEqual({
      type: "expression",
      arg: { type: "variable-reference", name: "when" },
      annotation: {
        type: "function-reference",
        name: "time",
        options: [
          { name: "style", value: { type: "literal", value: "short" } },
        ],
      },
    });
  });

  it("parses nested selects", () => {
    const parsed = parseMessage({
      ...baseArgs,
      messageSource:
        "{season, select, spring {{day, select, sunny {Sun} other {Cloud}}} other {Any}}",
    });

    expect(parsed.selectors).toEqual([
      { type: "variable-reference", name: "season" },
      { type: "variable-reference", name: "day" },
    ]);
  });
});
