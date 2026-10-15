# MALENJO — PDF 2.0 functional acceptance and accessible Lottie motion contract

**Owner directive:** Support the full applicable PDF 2.0 interoperability contract AND make all 90 MAL-001..MAL-090 PDF tools work successfully, smoothly and honestly. Use the maximum useful, legally reusable **free** LottieFiles animations without compromising accessibility, source integrity or performance.

**Status:** NOT COMPLETED. This file records acceptance criteria, not evidence of implementation or acceptance.

## Distinguish the two independent contracts

1. **File-format compatibility:** ISO 32000-2:2020 (PDF 2.0), reference: https://www.iso.org/standard/75839.html. Test PDF files with declared PDF version 2.0, PDF 1.x backwards compatibility, page content, graphics, fonts and Unicode, color management, structure/tags, links, annotations, form fields, embedded files, metadata, encryption, incremental save, digital signatures and feature-specific edge cases. Not every optional feature is necessarily implemented by the current PDF.js/pdf-lib/Stirling providers. A successful open is **not** blanket PDF 2.0 write/edit compatibility.
2. **Product command completeness:** All 90 named MAL-001..MAL-090 tool IDs in `docs/MALENJO_MASTER_SPEC_V2.md`; every documented sub-operation must have discoverable UI, real execution, correct permissions, precise success/error behavior, validated source preservation, independent output reopen, undo/redo where applicable, and positive/negative tests. **Do not confuse 90 commands with the PDF 2.0 ISO feature inventory.**

### Acceptance matrix (all entries binary only)

| Gate | Completion evidence required |
| --- | --- |
| PDF 2.0 parser/reader | Independent real-file corpus, declared version detected, rendering fidelity, text extraction, search, links, annotations, tags, page geometry and optional constructs checked with a second tool |
| PDF 2.0 writer and mutation | Save/export/reopen at expected file version, checks of affected and unaffected objects, original-byte protection, signing/form/layer preservation or explicit refusal |
| MAL-001..090 | Each command, every source-required subcase and multi-step workflow executed; error states, cancellation and correct output proved |
| 2 GB / 10,000 pages | Representative large-file stress, bounded memory and an explicit tested complexity tier; no success claim from metadata only |
| Performance | Actual p50/p95 on fixed hardware, corpus SHA-256, memory/CPU, cold/warm cache, safety checks, and exact-head CI/browser artifacts |
| Accessibility | Keyboard-only, screen reader, focus, Light/Dark, zoom, high DPI and reduced-motion coverage |
| Security | Unsafe URLs, malformed/encrypted PDFs, PDF JavaScript/actions, embedded file handling, redaction extraction, signature validity and negative-case policy |
| Owner acceptance | Separate owner visual and real-file UAT after engineering gates; final Windows release gate remains independent |

Targets from §11 of owner v2 specification: typical 100-page open-to-usable-page p95 ≤3 s; cached page switch ≤250 ms; text edit response ≤200 ms; standard page rendering ≤1.5 s; OCR 300 DPI ≤5 s; indexed 1000-page search ≤3 s; metadata API ≤300 ms. **Targets are not measured achievements.**

## Reusable free animations from LottieFiles

Primary runtime: https://github.com/LottieFiles/dotlottie-web (React distribution `@lottiefiles/dotlottie-react`). Download assets only from individually verified free animation pages; log creator, exact URL, date, SHA-256, source-file format, optimized size and applicable Lottie Simple License: https://lottiefiles.com/page/license. Only licence-approved free assets may be embedded; avoid Premium and assets with conflicting rights. Prefer optimized .lottie or JSON with no remote images, fonts or fetches. Preserve the license conditions in notices, including when modifying files.

Candidate **free** assets to review and download locally (links are evidence of free catalogue entries, NOT evidence of files already bundled):

- Open File / hover: Dorairaj Kichidi, “Folder open” https://lottiefiles.com/free-animation/folder-open-FWhqOXXLHf
- Open File / compact alternative: Ashish Negi, “Open Folder” https://lottiefiles.com/free-animation/open-folder-KfEV7jVKvp
- File intake: basharat rasool, “Document” https://lottiefiles.com/free-animation/documents-CJAri2GOqi
- Document loading: Tony Sebastian, “Document Loading” https://lottiefiles.com/free-animation/document-loading-oorW3LW2Rc
- Loading alternative: Nick Baxter, “Document Loading” https://lottiefiles.com/free-animation/document-loading-DFBHQaZbIH

### Motion placement and guardrails

Use **as many meaningful** small animations as practical on: Home Open File/Recent Files; file validation/import; queued/running/done/failed/cancelled conversion; save/export completion; search empty/no-match; OCR progress; AI waiting; successful backup; empty and recovery states. Reuse assets when semantically appropriate; never animate every toolbar icon or PDF page. Static accessible text/status is mandatory.

- Prefer local bundled files and a lazy-loaded runtime; **no third-party network calls** when opening user documents, and no on-startup animation downloads.
- Respect `prefers-reduced-motion: reduce` and provide a static alternative; do not rely on animation to communicate state.
- Pause or do not mount out-of-viewport, inactive-tab or background animations; no perpetual decoration while a user edits.
- Apply explicit asset size and concurrent-animation budgets, and measure their effect on PDF opening, navigation, CPU, memory and p95 responsiveness.
- Keep MALENJO Light/Dark blue/cyan palette and contrast; do not alter actual PDF/CAD/DICOM source pixels or copy competitor trade dress.

## Mandatory three-pass implementation process

1. Audit → fix → edit, including source/negative cases for PDF 2.0 and all applicable MAL-001..090 suboperations.
2. Re-audit → fix → edit; source-byte checks, independent reopen and realistic user-input regressions.
3. Audit again → optimize performance, memory and UI; compare workflows on identical hardware against Acrobat, Foxit, PDF-XChange Editor and iLovePDF; fix measured bottlenecks, rerun all tests.

**Release rules:** only COMPLETED or NOT COMPLETED. Earlier phase must pass all acceptance gates before later phase is actively advanced or declared COMPLETED. Changes are allowed solely on development/verification branches; **no `main` merge, installer or public release** without owner authorization. Do not mark standard compliance, all 90 commands, animation asset curation, CI, owner UAT or performance targets as passed without actual evidence.
