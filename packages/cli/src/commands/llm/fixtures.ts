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
  // These templates test nuanced translation: tone shifts, subordinate clauses,
  // idioms, marketing register, legal phrasing, and complex grammar structure.
  const longTemplates: Array<Array<{ t?: string; v?: string }>> = [
    // Empathetic onboarding — warm tone, second-person address
    [
      { t: "We're so glad you joined us, " },
      { v: "name" },
      { t: ". Take a moment to explore your new workspace — everything has been set up just for you." },
    ],
    // Marketing CTA — persuasive, urgency without being pushy
    [
      { t: "Your free trial of " },
      { v: "planName" },
      { t: " ends in " },
      { v: "daysLeft" },
      { t: " days. Upgrade now to keep everything you've built and unlock unlimited collaborators." },
    ],
    // Legal/privacy — precise, passive voice, institutional tone
    [
      { t: "By continuing, you agree that " },
      { v: "companyName" },
      { t: " may process your personal data in accordance with its Privacy Policy, which was last updated on " },
      { v: "updateDate" },
      { t: "." },
    ],
    // Empathetic error — apology with actionable next step
    [
      { t: "We're sorry, but your payment of " },
      { v: "amount" },
      { t: " could not be processed. Please check your billing details or contact your bank — your work has been saved and nothing has been lost." },
    ],
    // Success with consequence — cause-and-effect sentence structure
    [
      { t: "Great news! " },
      { v: "name" },
      { t: " accepted your invitation to " },
      { v: "workspaceName" },
      { t: " and can now view and edit all shared projects." },
    ],
    // Conditional / hypothetical — subjunctive-adjacent phrasing
    [
      { t: "If you did not request a password reset, please ignore this email — your account is safe and no changes have been made to " },
      { v: "email" },
      { t: "." },
    ],
    // Relative clause — complex grammar that reorders in many languages
    [
      { t: "The report that " },
      { v: "author" },
      { t: " submitted on " },
      { v: "date" },
      { t: " is currently under review and will be published once all approvals are in place." },
    ],
    // Idiomatic encouragement — tone matters most, literal translation fails
    [
      { t: "You're on a roll! You've completed " },
      { v: "count" },
      { t: " tasks this week — keep it up and you'll hit your monthly goal ahead of schedule." },
    ],
    // Formal notification — passive, institutional, bureaucratic register
    [
      { t: "Please be advised that your subscription to " },
      { v: "planName" },
      { t: " will renew automatically on " },
      { v: "renewalDate" },
      { t: ". To cancel, visit your billing settings at least 24 hours before the renewal date." },
    ],
    // Sensitive / supportive — mental-health adjacent, careful wording
    [
      { t: "It looks like you've been working for a while, " },
      { v: "name" },
      { t: ". Remember to take a break — stepping away for a few minutes can help you come back with fresh eyes." },
    ],
    // Technical explanation — precise but accessible
    [
      { t: "Your file " },
      { v: "filename" },
      { t: " exceeds the maximum upload size of " },
      { v: "maxSize" },
      { t: " MB. Try compressing the file or splitting it into smaller parts before uploading." },
    ],
    // Social proof / community framing
    [
      { t: "Join " },
      { v: "count" },
      { t: " teams who already use " },
      { v: "productName" },
      { t: " to ship faster, collaborate without friction, and keep their work organised in one place." },
    ],
    // Concessive clause — "even though" structure
    [
      { t: "Even though your session expired, all your changes to " },
      { v: "documentName" },
      { t: " were saved automatically. Sign back in to pick up exactly where you left off." },
    ],
    // Passive + agent — complex syntactic structure
    [
      { t: "This document was last edited by " },
      { v: "editor" },
      { t: " on " },
      { v: "date" },
      { t: " and is currently locked for editing. Contact " },
      { v: "editor" },
      { t: " to request access." },
    ],
    // Rhetorical question → statement — register shift within one string
    [
      { t: "Not sure where to start? " },
      { v: "name" },
      { t: ", your personalised setup guide is ready — it covers the three steps that most teams complete in their first session." },
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

  // ── Emoji adjacent to variables (30) ─────────────────────────────────────
  // These test that emoji in text nodes survive LLM translation unchanged.
  // LLMs may drop, replace, or move emoji — especially when they sit directly
  // next to a variable placeholder.

  // Emoji before variable
  const emojiBeforeTemplates: Array<[string, string, string]> = [
    ["🎉 ", "name", " joined the team!"],
    ["🔔 ", "count", " new notifications"],
    ["📁 ", "filename", " was uploaded successfully."],
    ["🚨 ", "error", " — please try again."],
    ["👤 ", "username", " is now online."],
  ];
  for (let i = 0; i < 15; i++) {
    const [before, varName, after] = emojiBeforeTemplates[i % emojiBeforeTemplates.length]!;
    keys.push(
      bundle(id("emoji_before_var"), [
        { type: "text", value: before },
        { type: "expression", arg: { type: "variable-reference", name: varName } },
        { type: "text", value: after },
      ]),
    );
  }

  // Emoji after variable
  const emojiAfterTemplates: Array<[string, string, string]> = [
    ["You have ", "count", " unread messages ✉️"],
    ["Uploading ", "filename", " ⏳"],
    ["Welcome back, ", "name", " 👋"],
    ["Deleted ", "count", " items 🗑️"],
    ["Synced with ", "device", " ✅"],
  ];
  for (let i = 0; i < 15; i++) {
    const [before, varName, after] = emojiAfterTemplates[i % emojiAfterTemplates.length]!;
    keys.push(
      bundle(id("emoji_after_var"), [
        { type: "text", value: before },
        { type: "expression", arg: { type: "variable-reference", name: varName } },
        { type: "text", value: after },
      ]),
    );
  }

  return keys;
}
