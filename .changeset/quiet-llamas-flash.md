---
"@inlang/plugin-message-format": minor
---

Improve markup support in the inlang message format plugin.

- Added roundtrip support for markup `options` and `attributes`.
- Added support for quoted literal values (`|...|`) and escaped content (`\|`, `\\`) in markup option and attribute values.
- Added support for variable-valued markup options (`key=$variable`) with declaration inference for referenced variables.
- Added validation for malformed markup placeholders.
