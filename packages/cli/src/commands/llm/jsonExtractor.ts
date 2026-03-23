/**
 * Extracts and parses a JSON value from a raw LLM response string.
 *
 * Applies a normalization pipeline before parsing:
 * 1. Trim
 * 2. Strip markdown fences (```json or ```)
 * 3. Extract the first JSON object or array substring (discards preamble/postamble)
 * 4. Remove trailing commas
 * 5. Replace single quotes with double quotes (best-effort)
 * 6. JSON.parse
 *
 * Throws if the content cannot be salvaged.
 */
export function extractJson(raw: string): unknown {
  // Step 1: Trim
  let s = raw.trim();

  // Step 2: Strip markdown fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  // Step 3: Extract JSON substring using balanced bracket scan
  const start = s.search(/[{[]/);
  if (start === -1) {
    throw new Error(`No JSON object or array found in LLM response: ${s.slice(0, 100)}`);
  }
  const openChar = s[start] as "{" | "[";
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    if (s[i] === openChar) depth++;
    else if (s[i] === closeChar) {
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

  // Step 5: Replace single quotes with double quotes (best-effort)
  s = s.replace(/'/g, '"');

  // Step 6: Parse
  return JSON.parse(s);
}
