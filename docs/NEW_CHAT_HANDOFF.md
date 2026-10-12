# MALENJO — Engineering Continuation Handoff

**Updated:** 2026-10-12 (after verified PR #264)
**Project:** [rafayamer/Malenjo-suite](https://github.com/rafayamer/Malenjo-suite)
**Authoritative design/feature specification:** [MALENJO_MASTER_SPEC_V2.md](MALENJO_MASTER_SPEC_V2.md)
**Codespaces integration branch:** `integration/option-b-codespaces-validation`
**UI/UX tracking:** [#121](https://github.com/rafayamer/Malenjo-suite/issues/121)
**Ten-phase RELEASE-READY roadmap:** [#238](https://github.com/rafayamer/Malenjo-suite/issues/238)

## Absolute release status

**Phase 1: NOT RELEASE-READY.** Development PRs can be merged for Codespaces evaluation, but that is not owner acceptance. Owner Foxit-style visual approval and exhaustive UI/accessibility validation have NOT been recorded. All engines retained for later phases must pass their own functional release gates.

**Most recent verified production merge:** [PR #264](https://github.com/rafayamer/Malenjo-suite/pull/264), merge commit `28102225eb383dbf7a5d8543f03ca7cc6909edd7`. This handoff itself may subsequently advance the integration branch tip without changing that application-code baseline. Do **not** merge `main`.

## Merged, exact-head verified Phase 1 batches

| PR | Integration merge | Actual changes |
| --- | --- | --- |
| [#260](https://github.com/rafayamer/Malenjo-suite/pull/260) | `23e968ce4ef9bcb678049a5ebc1e139245e8e8d1` | Master v2 ten compact PDF ribbon tabs, MAL-001–090 searchable discovery, real Save/Undo/Redo bindings, selectable PDF.js text hover repair |
| [#261](https://github.com/rafayamer/Malenjo-suite/pull/261) | `1cfe00318b6cd9af26f46b6802d896a8ad6ed55c` | Home defaults to real Open File / expandable Recent Files; retains optional secondary document/file tools |
| [#262](https://github.com/rafayamer/Malenjo-suite/pull/262) | `ed2a35b264b37d21d12df9794aa0dae406bf2588` | Chromium text-layer mouse hover + PDF opened across six viewport sizes and both themes, AI open/closed, viewport screenshots |
| [#263](https://github.com/rafayamer/Malenjo-suite/pull/263) | `5fb15d7bf133702f60f012fa2847dd3d35ffa031` | Compact bottom status bar bound to real current PDF page count and zoom mode |
| [#264](https://github.com/rafayamer/Malenjo-suite/pull/264) | `28102225eb383dbf7a5d8543f03ca7cc6909edd7` | Fix top-bar Undo/Redo stale availability after real PDF edits via stable command-controller registration and reactive refresh; real Save/Undo/Redo + independent PDF reopen regression |

**Final application-code head tested:** `4e37b91f24a303e501626346bd304668ac2090c6` from #264.
**Exact-head full five-job CI:** [run 38268243481](https://github.com/rafayamer/Malenjo-suite/actions/runs/38268243481), **SUCCESS**.
**Exact-head real Chromium acceptance:** [run 38268243441](https://github.com/rafayamer/Malenjo-suite/actions/runs/38268243441), **SUCCESS**.
**Visual evidence:** [full Light/Dark modules + responsive real PDF review artifact](https://github.com/rafayamer/Malenjo-suite/actions/runs/38268243441/artifacts/11756210610) — screenshots are evidence **for** review, NOT recorded approval.

Browser has exercised real PDF rendering, selectable text, Find, internal page links, PDF→JPG independent ZIP/JPEG checks, permanent rotation/undo/redo/export and independent PDF reopen, Home keyboard filters and disabled Office conversion gates, 10-tab/90-entry discovery, the original 33 PDF tool shortcut directory, document tab retention, AI panel interaction, six screen sizes (1920×1080, 1440×900, 1366×768, 1024×768, 768×600 and 430×720) in both themes, and live status updates.

## Immutable product UI contract

- **PDF first:** single window, no permanent workspace navigation rail or unrelated dashboard. Top quick-action bar, exactly ten compact PDF tabs (**Home, Edit, Organize, Optimize, Convert, Forms, Review, Protect, Automate, Tools**), document tabs, live central PDF canvas, compact status bar.
- **Home:** genuine Open File picker and Recent Files collection. Secondary options are disclosed explicitly rather than always occupying the workspace.
- **AI:** persistent top-bar AI icon opens the optional right Messenger-like assistant. Never invent AI answers or silently substitute cloud inference. No dependency on an Ollama service for deterministic PDF operations.
- **Exactly Light and Dark themes**, established MALENJO blue/cyan, accessible keyboard interactions, icon tooltips and viewport-safe dialogs, no uncontrolled panel overlap.
- **All 90 MAL command identifiers discoverable; all 15 legacy PDF tools remain mapped and retained; the 33 existing PDF shortcuts remain discoverable.** A catalog entry is NOT proof its engine is implemented. Unverified engines must remain clearly disabled and carry explanatory reasons.
- **Office DOCX/XLSX/PPTX editors ONLY after a genuinely successful PDF conversion produces those outputs.** No standalone Office imports, workflows or file associations. CAD/DICOM opening stays limited to genuinely supported formats.
- Preserve existing real PDF commands, transactional edits, undo/redo, source-file integrity, error feedback, and document tabs. NEVER restart the app or discard functioning behavior.

## Remaining Phase 1 release blockers and next work

1. **Owner visual approval still missing** for full Foxit-inspired compact UI across Light/Dark screenshots and representative Codespaces PDF files. Do not infer approval from a green browser suite.
2. **Manual accessibility and comprehensive screen-reader/tooltip/focus review not yet signed off**, especially disabled command descriptions, keyboard tab traversal, contextual flyouts and assistive feedback. Add deterministic tests for discovered defects.
3. **Full realistic Home Recent Files recovery/reopen and error-path signoff** across browser and Windows desktop still needed; browser session files are intentionally ephemeral.
4. **Exhaustive visual/panel layout review** needed at all prescribed sizes with AI narrow-mode, optional left/right PDF panels, dialogs and multi-document dirty states. The Chromium responsive matrix is substantial regression evidence, not full UX UAT.
5. **Owner approval / Phase 1 acceptance trace** must be recorded in issue #121 before declaring RELEASE-READY. Continue narrow fix PRs with exact-head CI and Chromium, merge only into integration.
6. PDF→Office real converters, advanced native editing, security, OCR/AI/CAD/DICOM and other feature engines remain explicitly **NOT RELEASE-READY in their later phases**. Never implement fake outputs or treat their release gates as completed by Phase 1 UI discovery.

## Resume Codespaces evaluation

```bash
git fetch origin
git switch integration/option-b-codespaces-validation
git pull --ff-only origin integration/option-b-codespaces-validation
npm run dev:codespace
```

Open forwarded port `1420`. Use a real multi-page PDF and inspect text selection, Home/Recent, ten-tab ribbon, top Save/Undo/Redo, status bar, AI open/close, both themes and compact layouts. Record feedback and screenshots in issue #121.

**Never merge to `main` without the owner's explicit final release approval.**

## Suggested first task for a new chat

> Read `docs/MALENJO_MASTER_SPEC_V2.md` and this handoff from `integration/option-b-codespaces-validation`. Do not restart. Check current integration tip, CI and PR history (#260–#264 verified and merged). Phase 1 remains NOT RELEASE-READY until visual approval and accessibility/real-user UAT. Continue narrow UI defect fixes with actual Chromium and full exact-head CI, only merging into integration. Never merge `main` or enable fake engines. Report latest SHA, actual functionality, tests and blockers.
