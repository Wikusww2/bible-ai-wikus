# Audit response — 21 October 2026

This revision addresses the 51 findings from the local application audit. “Mitigated” means the unsafe behavior is blocked or labelled, with the remaining limitation stated below. It does not claim that the underlying external service or production environment has been changed.

| Findings | Implementation |
| --- | --- |
| H01 | Startup hydrates before persisting a fresh chat. Server writes require the current revision. Three-way merging preserves independent edits and conflicting copies; deletion tombstones prevent resurrection. Edits made during a cloud save are retained. |
| H02 | Direct lookup captures its originating conversation, guards overlap and uses an abortable request. |
| H03 — mitigated | Manuscript and KJV verse numbering is checked before exposing English Strong's links. Mismatches disable those links and show a warning. A complete cross-manuscript verse mapping remains future work. |
| H04 | Recovery persists completed tool outputs, artifact IDs and round budget. Artifact writes have server idempotency keys. |
| H05 | SSE EOF requires a completed event; interruption enters recovery instead of recording a successful truncated response. |
| H06 | The main answer is persisted before clearing its checkpoint or waiting for optional follow-up suggestions. Storage failure keeps the recovery checkpoint. |
| H07 | Stop aborts the run, settles pending approval and clears recovery state. |
| H08 | Tools must be advertised for that run and still enabled before execution; arguments are validated. |
| H09 | Full Library deletion runs in bounded batches until empty. Failures retain local workspace data and can be retried. |
| H10 | PDF exports embed Noto fonts, apply bidi cluster ordering and mark positioning, and preserve Greek and pointed Hebrew. |
| H11 — partially resolved | Framework, build and browser dependencies were updated. Audit fell from 27 findings to six high reports in one unpatched build-tool dependency chain through `braces`. See dependency limits below. |
| M01 | Reasoning `none` is explicitly sent rather than silently inheriting a server default. |
| M02 | Busy, invalid-reference, missing-key and unsupported-attachment submissions keep the draft. |
| M03 | The dated token price table, long-context multipliers and reported web-search fees are included. Estimates remain separate from billing. |
| M04–M06 | One atomic local snapshot replaces multi-key writes; quota failure shows a recovery/export warning. Invalid records are quarantined. The silent 60-chat cap is removed. |
| M07 | Failed cloud saves retry with bounded backoff; focus, online and visibility changes refresh state. |
| M08 | Directly retrieved passages are supplied as context to the next AI request. |
| M09 | Citation annotations retain their character ranges; round offsets are carried through recovery and links are inserted before text cleanup. |
| M10 | Citation cleanup preserves normal “cite” and “cited” prose. |
| M11–M12 | Impossible verse endpoints fail explicitly. Chapter ranges and mixed verse lists follow the deterministic parser; invalid references do not spend model tokens. |
| M13 | Explicit translation mode applies to the current session; comparison rows retain requested and actual translation labels and fallback notes. |
| M14 — mitigated | The interface describes KJV English phrases as Strong's lookup links, not aligned original-language words. Every Strong's code in a phrase is selectable. True word alignment remains unavailable. |
| M15–M16 | Original-text and lexicon views discard stale async results and reset context; new conversations reset their source panel. |
| M17 — improved | Token rendering is batched per animation frame and follows the feed only near the bottom. Full Markdown parsing still occurs on a rendered frame; a very long streamed response can remain expensive. |
| M18 | Marked GFM parsing and DOMPurify replace regex Markdown rendering. |
| M19 | Settings describe plaintext browser storage, server-readable encryption at rest and transport accurately. |
| M20 | ZIP export includes records and file bytes without the API key. Restore validates records, uploads files, preserves artifact metadata and remaps references. Browser backup limit: 250 MB uncompressed. |
| M21–M22 | Library uploads do not silently attach to a chat. New chats clear attachments. AI preflight enforces aggregate size and supported formats. |
| M23 | Camera generations stop streams returned after closure or supersession. |
| M24–M27 | Collapsed sidebar layout and recovery controls, contrast, inert hidden drawers, modal semantics, focus return and sheet keyboard trapping are implemented. |
| M28–M29 | Source viewers close native dialogs first, preserve modified-link clicks and offer a visible external-open fallback for blocked embedded pages. |
| M30 | Failed database insertion compensates object creation; batch deletion retains failed records for retry. The stores are not transactional together. |
| M31 | Regression tests execute the browser modules and backend. CI runs tests, type checks and production build. The vendor build parses the JavaScript dependency graph. |
| M32 | Failed recovery is no longer retried automatically on each reload; explicit Retry and Dismiss controls are provided. |
| M33 | Article generation creates valid paragraph markup with escaped content. |
| M34 | Conversation deletion offers confirmation and a restorable last-deleted copy; tombstones propagate the deletion. |
| M35 — mitigated | Provider cards are rendered separately from labelled AI commentary. AI-authored quotations are not mechanically proven correct; users must compare them against the cards. |
| L01–L05 | Local font fallbacks and readable prose width, smaller mobile composer tools, navigation state/history and selected-state semantics are improved. The handoff now reflects the Worker, builds and sync architecture. |

## Verification and limits

All 35 automated tests pass. They cover merge conflicts, tombstones, malformed records, quota failure, references, provider fallback boundaries, manuscript mismatch, SSE interruption, cancellation, permission enforcement, replay, pricing, encrypted key storage, revision conflicts, ownership/origin checks, artifact idempotency, 251-file pagination/deletion, HTML isolation, metadata restoration and Unicode PDF output. Type checking and the production build pass. PDF output was rendered and inspected visually.

Chrome checks verified a live WEB passage lookup, retained invalid-reference draft, attachment sheet focus trapping in both Tab directions, collapsed navigation, and no horizontal page overflow at 393 and 1440 pixels. Light and dark layouts were inspected. Console errors observed during this pass came from installed browser extensions; they were not application stack traces. Low-level synthetic browser injection was unavailable, so async race coverage uses executable client-module regressions.

No real paid OpenAI request was made. Synthetic API events cannot prove account-specific model access, real streaming behavior or pricing shown on an account invoice. A production gateway and two physical devices were not available for end-to-end verification. The isolated tests exercise the server revision/encryption boundaries, not the hosting provider's authentication configuration.

`npm audit` after updates reports six high-severity package entries through `braces` → `micromatch` → `fast-glob` → Vite dynamic import/CommonJS plugins → Vinext. At verification time the registry's latest `braces` release was still 3.0.3 and included in the advisory. These are build dependencies; the app does not accept user-controlled glob patterns. Build untrusted source in isolation and re-check the advisory before deployment. Do not use `npm audit fix --force`, which proposes an incompatible framework downgrade. The audit is not clean and the residual issue is not claimed fixed.
