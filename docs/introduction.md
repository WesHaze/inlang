# Introduction

## What is inlang?

Inlang is an open project format and SDK for localization tooling.

It is not a new message syntax or a SaaS translation backend. Instead, it gives editors, CLIs, IDE extensions, and runtimes a shared, queryable source of truth for localization data.

You can keep using your existing translation files and message syntax. Plugins connect inlang to formats like JSON, ICU MessageFormat v1, i18next, and XLIFF.

The SDK has two main parts:

- **Storage + data model** for translations, settings, and structured edits
- **An API** for loading, querying, and modifying that data programmatically

## Why inlang?

Common translation files like JSON, YAML, ICU, or XLIFF are good at serializing messages. But they are not databases.

Once multiple tools need to read and write the same project, missing database semantics become the bottleneck:

- Structured CRUD operations instead of ad-hoc parsing
- Queries across locales, variants, and metadata
- Transactions, history, merging, and collaboration
- One source of truth that editors, CI, and runtimes can all share

Without a common substrate, every tool invents its own format, sync, and collaboration model.

The result is fragmented tooling:

- Switching tools requires migrations and refactoring
- Cross-team work requires manual exports and hand-offs
- Automating workflows requires custom scripts and glue code

```
┌──────────┐        ┌───────────┐         ┌──────────┐
│ i18n lib │───✗────│Translation│────✗────│   CI/CD  │
│          │        │   Tool    │         │Automation│
└──────────┘        └───────────┘         └──────────┘
```

Inlang follows a simple idea: **one shared project format for localization tools, while keeping your external file formats**.

```
┌──────────┐        ┌───────────┐         ┌────────────┐
│ i18n lib │        │Translation│         │   CI/CD    │
│          │        │   Tool    │         │ Automation │
└────┬─────┘        └─────┬─────┘         └─────┬──────┘
     │                    │                     │
     └─────────┐          │          ┌──────────┘
               ▼          ▼          ▼
           ┌──────────────────────────────────┐
           │          .inlang file            │
           └──────────────────────────────────┘
```

**The result:**

- Switch tools without migrations — they all use the same file
- Cross-team work without hand-offs — developers, translators, and designers all edit the same source
- Automation just works — one source of truth, no glue code
- Keep your preferred message format — plugins handle import/export

## How it works

Under the hood, an inlang project stores localization data in SQLite and uses a message-first data model.

Lix adds history and sync semantics on top, and plugins map that data to the files you already use.

```
┌─────────────────┐       ┌─────────┐       ┌──────────────────┐
│  .inlang file   │◄─────►│ Plugins │◄─────►│ Translation files│
│    (SQLite)     │       │         │       │  (JSON, XLIFF)   │
└─────────────────┘       └─────────┘       └──────────────────┘
```

- **Plugins** import and export your translation files (`JSON`, `ICU1`, `i18next`, `XLIFF`, etc.)
- **inlang** stores the data in a queryable project format
- **Lix** provides versioning and collaboration primitives for distributed changes

If you only need an app runtime and a couple of translation files, your current setup may already be enough. Inlang becomes useful when multiple tools need to operate on the same localization source of truth.

To store an inlang project in git, you can use the **unpacked format** — a directory instead of a single file. See [Unpacked Project](/docs/unpacked-project) for details.

## Next steps

- [Getting Started](/docs/getting-started) — Set up your first project
- [Architecture](/docs/architecture) — Understand the three layers
- [Writing a Tool](/docs/write-tool) — Build a tool that queries translations
- [Writing a Plugin](/docs/write-plugin) — Support a custom file format

## Credits

Inlang builds on [Lix](https://lix.dev) for version control and [Kysely](https://kysely.dev) for the query API.
