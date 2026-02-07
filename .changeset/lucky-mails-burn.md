---
"@inlang/sdk": minor
---

Extend the SDK pattern AST with richer markup metadata.

Added support for markup `options` and `attributes` on:

- `markup-start`
- `markup-end`
- `markup-standalone`

Also introduced an `Attribute` schema type (`Literal | true`) for flag-style and valued attributes.

This is additive and keeps existing markup patterns compatible while enabling richer MF2-aligned markup data in the SDK model.
