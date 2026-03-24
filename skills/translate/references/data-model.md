# Inlang Data Model Reference

## Key concepts

- **Bundle** — one translatable unit across all locales (identified by `bundle.id`, the translation key)
- **Message** — one locale's translation of a bundle (`message.locale`, `message.selectors`)
- **Variant** — the actual text content, with optional `matches` for pluralization

## Pattern node types

Only `{ type: "text" }` nodes should be translated. All other types must be preserved exactly:

| Type | Description | Translatable? |
|------|-------------|--------------|
| `text` | Plain string | ✅ Translate the `value` field |
| `expression` | Variable/function reference | ❌ Preserve exactly |
| `markup-start` | Opening markup tag | ❌ Preserve exactly |
| `markup-end` | Closing markup tag | ❌ Preserve exactly |
| `markup-standalone` | Self-closing markup | ❌ Preserve exactly |

## Links

- [Data model documentation](https://inlang.com/docs/data-model)
- SDK schema: `packages/sdk/src/database/schema.ts`
- Pattern types: `packages/sdk/src/json-schema/pattern.ts`
