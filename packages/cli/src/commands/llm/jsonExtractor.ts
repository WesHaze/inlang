/**
 * Extracts and parses a JSON value from a raw LLM response string.
 *
 * Applies a normalization pipeline before parsing:
 * 1. Trim
 * 2. Strip markdown fences (```json or ```)
 * 3. Extract the first JSON object or array substring (discards preamble/postamble)
 * 4. Remove trailing commas
 * 5+6. Try JSON.parse as-is; if it fails, apply a best-effort single-quote →
 *      double-quote substitution and try once more.
 *
 * **Known limitation of the fallback (step 5+6):** the single-quote substitution
 * is a global replace. It correctly handles LLM output that uses single-quoted
 * keys/values (e.g. `{'fr': ['hello']}`), but will corrupt apostrophes inside
 * values that are themselves single-quoted (e.g. `{'fr': "it's fine"}` becomes
 * `{"fr": "it"s fine"}`). This only affects the fallback path — valid JSON
 * (double-quoted) always takes the fast path and is never modified.
 *
 * Throws if the content cannot be salvaged.
 */
export function extractJson(raw: string): unknown {
  // Step 1: Trim
  let s = raw.trim();

  // Step 2: Strip markdown fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  // Step 3: Extract JSON substring using string-aware balanced bracket scan
  const start = s.search(/[{[]/);
  if (start === -1) {
    throw new Error(`No JSON object or array found in LLM response: ${s.slice(0, 100)}`);
  }
  const openChar = s[start] as "{" | "[";
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let stringDelimiter: string | null = null;
  let escaped = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (stringDelimiter !== null) {
      if (ch === stringDelimiter) stringDelimiter = null;
      continue;
    }
    if (ch === '"' || ch === "'") { stringDelimiter = ch; continue; }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) {
    throw new Error(`No closing bracket found for opening '${openChar}'`);
  }
  s = s.slice(start, end + 1);

  // Step 4: Remove trailing commas
  s = s.replace(/,(\s*[}\]])/g, "$1");

  // Step 5+6: Try to parse as-is first; only apply single-quote substitution
  // if the first attempt fails (avoids corrupting apostrophes in valid JSON values).
  try {
    return JSON.parse(s);
  } catch {
    // best-effort: replace bare single-quote delimiters with double quotes
    return JSON.parse(s.replace(/'/g, '"'));
  }
}
