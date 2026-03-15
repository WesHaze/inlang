<p align="center">
  <a href="https://github.com/opral/inlang">  </a>

  <img src="https://github.com/opral/inlang/blob/main/assets/logo_rounded.png?raw=true" alt="inlang icon" width="90px">
  
  <h2 align="center">
    The open project format for localization tooling.
  </h2>

  <p align="center">
    <br>
    <a href='https://inlang.com/c/apps' target="_blank">🕹️ Apps</a>
    ·
    <a href='https://inlang.com/documentation' target="_blank">📄 Docs</a>
    ·
    <a href='https://discord.gg/gdMPPWy57R' target="_blank">💙 Discord</a>
    ·
    <a href='https://twitter.com/inlangHQ' target="_blank">𝕏 Twitter</a>
  </p>
</p>

<br>

Inlang is an open project format and SDK for localization tooling.

It is not a new message syntax or a SaaS translation backend. It gives editors, CLIs, IDE extensions, and runtimes a shared, queryable source of truth for localization data.

You can keep using your existing translation files and message syntax. Plugins connect inlang to formats like JSON, ICU MessageFormat v1, i18next, and XLIFF.

## The problem

Common translation files like JSON, YAML, ICU, or XLIFF are good at serializing messages. But they are not databases.

Once multiple tools need to read and write the same project, missing database semantics become the bottleneck:

- Structured CRUD operations instead of ad-hoc parsing
- Queries across locales, variants, and metadata
- Transactions, history, merging, and collaboration
- One source of truth that editors, CI, and runtimes can all share

Without a common substrate, every tool invents its own format, sync, and collaboration model.

Even basic import/export for translation file formats gets duplicated across tools instead of being shared.

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

Every tool has its own format, its own sync, its own collaboration layer. Cross-team work? Manual exports and hand-offs.

## The solution

Inlang adds those database semantics in a shared project format while keeping your external file formats. It provides:

- A message-first data model and SDK for structured reads and writes
- Queryable storage for translations, settings, and edits
- Plugins to import/export formats like JSON, ICU1, i18next, and XLIFF so that file-format support can be shared instead of reimplemented in every tool
- Versioning and collaboration primitives via [lix](https://github.com/opral/lix)


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

The result:

- Switch tools without migrations — they all use the same file
- Cross-team work without hand-offs — developers, translators, and designers all edit the same source
- Automation just works — one source of truth, no glue code
- Keep your preferred message format — plugins handle import/export

If you only need an app runtime and a couple of translation files, your current setup may already be enough. Inlang becomes useful when multiple tools need to operate on the same localization source of truth.

## Popular tools

- [Paraglide](https://inlang.com/m/gerre34r/library-inlang-paraglideJs) — i18n library for JS/TS with fully translated, typesafe & fast apps in minutes
- [Fink](https://inlang.com/m/tdozzpar/app-inlang-finkLocalizationEditor) — translation editor in the browser, invite collaborators to help
- [Sherlock](https://inlang.com/m/r7kp499g/app-inlang-ideExtension) — VS Code extension to translate right in your editor
- [Parrot](https://inlang.com/m/gkrpgoir/app-parrot-figmaPlugin) — see translations directly in Figma
- [CLI](https://inlang.com/m/2qj2w8pu/app-inlang-cli) — lint messages, machine translate, quality control in CI/CD

## Build your own

```ts
import { loadProjectFromDirectory } from "@inlang/sdk";

const project = await loadProjectFromDirectory({
  path: "./project.inlang",
});

const messages = await project.db.selectFrom("message").selectAll().execute();
```

[Read the docs →](https://inlang.com/docs)

## Contributing

There are many ways you can contribute to inlang! Here are a few options:

- Star this repo
- Create issues every time you feel something is missing or goes wrong
- Upvote issues with 👍 reaction so we know what the demand for a particular issue to prioritize it within the roadmap

If you would like to contribute to the development of the project, please refer to our [Contributing guide](https://github.com/opral/inlang/blob/main/CONTRIBUTING.md).

All contributions are highly appreciated. 🙏
