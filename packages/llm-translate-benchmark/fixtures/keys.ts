import type { NewBundleNested } from "@inlang/sdk";

/**
 * Generates 1000 NewBundleNested fixture keys in en-gb covering realistic
 * i18n patterns. Edge cases are marked with an EDGE comment.
 */
export function generateFixtureKeys(): NewBundleNested[] {
  const keys: NewBundleNested[] = [];
  let seq = 0;

  function id(prefix: string): string {
    seq++;
    return `${prefix}_${String(seq).padStart(4, "0")}`;
  }

  function bundle(
    bundleId: string,
    pattern: NewBundleNested["messages"][0]["variants"][0]["pattern"],
  ): NewBundleNested {
    const msgId = `${bundleId}_msg`;
    const varId = `${bundleId}_var`;
    return {
      id: bundleId,
      messages: [
        {
          id: msgId,
          bundleId,
          locale: "en-gb",
          variants: [
            {
              id: varId,
              messageId: msgId,
              pattern,
            },
          ],
        },
      ],
    };
  }

  // ── Simple text (300) ────────────────────────────────────────────────────
  const simpleTexts = [
    "Save changes",
    "Cancel",
    "Delete",
    "Confirm",
    "Submit",
    "Back",
    "Next",
    "Previous",
    "Close",
    "Open",
    "Search",
    "Filter",
    "Sort",
    "Export",
    "Import",
    "Download",
    "Upload",
    "Copy",
    "Paste",
    "Undo",
    "Redo",
    "Select all",
    "Deselect",
    "Refresh",
    "Reload",
    "Reset",
    "Clear",
    "Apply",
    "OK",
    "Yes",
    "No",
    "Maybe",
    "Continue",
    "Finish",
    "Done",
    "Loading",
    "Please wait",
    "Processing",
    "Error",
    "Warning",
    "Info",
    "Success",
    "Failure",
    "Not found",
    "Forbidden",
    "Unauthorised",
    "Timeout",
    "Retry",
    "Ignore",
  ];
  for (let i = 0; i < 300; i++) {
    const text = simpleTexts[i % simpleTexts.length]! + (i >= simpleTexts.length ? ` (${Math.floor(i / simpleTexts.length)})` : "");
    keys.push(bundle(id("simple"), [{ type: "text", value: text }]));
  }

  // ── Single variable (250) ────────────────────────────────────────────────
  const singleVarTemplates: Array<[string, string, string]> = [
    ["Hello, ", "name", "!"],
    ["Welcome back, ", "username", "."],
    ["Signed in as ", "email", "."],
    ["Last updated by ", "user", "."],
    ["Assigned to ", "assignee", "."],
    ["Owned by ", "owner", "."],
    ["Created by ", "author", "."],
    ["Sorted by ", "field", "."],
    ["Filtered by ", "category", "."],
    ["Searching for ", "query", "..."],
  ];
  for (let i = 0; i < 250; i++) {
    const [before, varName, after] =
      singleVarTemplates[i % singleVarTemplates.length]!;
    keys.push(
      bundle(id("single_var"), [
        { type: "text", value: before },
        { type: "expression", arg: { type: "variable-reference", name: varName } },
        { type: "text", value: after },
      ]),
    );
  }

  // ── Multi-variable (150) ─────────────────────────────────────────────────
  const multiVarTemplates: Array<Array<{ t?: string; v?: string }>> = [
    [{ t: "" }, { v: "firstName" }, { t: " " }, { v: "lastName" }, { t: " is logged in." }],
    [{ t: "From " }, { v: "start" }, { t: " to " }, { v: "end" }, { t: "." }],
    [{ t: "Showing " }, { v: "from" }, { t: "–" }, { v: "to" }, { t: " of " }, { v: "total" }, { t: " results." }],
    [{ t: "File " }, { v: "filename" }, { t: " uploaded to " }, { v: "folder" }, { t: "." }],
    [{ t: "Move " }, { v: "item" }, { t: " from " }, { v: "source" }, { t: " to " }, { v: "destination" }, { t: "." }],
  ];
  for (let i = 0; i < 150; i++) {
    const template = multiVarTemplates[i % multiVarTemplates.length]!;
    const pattern = template.map((seg) =>
      seg.v
        ? { type: "expression" as const, arg: { type: "variable-reference" as const, name: seg.v } }
        : { type: "text" as const, value: seg.t! },
    );
    keys.push(bundle(id("multi_var"), pattern));
  }

  // ── Count variable / plural-adjacent (100) ───────────────────────────────
  const countTemplates: Array<[string, string]> = [
    ["You have ", " unread messages."],
    ["", " items selected."],
    ["Showing ", " results."],
    ["", " errors found."],
    ["Download ", " files."],
  ];
  for (let i = 0; i < 100; i++) {
    const [before, after] = countTemplates[i % countTemplates.length]!;
    keys.push(
      bundle(id("count"), [
        ...(before ? [{ type: "text" as const, value: before }] : []),
        { type: "expression", arg: { type: "variable-reference", name: "count" } },
        { type: "text", value: after },
      ]),
    );
  }

  // ── Markup nodes (80) ────────────────────────────────────────────────────
  const markupTemplates = [
    () => [
      { type: "text" as const, value: "Click " },
      { type: "markup-start" as const, name: "b" },
      { type: "text" as const, value: "here" },
      { type: "markup-end" as const, name: "b" },
      { type: "text" as const, value: " to continue." },
    ],
    () => [
      { type: "markup-start" as const, name: "em" },
      { type: "text" as const, value: "Important:" },
      { type: "markup-end" as const, name: "em" },
      { type: "text" as const, value: " please read carefully." },
    ],
    () => [
      { type: "text" as const, value: "Visit " },
      { type: "markup-start" as const, name: "a" },
      { type: "text" as const, value: "our website" },
      { type: "markup-end" as const, name: "a" },
      { type: "text" as const, value: " for more info." },
    ],
    () => [
      { type: "text" as const, value: "Press " },
      { type: "markup-standalone" as const, name: "kbd", options: [] },
      { type: "text" as const, value: " to search." },
    ],
  ];
  for (let i = 0; i < 80; i++) {
    keys.push(bundle(id("markup"), markupTemplates[i % markupTemplates.length]!()));
  }

  // ── Long strings > 100 chars with variables (70) ─────────────────────────
  const longTemplates: Array<Array<{ t?: string; v?: string }>> = [
    [
      { t: "Your booking for " },
      { v: "nights" },
      { t: " nights at " },
      { v: "property" },
      { t: " has been confirmed. A confirmation email has been sent to " },
      { v: "email" },
      { t: "." },
    ],
    [
      { t: "The export of " },
      { v: "count" },
      { t: " records has been scheduled. You will receive a notification at " },
      { v: "email" },
      { t: " when it is ready to download." },
    ],
    [
      { t: "An error occurred while processing your request for " },
      { v: "resource" },
      { t: ". Please try again or contact support at " },
      { v: "supportEmail" },
      { t: " if the issue persists." },
    ],
  ];
  for (let i = 0; i < 70; i++) {
    const template = longTemplates[i % longTemplates.length]!;
    const pattern = template.map((seg) =>
      seg.v
        ? { type: "expression" as const, arg: { type: "variable-reference" as const, name: seg.v } }
        : { type: "text" as const, value: seg.t! },
    );
    keys.push(bundle(id("long"), pattern));
  }

  // ── Edge cases (50) ──────────────────────────────────────────────────────

  // EDGE: Variable at string start
  for (let i = 0; i < 8; i++) {
    keys.push(
      bundle(id("edge_var_start"), [
        { type: "expression", arg: { type: "variable-reference", name: "name" } },
        { type: "text", value: " has joined the session." },
      ]),
    );
  }

  // EDGE: Variable at string end
  for (let i = 0; i < 8; i++) {
    keys.push(
      bundle(id("edge_var_end"), [
        { type: "text", value: "Welcome back, " },
        { type: "expression", arg: { type: "variable-reference", name: "name" } },
      ]),
    );
  }

  // EDGE: Adjacent variables with no text between
  for (let i = 0; i < 8; i++) {
    keys.push(
      bundle(id("edge_adjacent_vars"), [
        { type: "expression", arg: { type: "variable-reference", name: "firstName" } },
        { type: "text", value: " " }, // single space — minimal text between
        { type: "expression", arg: { type: "variable-reference", name: "lastName" } },
      ]),
    );
  }

  // EDGE: Variable-only pattern (no text nodes)
  for (let i = 0; i < 8; i++) {
    keys.push(
      bundle(id("edge_var_only"), [
        { type: "expression", arg: { type: "variable-reference", name: "count" } },
      ]),
    );
  }

  // EDGE: Empty text node between two expressions
  for (let i = 0; i < 9; i++) {
    keys.push(
      bundle(id("edge_empty_text"), [
        { type: "expression", arg: { type: "variable-reference", name: "a" } },
        { type: "text", value: "" }, // intentionally empty
        { type: "expression", arg: { type: "variable-reference", name: "b" } },
      ]),
    );
  }

  // EDGE: Markup wrapping a variable
  for (let i = 0; i < 9; i++) {
    keys.push(
      bundle(id("edge_markup_var"), [
        { type: "markup-start", name: "b" },
        { type: "expression", arg: { type: "variable-reference", name: "count" } },
        { type: "markup-end", name: "b" },
        { type: "text", value: " items selected." },
      ]),
    );
  }

  return keys;
}
