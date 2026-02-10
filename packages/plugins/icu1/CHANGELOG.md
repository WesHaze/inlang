# @inlang/plugin-icu1

## 1.0.1

### Patch Changes

- 6defee0: Handle markup elements explicitly in the ICU1 serializer after SDK pattern type updates.

  - Updated serializer type handling for widened pattern unions.
  - Added an explicit user-facing error when markup placeholders are encountered, since ICU MessageFormat 1 does not support markup placeholders.

## 1.0.0

### Major Changes

- 2572cb5: Initial release
