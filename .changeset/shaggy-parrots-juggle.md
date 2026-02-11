---
"@inlang/cli": patch
---

Fix CLI commands not terminating by removing the shutdown wait on `fileQueueSettled`.

Also silence known non-actionable shutdown noise from background file queue processing when the DB is already closed.
