# Engineering handoff

Updated 21 October 2026. Read [README.md](README.md) for the current architecture, commands, security boundaries and deployment requirements, and [docs/AUDIT-FIXES.md](docs/AUDIT-FIXES.md) for the audit response.

The live app is served by a Vinext/Cloudflare Worker. Keep the original mockup, preview image and builder prompt unchanged as reference fixtures. Browser JavaScript remains plain scripts sharing a small bundled vendor/global interface; preserve this structure unless a task calls for a change.

Keep keys out of code, logs, fixtures, screenshots and commits. Tests use synthetic values, isolated SQLite and in-memory object storage. Test direct lookup and UI changes in a browser as well as running `npm run check`. Never point destructive tests at a real workspace.

Sync uses a persisted merge base and server revision checks. Preserve conflict copies and tombstones. Completion checkpoints must remain until the main answer has been durably saved. Tool effects use a replay ledger and server artifact idempotency keys. Stop must settle pending approvals and abort work. Generated HTML must retain its opaque-origin sandbox.

Remaining limits: no full manuscript versification map, AI quotations require checking against provider cards, browser backups have a 250 MB limit, and live OpenAI and production gateway verification require the owner's environment. Check dependency audit output before deployment; do not force framework downgrades merely to hide an advisory.
