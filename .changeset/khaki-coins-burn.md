---
"@inlang/plugin-i18next": minor
---

Add markup-aware import and export support to the i18next plugin.

- Added support for rich text tag syntax (`<tag>`, `</tag>`, `<tag/>`) in import/export, mapped to SDK markup pattern elements.
- Added roundtrip coverage for markup-only and mixed markup + interpolation patterns.
- Added a clear error when `variableReferencePattern` is `["<", ">"]` and markup is present, because those syntaxes conflict.
