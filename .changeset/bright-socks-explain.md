---
"@inlang/sdk": patch
---

Remove the `fileQueueSettled` wait after the initial filesystem sync in `loadProjectFromDirectory` to avoid hangs when file operations never settle.
