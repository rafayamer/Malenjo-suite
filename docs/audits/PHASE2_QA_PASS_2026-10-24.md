# Phase 2 — PDF Core & Editor: QA pass, 2026-10-24

**Status: NOT RELEASE-READY.** Under issue #238, Phase 2 still needs owner UAT and a clean-installed Windows desktop check, and the 90 PDF requirements in `PDF_RELEASE_SELF_AUDIT.md` remain individually unaccepted. This pass makes the core reader and editor measurably more correct and adds a permanent regression gate. It does not establish release readiness.

Branch: `fix/phase2-pdf-reader-qa-20261024` → PR #295 against `integration/option-b-codespaces-validation`.

## Method

1. Read the controlling docs: #238 (Phase 2 scope), `PHASE2_REPEAT_AUDIT_AND_PERFORMANCE_PLAN_2026-10-15.md`, `PDF_PHASE2.md`, `PDF_RELEASE_SELF_AUDIT.md` and `NEW_CHAT_HANDOFF.md`.
2. Ran the existing gates: 655 unit tests, typecheck, build and the full `pdf-ui-browser-smoke.mjs`.
3. Drove the real UI in headless Chromium with screenshots: every ribbon tab, every enabled command, and broken, empty, fake and encrypted inputs, in both themes.
4. Saved every edit through the real top-bar **Save PDF copy** and reopened the bytes independently with PDF.js and pdf-lib.
5. Measured performance against the Master v2 §11 targets on realistic generated reports of 100 and 1,000 pages (dense text, vector tables, raster images).
6. Fixed every defect found, added unit tests and folded the manual checks into `scripts/pdf-phase2-browser-acceptance.mjs`, which runs in CI on Linux and on `windows-latest`.

## Defects found and fixed

| # | Defect (observed) | Root cause | Fix |
|---|---|---|---|
| 1 | Typing 57 in the page box after jumping to 55 landed on **page 6**; the indicator flickered through 5, 10, 39, 51… | `scrollIntoView({behavior:'auto'})` inherits CSS `scroll-behavior:smooth`, so the jump animated across every page and released the jump lock mid-animation. The page box was bound to the live page, so the tracker overwrote the typed number. | Jumps use `'instant'`. The page box keeps a draft until Enter or blur. Empty or invalid input reverts to the current page; Escape cancels. |
| 2 | **Password-protected PDFs could not be opened** ("No password given", with no way to enter one). | No PDF.js password path. | Themed password prompt with wrong-password feedback. The field clears after each attempt, the password is passed to PDF.js once and never stored. The file opens read-only. |
| 3 | Editing an encrypted PDF showed pdf-lib's developer hint ("use `PDFDocument.load(..., { ignoreEncryption: true })`") while "Applying PDF edit…" stayed on screen. | Raw library messages were passed straight to the UI. | `describePdfError()` provides plain-language messages on all 29 PDF workspace error paths. Edits on encrypted files are refused up front, and a read-only notice is shown. |
| 4 | **Pages with their own `/Rotate` displayed unrotated** in the main view: scans, and every page MALENJO rotates permanently. | PDF.js treats `getViewport({rotation})` as absolute, and only the view rotation was passed. | `displayPdfRotation(page.rotate, view)` is used for the canvas, text layer, link hit boxes and zoom sizing. |
| 5 | Memory grew without bound: **all 100 visited pages kept full-resolution canvases** (about 95 MP, roughly 380 MB) plus text layers, and a 1,000-page file would grow without limit. | The IntersectionObserver latched `visible=true` forever. | A per-document LRU render budget (48 MP). Visible, focus/adjacent and printing pages are pinned. Released pages re-render when they return to view. |
| 6 | Every zoom step re-rendered every previously visited page. | Same latch. | Off-screen pages with stale pixels are released rather than re-rendered, and their old CSS size is dropped. |
| 7 | Blank placeholders allocated about **180 MB** on a 1,000-page PDF. | Each `<canvas>` defaulted to 300×150. | Canvases start at 0×0 until they are drawn. |
| 8 | The Organize picker and the on-page Replace/Crop/Delete buttons rendered as **browser-default grey controls with a white input** in both themes. | Inline styles used an undefined `--surface` token. | Moved to theme-token CSS (Light and Dark). |
| 9 | The page panel **clipped 47 px**, cutting off "Current" and the selected thumbnail border. | An inner 58+224 px grid sat inside a column of 235 px or less. | The panel takes the remaining width, and the column is slightly wider. |
| 10 | The ribbon hid 7 of 12 Organize commands and truncated every caption ("Crop visu…"), even at 1920 px. | A fixed count of 5 and 62 px captions. | The count scales with measured width (10 commands at 1440 px), and captions run up to about 13 characters. |
| 11 | "Add text field" was clickable with no name and then errored. | Inconsistent with Place text and Add comment. | Disabled with a hint until a field name is entered. |

