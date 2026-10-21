# Contributing to Bible AI

Maintainer: [Wikus van Wyk (@Wikusww2)](https://github.com/Wikusww2). This project is early in its public development. Bug reports, reproducible test cases, accessibility feedback, documentation corrections and focused pull requests are welcome.

## Before you start

Read [README.md](README.md), [the maintenance roadmap](docs/ROADMAP.md) and [the audit response](docs/AUDIT-FIXES.md). Open an issue before a large architectural change so scope and trade-offs can be discussed. Keep unrelated changes out of a fix.

Use Node.js 24, install with `npm ci`, and run `npm run check`. Serve the app over localhost for browser checks. Use synthetic workspaces and test credentials; never commit or attach real keys, private conversations, personal files or hosting secrets. Do not run deletion or restore tests against a real workspace.

## A useful bug report

Include the steps to reproduce, expected and actual behavior, browser and operating system, and whether the issue occurs with a fresh local workspace. Add a minimal synthetic example where possible. Screenshots and logs must omit keys and personal data. Report suspected security vulnerabilities through [SECURITY.md](SECURITY.md), rather than a public issue.

## Pull requests

Explain the concrete problem, the cause, the change and its limits. Add a regression test when it meaningfully protects the behavior. Run `npm run check`; for UI changes, also inspect desktop and mobile layouts, light and dark appearance, keyboard access and the affected empty or error state. State what you did not verify.

Preserve revision-checked sync, conflict copies, deletion tombstones, tool approval boundaries, recovery checkpoints and the opaque-origin sandbox used for active HTML. Never weaken a test or security boundary merely to make a check pass.

## Scripture and original-language changes

Distinguish provider text, AI commentary and interpretation. A proposed reference or manuscript correction needs a verifiable source and a regression case. Do not label KJV Strong's phrases as a word-aligned interlinear. Check source and translation rights before adding material; the project does not distribute a Bible corpus.

AI-assisted contributions are welcome. Contributors remain responsible for understanding, reviewing and verifying what they submit. Please keep discussions respectful and focused on the software, evidence and the reported behavior.
