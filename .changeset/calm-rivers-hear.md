---
"@inlang/plugin-message-format": minor
---

Local formatter declarations now support MF2-style variable option values using `$variable`, and declaration options now allow optional whitespace around `=`.

This fixes cases like `local formattedAmount = amount: number style=currency currency = $priceCurrency notation=compact`, which previously either dropped the `currency` option because of the spaces or treated `priceCurrency` as a literal string instead of an input variable.

The change is non-breaking:

- existing literal options like `currency=USD` still work
- existing `number style=currency` usage is unchanged
- variable-valued options are only enabled when the value uses the new `$variable` syntax
- exported declarations now round-trip variable options as `key=$variable`
