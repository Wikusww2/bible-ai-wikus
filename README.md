# Bible AI

[![Checks](https://github.com/Wikusww2/bible-ai-wikus/actions/workflows/ci.yml/badge.svg)](https://github.com/Wikusww2/bible-ai-wikus/actions/workflows/ci.yml)

A personal Bible study workspace with direct Scripture lookup, an OpenAI Responses API agent, source links, original-language text and Strong's lexicon lookup, and a file and artifact Library. The interface supports desktop and mobile layouts, five palettes, and light and dark appearance.

Maintained by [Wikus van Wyk (@Wikusww2)](https://github.com/Wikusww2). The project is early in its public development. Its reusable maintenance work includes deterministic Scripture retrieval, recoverable agent runs, conflict-preserving storage and Unicode study exports. See the [roadmap](docs/ROADMAP.md), [contribution guide](CONTRIBUTING.md) and [security policy](SECURITY.md).

## Run locally

Use Node.js 24 or a compatible version at least 22.13.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 8765
```

Open http://127.0.0.1:8765. Direct Scripture and lexicon lookup need no OpenAI key. Add your own key in Settings for AI requests; usage incurs charges on your OpenAI account. File storage uses local Cloudflare D1 and R2 emulation during development. Cloud sync is disabled without a server encryption key. Use a separate development origin from production.

```sh
npm run check
```

This runs regression tests, TypeScript checks, and a production build. Browser JavaScript is bundled with `npm run prepare:client`, which also runs before development and production builds. Tests execute the actual client modules and a bundled Worker against isolated SQLite and in-memory object storage.

## Architecture

- `index.html`, `css/app.css`, `js/`: live interface, reference parser, providers, Responses API agent, storage and sync.
- `shared/workspace.js`: record validation, atomic local snapshots, conflict-preserving merge, attachment preflight.
- `worker/`: owner-scoped sync, Library APIs, artifacts and Unicode PDF generation.
- `db/`, `drizzle/`: D1 schema and migrations.
- `app/`, `vite.config.ts`, `build/`: Vinext/Cloudflare integration and build tooling.
- `public/fonts/`: bundled Noto fonts and their SIL Open Font License.
- `tests/`: synthetic client and isolated backend regressions.

The original `bible-ai-frontend.html`, preview PNG, and builder prompt are reference fixtures. The public source excludes the original hosting project configuration and local data.

## Deployment boundaries

This repository is source code; publishing it does not deploy a running app. A hosted deployment needs D1 bound as `DB`, R2 as `FILES`, static assets as `ASSETS`, and a private `SYNC_ENCRYPTION_KEY` containing a base64-encoded 32-byte key. Set secrets in the hosting provider, never in this repository. Apply the included D1 migrations before using a new database.

The Worker trusts an upstream authentication gateway's `oai-authenticated-user-email` identity. A production gateway **must authenticate the user and remove any client-supplied copy of that header**. Set `OWNER_EMAIL` as an additional single-owner restriction. An arbitrary public Worker without a trusted gateway is not a secure deployment. This checkout does not configure or verify that gateway.

API keys are plaintext in browser local storage. Configured hosted sync encrypts the key at rest using the server's key, but the server can decrypt it. This is not end-to-end encryption. The browser sends AI requests directly to OpenAI; Scripture and lexicon requests go to Bolls; optional page fetching uses the configured proxy. OpenAI background responses are stored by OpenAI for recovery.

A ZIP backup excludes the API key and includes workspace records and Library bytes. Restore preserves conflicting records and remaps file references. Browser backups are limited to 250 MB uncompressed.

## Accuracy and remaining limits

Retrieved passage cards display provider text. AI prose is labelled commentary and may contain mistakes; compare quotations against the cards. Original-language text and English KJV Strong's phrases are separate resources, not a word-aligned interlinear. Where chapter verse numbering differs, unverified English word links are disabled. Full cross-manuscript versification mapping is not implemented.

Translation availability depends on the provider. Unsupported translations can fall back with a visible notice; provider errors do not silently change the translation. Translation and source licensing must be checked for the intended use. The repo includes no downloaded Bible corpus.

Cost estimates use the dated rate table in `js/harness.js`, account for reported web-search calls, and are estimates rather than invoices. Generated React artifacts must be complete browser-ready HTML; this app does not compile arbitrary JSX uploads.

See [audit fixes and verification](docs/AUDIT-FIXES.md). No real paid OpenAI request or production authentication gateway has been tested in this revision.

## License

Original project code is available under the [MIT License](LICENSE). Third-party fonts, dependencies, translations and external services retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).