## Verified working (real Chromium, independent reopen of saved bytes)

`scripts/pdf-phase2-browser-acceptance.mjs` contains 27 checks, all passing locally on Linux. CI runs it on Linux and on `windows-latest`:

- **Navigation:** page-box jump race (57-page file) and empty-input revert.
- **Page operations:** duplicate, move earlier/later with undo and redo, blank page, delete with confirmation and undo, extract, split into two files, insert PDF, append PDF, permanent rotation and page labels.
- **Content:** placed text that exists as real PDF text, highlight rectangle, comment annotation with contents, form field creation, filling text/checkbox/dropdown/radio fields, flatten (fields removed and values still visible), bookmark (PDF.js outline) and internal link annotation.
- **Print:** the complete PDF bytes are handed to a separate viewer (`blob:`, `application/pdf`, `%PDF-`).
- **Input safety:** wrong-header and truncated files show a plain-language error; a password PDF goes through prompt → wrong → correct → read-only → edit refused; an owner-restricted PDF opens read-only.
- **Layouts:** letter, A4 landscape, A5 and tabloid pages with `/Rotate` 0/90/180/270 render at the correct aspect and keep their size and rotation through an edit.
- **Rendering and memory:** zoom out releases off-screen pages, which return at the new zoom. After scrolling a 100-page report, retained canvas memory stays bounded.
- **Original file:** the source bytes are never modified.

The existing `pdf-ui-browser-smoke.mjs` (Phase 1 and Phase 2 flows) still passes, as do 672 unit tests.

## Performance (production build, headless Chromium on a cloud Linux VM)

These figures are indicative only. They are not the fixed-Windows-hardware protocol from the audit plan.

| Metric (Master v2 §11) | Target | Measured |
|---|---|---|
| First usable page, typical 100-page PDF | p95 ≤ 3 s | p95 1.03 s (12 runs; p50 0.56 s) |
| Cached page switch | p95 ≤ 250 ms | p95 95 ms |
| Render standard page | p95 ≤ 1.5 s | new-page jump (render included) p95 109 ms |
| 1,000-page PDF | — | open p95 1.46 s; jump to page 900 p95 208 ms; 60 fps scroll with no long tasks |
| Canvas memory after a full scroll | bounded | 19 pages retained (100-page file), capped by the 48 MP budget |

## Not closed by this pass (owner or Windows only)

1. **Owner UAT** of the Phase 2 reader and editor on your own real PDFs (#238). Only you can record this.
2. **Clean-installed Windows desktop build:** open, save and print through the Tauri shell and the native file dialogs.
3. **Physical printer:** print a multi-page PDF that has rotated and landscape pages, and check order, orientation and margins.
4. **Disabled-by-design features** that stay off until their own validation exists: in-place editing of existing text, text-range highlight, the full form designer, redaction, encryption and digital signing (some of these belong to Phase 5).
5. **Fixed-hardware competitive benchmark** against Acrobat, Foxit, PDF-XChange and iLovePDF, as the audit plan describes.

### Manual Windows checklist (about 15 minutes)

- [ ] Install the current build on a clean Windows 10/11 PC and open a real 50+ page PDF from File Explorer.
- [ ] Type a page number, press Enter, and check that it lands on that page. Repeat near the last page.
- [ ] Open a scanned PDF that has rotated pages and check that they display the right way up.
- [ ] Rotate, delete and duplicate a page, then Save. Reopen the saved file in Edge or Acrobat and check the result.
- [ ] Open a password-protected PDF: try a wrong password, then the right one, and confirm the read-only notice.
- [ ] Print 5+ pages to a real printer, including a landscape page. Check order and orientation.
- [ ] Switch to Light theme and repeat one edit, checking the Organize controls and the page panel.
