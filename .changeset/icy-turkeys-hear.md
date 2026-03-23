---
"@inlang/plugin-icu1": minor
---

Lower ICU exact `plural` and `selectordinal` cases through a dedicated exact selector during import, while keeping category cases on the plural selector. This keeps exact `=n` arms reachable with the existing Paraglide compiler and serializes the imported shape back to normal ICU `=n` syntax on export.

This is a minor release because the imported inlang message shape changes for ICU exact plural and ordinal cases.
