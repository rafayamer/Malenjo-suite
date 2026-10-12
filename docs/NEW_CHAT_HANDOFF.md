# MALENJO — New Chat Engineering Handoff

**Updated:** 2026-10-12  
**Repo:** https://github.com/rafayamer/Malenjo-suite  
**Master specification (authoritative):** [docs/MALENJO_MASTER_SPEC_V2.md](MALENJO_MASTER_SPEC_V2.md)  
**Codespaces validation branch:** `integration/option-b-codespaces-validation`  
**Current open Phase 1 development PR:** [#260 — Master v2 ten-tab PDF ribbon, searchable 90-feature catalog and quick actions](https://github.com/rafayamer/Malenjo-suite/pull/260)  
**Phase 1 UI/UX tracking:** [issue #121](https://github.com/rafayamer/Malenjo-suite/issues/121)  
**Ten-phase roadmap:** [issue #238](https://github.com/rafayamer/Malenjo-suite/issues/238)

## Product invariants (do not reinterpret)

MALENJO is primarily a **professional PDF manipulation and editing product**, not a Word/Excel/PowerPoint productivity suite. Its UI is minimalist and Foxit-inspired. It must have **no permanent module sidebar** and no unrelated dashboard. One window contains: (1) narrow top application/quick-action bar; (2) ten-tab compact icon-first PDF ribbon; (3) document tab strip; (4) central live PDF canvas; (5) small bottom status bar. The persistent top AI icon opens a Messenger-like right chat panel with permitted document context and no fake AI responses.

Exactly **two themes: Light and Dark** using existing MALENJO blue/cyan. Home has a real **Open File** picker and **Recent Files**. CAD and DICOM are independent specialty viewers and support direct file-opening only to the extent decoding is genuinely supported. **Office output editors launch only after verified PDF→DOCX/XLSX/PPTX conversion**; no public standalone Office import paths or Windows Office associations. Native Windows file association policy belongs to the last phase.

All **MAL-001–MAL-090** must be discoverable in a shared command catalog, and all **15 original screenshot tools** retained. Ten top ribbon categories must be exactly: Home, Edit, Organize, Optimize, Convert, Forms, Review, Protect, Automate, Tools. **Never substitute clickable fake functionality for a real command.** Engines not yet implemented may be represented in Phase 1 UI by accessible, explanatory, clearly disabled entries, but count as **NOT RELEASE-READY** under their later feature phases. Do not claim the 90 engines have been built simply because 90 commands are registered.

## Current exact technical state — verified live

- [PR #260](https://github.com/rafayamer/Malenjo-suite/pull/260) is **OPEN, DRAFT, NOT MERGED**, base `integration/option-b-codespaces-validation`.
- PR head as checked: `cd472ab8a017b2d7a15cef95608fea234404f40b`. **Re-check head on resumption**; never assume unchanged.
- At that exact head the five-job [CI run #38256310110](https://github.com/rafayamer/Malenjo-suite/actions/runs/38256310110) is **SUCCESS** (frontend, Rust, Codespaces/Linux, Linux PDF execution and Windows provider).
- At that exact head [Chromium acceptance run #38256310083](https://github.com/rafayamer/Malenjo-suite/actions/runs/38256310083) is **FAILURE**, job `114835488539`. Browser log says:
  `PDF browser acceptance failure: PDF hover does not show I-beam`, at `scripts/pdf-ui-browser-smoke.mjs` around line 618.
  The same browser run passed ten-tab / 90-feature Home discovery, conversion-only Office entry checks, top AI drawer, Home keyboard filters, command palette, responsive / two-theme 18-public-workspace captures, actual PDF→JPG export and 33-tool directory before failing.
  Failure screenshot artifact: https://github.com/rafayamer/Malenjo-suite/actions/runs/38256310083/artifacts/11749853518
- `/api/tags` proxy `ECONNREFUSED` was logged because local Ollama was not running in the browser test. The explicit failing assertion was PDF I-beam, not proof that the AI engine is available. Do not fake AI answers or conflate optional inference with deterministic PDF operations.
- Previously merged PR #250 provided the PDF-first minimal shell and AI top drawer. PR #260 adds master-v2 ten-tab/90-feature UI and a compact status bar. These are **UI work**, not verification of all MAL-001–090 engines.

**Important:** The full user-provided master specification is stored in the linked repository file on the integration branch (committed 2026-10-12). It takes precedence over earlier draft UI descriptions. The older ten-phase roadmap governs development/release sequencing unless explicitly revised; the v2.0 master document provides authoritative features, UX, security and acceptance criteria. Do not silently drop requirements because the v2.0 document also describes seven engineering milestones.

## Immediate next engineering task

1. Re-check current GitHub refs and PR #260 source, exact head CI and browser logs. Inspect `src/suite/shell/theme.css`, `src/suite/pdf/PdfPageCanvas.tsx`, PDF text-layer/cursor CSS, and the browser I-beam assertion.
2. **Repair PDF text-hover I-beam behavior in production UI** (do not suppress or weaken the acceptance test). Verify selectable text still works, including after opening the active document, toggling optional panels and AI, and changing theme. Re-run exact-head real Chromium acceptance.
3. Check top quick-action Save/Undo/Redo are genuinely attached to valid PDF operations and disabled when unavailable; confirm status bar, ten categories, 90 command IDs, original 15 tools, and existing 33 live PDF tools are preserved. Test accessible icon hover/focus tooltips, overflow/flyouts, viewport fit and no side-panel overlap.
4. Validate responsive layouts at 1920×1080, 1440×900, 1366×768, 1024×768, 768×600, plus narrow web viewport, in Light and Dark, with real PDF open and AI drawer opened/closed. Check recent file reopen/error paths and keyboard/screen reader controls.
5. Once **the PR's exact final head** passes full CI and real browser acceptance, merge **only into `integration/option-b-codespaces-validation`** for the owner's Codespaces review. **Never merge `main` without explicit owner approval.**
6. Continue closing all Phase 1 UI/UX acceptance defects and collect owner visual approval against supplied Foxit references. Do not start treating backend-only engines as Phase 1 blockers: preserve clear disabled UI state for later functionality work and their own strict gates.

## Reporting/acceptance standard

The owner requires **binary status only: RELEASE-READY or NOT RELEASE-READY**. A development batch can be tested and merged while Phase 1 remains **NOT RELEASE-READY**. No feature is complete until its whole release contract passes. Do not inflate 220-ticket or 90-feature acceptance from superficial UI screenshots or green compile/tests. For every continuation, report: last merged integration SHA, current PR SHA/status, exact-head CI/browser results, actual functionality implemented, and **remaining blockers**.

## Codespaces verification

From a Codespace:
```bash
git fetch origin
git switch integration/option-b-codespaces-validation
git pull --ff-only origin integration/option-b-codespaces-validation
npm run dev:codespace
```
Open forwarded port **1420**. To inspect unfinished #260 before it merges, explicitly switch to `feat/phase1-master-v2-ribbon-current`, understanding it is **not** the validated integration build. Re-check branch/PR head first.

## New chat first message (copy/paste)

> Continue development of MALENJO Phase 1 UI/UX from GitHub repo `rafayamer/Malenjo-suite`. Read `docs/MALENJO_MASTER_SPEC_V2.md` and `docs/NEW_CHAT_HANDOFF.md` on `integration/option-b-codespaces-validation` first. **Do not start from scratch.** Inspect PR #260 (currently open and not merged), its exact-head CI and Chromium. The latest browser test failed because selectable PDF text loses its I-beam on hover. Fix that real regression, rerun exact-head browser and full CI, and merge the validated PR into the Codespaces integration branch only, never `main`. Then keep implementing and verifying remaining **Phase 1 UI/UX** requirements until the user's Foxit-style minimalist PDF-first design passes. Preserve ten ribbon tabs, discoverable MAL-001–090 catalog, 15 legacy tools, existing working PDF handlers, exactly Light/Dark, top-bar AI drawer, no permanent rail, true Open/Recent, and Office editors **only as automatic PDF-conversion outputs**. All unavailable engines must be honestly disabled, not fake. Report completed and remaining work using only **RELEASE-READY / NOT RELEASE-READY**; do not mark Phase 1 release-ready without complete acceptance and owner's visual approval.

