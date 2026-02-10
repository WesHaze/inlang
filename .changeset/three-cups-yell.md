---
"@inlang/plugin-icu1": patch
---

Handle markup elements explicitly in the ICU1 serializer after SDK pattern type updates.

- Updated serializer type handling for widened pattern unions.
- Added an explicit user-facing error when markup placeholders are encountered, since ICU MessageFormat 1 does not support markup placeholders.
