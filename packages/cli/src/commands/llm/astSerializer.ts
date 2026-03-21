import type { Pattern } from "@inlang/sdk";

export type ValidateResult =
  | { valid: true; pattern: Pattern }
  | { valid: false; error: string };

/**
 * Serializes a Pattern to a JSON string for inclusion in an LLM prompt.
 */
export function serializePattern(pattern: Pattern): string {
  return JSON.stringify(pattern);
}

/**
 * Normalizes markup node optional fields so that `undefined` and `[]` are
 * treated as equivalent during deep-equality checks.
 */
function normalizeNode(node: unknown): unknown {
  if (typeof node !== "object" || node === null) return node;
  const n = node as Record<string, unknown>;
  const type = n["type"];
  if (
    type === "markup-start" ||
    type === "markup-end" ||
    type === "markup-standalone"
  ) {
    return {
      ...n,
      options: Array.isArray(n["options"]) ? n["options"] : [],
      attributes: Array.isArray(n["attributes"]) ? n["attributes"] : [],
    };
  }
  return n;
}

function nodesDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeNode(a)) === JSON.stringify(normalizeNode(b));
}

/**
 * Validates a translated pattern array returned by the LLM against the
 * original source pattern. Returns the validated Pattern on success.
 *
 * Validation rules:
 * 1. Must be an array
 * 2. Length must equal source length
 * 3. Non-text nodes must deep-equal source (markup optional fields normalised)
 * 4. Text node type must remain "text"
 * 5. Non-empty source text nodes must remain non-empty
 * 6. Empty source text nodes may remain empty
 */
export function validateTranslatedPattern(
  source: Pattern,
  translated: unknown,
): ValidateResult {
  // Rule 1: must be an array
  if (!Array.isArray(translated)) {
    return { valid: false, error: "Response is not a JSON array" };
  }

  // Rule 2: length must match
  if (translated.length !== source.length) {
    return {
      valid: false,
      error: `Array length mismatch: expected ${source.length}, got ${translated.length}`,
    };
  }

  for (let i = 0; i < source.length; i++) {
    const src = source[i]!;
    const tgt = translated[i] as Record<string, unknown>;

    if (src.type !== "text") {
      // Rule 3: non-text nodes must be deep-equal (normalised)
      if (!nodesDeepEqual(src, tgt)) {
        return {
          valid: false,
          error: `Non-text node at index ${i} was modified by the LLM`,
        };
      }
      continue;
    }

    // Rule 4: text node type must remain "text"
    if (tgt["type"] !== "text") {
      return {
        valid: false,
        error: `Node at index ${i} changed type from "text" to "${tgt["type"]}"`,
      };
    }

    // Rule 5 + 6: non-empty source text nodes must remain non-empty
    const srcValue = (src as { type: "text"; value: string }).value;
    const tgtValue = tgt["value"];
    if (srcValue !== "" && (typeof tgtValue !== "string" || tgtValue === "")) {
      return {
        valid: false,
        error: `Text node at index ${i} became empty after translation`,
      };
    }
  }

  return { valid: true, pattern: translated as Pattern };
}
