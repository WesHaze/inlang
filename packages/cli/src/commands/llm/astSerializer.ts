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
 * Reconstructs a proper Pattern from a collapsed string returned by the LLM.
 *
 * When an LLM receives a pattern like `["Remove ", {expr:label}]` it sometimes
 * responds with a plain string `"Entfernen {label}"` rather than the full node
 * array.  This function parses the `{variableName}` placeholders back out,
 * matches them to the source expression nodes by name, and rebuilds the
 * correctly-structured pattern.
 *
 * - Non-text source nodes (expression, markup-*) are always taken verbatim from
 *   source — they are never translated.
 * - Text segments between placeholders become text nodes.
 * - Missing trailing/leading text becomes an empty text node so the length
 *   always matches the source.
 * - If the LLM drops a variable entirely, the source expression node is still
 *   inserted at its original position (the variable will still render at runtime).
 */
export function rebuildPatternFromString(str: string, source: Pattern): Pattern {
  // Collect variable names from expression nodes in source order.
  const varNames: string[] = [];
  for (const node of source) {
    if (
      node.type === "expression" &&
      (node as { type: string; arg?: { type?: string; name?: string } }).arg?.type === "variable-reference"
    ) {
      varNames.push(
        (node as { type: string; arg: { type: string; name: string } }).arg.name,
      );
    }
  }

  if (varNames.length === 0) {
    return [{ type: "text", value: str }];
  }

  // Build regex matching any of the known variable names as {name}.
  const escaped = varNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`\\{(${escaped.join("|")})\\}`, "g");

  // Tokenise the translated string into alternating text / var-reference segments.
  type Seg = { kind: "text"; value: string } | { kind: "var"; name: string };
  const segs: Seg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(str)) !== null) {
    if (m.index > last) segs.push({ kind: "text", value: str.slice(last, m.index) });
    segs.push({ kind: "var", name: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < str.length) segs.push({ kind: "text", value: str.slice(last) });

  // Walk the source structure and pull text from the segment stream.
  const result: Pattern = [];
  let si = 0;

  for (const srcNode of source) {
    if (srcNode.type !== "text") {
      // Consume a matching var segment if present (may be absent if LLM dropped it).
      if (si < segs.length && segs[si]!.kind === "var") si++;
      result.push(srcNode); // always copy from source — variables are never translated
    } else {
      // Consume a text segment if the next one is text; otherwise emit empty.
      if (si < segs.length && segs[si]!.kind === "text") {
        result.push({ type: "text", value: (segs[si++] as { kind: "text"; value: string }).value });
      } else {
        result.push({ type: "text", value: "" });
      }
    }
  }

  return result;
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

function sortedStringify(obj: unknown): string {
  if (Array.isArray(obj)) {
    return `[${obj.map(sortedStringify).join(",")}]`;
  }
  if (obj !== null && typeof obj === "object") {
    const keys = Object.keys(obj as object).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${sortedStringify((obj as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(obj);
}

function nodesDeepEqual(a: unknown, b: unknown): boolean {
  return sortedStringify(normalizeNode(a)) === sortedStringify(normalizeNode(b));
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
    const tgt = translated[i];
    if (typeof tgt !== "object" || tgt === null) {
      return {
        valid: false,
        error: `Node at index ${i} is not an object`,
      };
    }
    const tgtObj = tgt as Record<string, unknown>;

    if (src.type !== "text") {
      // Rule 3: non-text nodes must be deep-equal (normalised)
      if (!nodesDeepEqual(src, tgtObj)) {
        return {
          valid: false,
          error: `Non-text node at index ${i} was modified by the LLM`,
        };
      }
      continue;
    }

    // Rule 4: text node type must remain "text"
    if (tgtObj["type"] !== "text") {
      return {
        valid: false,
        error: `Node at index ${i} changed type from "text" to "${tgtObj["type"]}"`,
      };
    }

    // Rule 5: tgtValue must always be a string
    const srcValue = (src as { type: "text"; value: string }).value;
    const tgtValue = tgtObj["value"];
    if (typeof tgtValue !== "string") {
      return {
        valid: false,
        error: `Text node at index ${i} value is not a string`,
      };
    }
    // Rule 6: interior text nodes (not leading or trailing) that were non-empty must stay non-empty.
    // Leading/trailing nodes may become empty when word order shifts a variable to the edge
    // (e.g. "Last updated {t} ago" → French "Mis à jour il y a {t}").
    const isInterior = i > 0 && i < source.length - 1;
    if (srcValue !== "" && isInterior && tgtValue === "") {
      return {
        valid: false,
        error: `Text node at index ${i} became empty after translation`,
      };
    }
  }

  return { valid: true, pattern: translated as unknown as Pattern };
}
