# Maintenance roadmap

This is a prioritized maintenance plan, not a promise of delivery dates. The project is maintained by Wikus van Wyk (@Wikusww2). Public adoption is at an early stage; no verified monthly download or active-user total is published here.

## Current baseline

The repository contains a runnable application, 35 automated regressions and CI for tests, type checking and production builds. The [audit response](AUDIT-FIXES.md) separates implemented fixes, mitigations and unresolved limits. Direct Scripture lookup needs no paid AI request. Live paid OpenAI requests and a production authentication gateway have not been verified in this revision.

## Next priorities

1. **Correctness evaluations:** create small, sourced fixtures for reference grammar, translation fallback, Hebrew/Greek rendering, citation placement and manuscript numbering. A full versification map needs explicit source validation before it can replace the current mismatch warning.
2. **Agent recovery and permissions:** broaden interrupted-stream and reconnect scenarios; verify that cancellation, approvals, disabled tools and artifact replay remain safe under real network failures.
3. **Deployment security:** verify the actual authentication gateway and owner restriction before a hosted release; review file isolation, HTML previews, backup restore and dependency advisories.
4. **Accessibility and long conversations:** expand keyboard and screen-reader checks, test text scaling and long-content states, and measure rendering cost before changing the streaming renderer.
5. **Maintainer workflows:** use issue templates and focused review checklists; explore API-assisted issue triage, regression generation and draft release notes with maintainer review. No new paid automation is enabled by this roadmap.

## How progress will be shown

Link a change to its issue and reproduction, state the verification performed, and record material behavior changes in release notes when a release is made. Do not mark a limitation fixed until the relevant path has been exercised. Share reusable test fixtures and maintenance improvements in the public repository without publishing keys, user data or copyrighted source corpora.
