# MALENJO PDF: complete 90-requirement code and UI review

> Review basis: the pinned 90-row Stirling parity matrix and current MALENJO source mapping. This is an engineering review, **not a Codex-generated report**, a browser pass, or a declaration of functional completion.

## Overall verdict

- **Release acceptance: BLOCKED**. The 90 rows remain `partial`, and none has passed full upstream behavioral parity, safe offline Windows operation, GUI input-output fidelity, licensing and golden regression acceptance.
- **Verified evidence is not identical to user experience.** The Codespaces execution suite saved/reopened real local artifacts, but it did not check actual mouse selection and most desktop providers. A separate Chromium UI acceptance job was added to test opening, selecting/copying, Find, tab retention, rotating, downloading and reopening.
- **High-severity UI faults identified:** no PDF.js selectable text layer; Find only listed matching pages and could not highlight in-page matches; browser exports revoked URLs immediately; the scratch PDF workspace was unmounted on navigation; page removal lacked a confirmation. Relevant source changes are under test in this branch.
- **Required to claim 90/90:** for each requirement, run actual user-facing workflows on representative documents, verify outputs with an independent parser or external validator, negative/error tests, browser/desktop acceptance, offline dependency provenance and Windows CI/GUI proof. A `sourcePath` or a passing mocked unit test never satisfies those criteria.

## 90-requirement, source-anchored audit register

Definitions: `Partial` means implementation source or limited tests exist. `Local evidence` means a function has been exercised in the Linux artifact suite, but does not prove parity or UI operation. `Provider` requires additional real local Windows/native provider testing. `Doc only` is not an executable PDF feature. Every listed requirement remains **unaccepted**.

| # | Upstream requirement | MALENJO implementation source | Current review / next acceptance requirement |
|---:|---|---|---|
| 1 | `merge-pdfs` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 2 | `split-pages` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 3 | `extract-pages` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 4 | `remove-pages` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 5 | `rearrange-pages` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 6 | `rotate-pdf` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 7 | `crop` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 8 | `scale-pages` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 9 | `add-page-numbers` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 10 | `pdf-to-single-page` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 11 | `multi-page-layout` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 12 | `booklet-imposition` | `src/suite/pdf/pdfBooklet.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 13 | `overlay-pdf` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 14 | `split-pdf-by-sections` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 15 | `split-pdf-by-chapters` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 16 | `auto-split-pdf` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 17 | `split-by-size-or-count` | `src/suite/pdf/splitByPageCount.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 18 | `add-attachments` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 19 | `pdf-to-img` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 20 | `img-to-pdf` | `src/suite/pdf/imageConvert.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 21 | `file-to-pdf` | `src/suite/pdf/plainTextToPdf.ts`, `src/suite/pdf/markdownToPdf.ts` | Partial — full GUI + golden I/O proof required |
| 22 | `pdf-to-word` | `src/suite/pdf/pdfOfficeText.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 23 | `pdf-to-presentation` | `src/suite/pdf/pdfToPresentation.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 24 | `pdf-to-text` | `src/suite/pdf/textExport.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 25 | `pdf-to-html` | `src/suite/pdf/pdfTextFormats.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 26 | `pdf-to-xml` | `src/suite/pdf/pdfToXml.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 27 | `pdf-to-markdown` | `src/suite/pdf/pdfTextFormats.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 28 | `pdf-to-csv` | `src/suite/pdf/pdfTextFormats.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 29 | `pdf-to-epub` | `src/suite/pdf/pdfToEpub.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 30 | `pdf-to-vector` | `src/suite/pdf/pdfTextVector.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 31 | `pdf-to-json` | `src/suite/pdf/pdfToJson.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 32 | `pdf-to-rtf` | `src/suite/pdf/pdfOfficeText.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Configuration only upstream — runnable behavior must be defined |
| 33 | `pdf-to-cbz` | `src/suite/pdf/pdfToCbz.ts`, `src/suite/pdf/pageImageExport.ts` | Partial — full GUI + golden I/O proof required |
| 34 | `pdf-to-cbr` | `src-tauri/src/suite/cbr.rs`, `src/suite/pdf/PdfCbrPanel.tsx` | Provider-dependent — real native execution and Windows UI still required |
| 35 | `pdf-to-pdfa` | `src-tauri/src/suite/pdfa.rs`, `src/suite/pdf/PdfaPanel.tsx` | Provider-dependent — real native execution and Windows UI still required |
| 36 | `html-to-pdf` | `src/suite/pdf/htmlToPdf.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 37 | `url-to-pdf` | `src-tauri/src/suite/url_capture.rs`, `src/suite/pdf/PdfUrlCapturePanel.tsx` | Provider-dependent — real native execution and Windows UI still required |
| 38 | `markdown-to-pdf` | `src/suite/pdf/markdownToPdf.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 39 | `eml-to-pdf` | `src/suite/pdf/emlToPdf.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 40 | `cbz-to-pdf` | `src/suite/pdf/cbzToPdf.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 41 | `json-to-pdf` | `src/suite/pdf/jsonToPdf.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Configuration only upstream — runnable behavior must be defined |
| 42 | `vector-to-pdf` | `src/suite/pdf/svgToPdf.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Configuration only upstream — runnable behavior must be defined |
| 43 | `add-password` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 44 | `remove-password` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 45 | `change-permissions` | `src-tauri/src/suite/security.rs`, `src-tauri/src/lib.rs` | Provider-dependent — real native execution and Windows UI still required |
| 46 | `add-watermark` | `src/suite/security/secureExport.ts`, `src/suite/security/SecurityWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 47 | `add-stamp` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 48 | `sanitize-pdf` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 49 | `flatten` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 50 | `unlock-pdf-forms` | `src/suite/pdf/formUnlock.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 51 | `cert-sign` | `src-tauri/src/suite/security.rs`, `src/suite/security/api.ts` | Provider-dependent — real native execution and Windows UI still required |
| 52 | `sign` | `src/suite/pdf/pdfVisualSignature.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 53 | `timestamp-pdf` | `src-tauri/src/suite/tsa.rs`, `workers/tsa/local_pdf_timestamp.py` | Provider-dependent — real native execution and Windows UI still required |
| 54 | `remove-cert-sign` | `src/suite/pdf/pdfUnsignedCopy.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 55 | `validate-signature` | `src-tauri/src/suite/security.rs`, `src/suite/security/SignWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 56 | `verify-pdf` | `src/suite/pdf/pdfPreflight.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | No pinned upstream endpoint — verify exact contract and GUI interaction |
| 57 | `redact` | `src/suite/security/secureExport.ts`, `src/suite/security/SecurityWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 58 | `auto-redact` | `src/suite/pdf/pdfAutoRedact.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 59 | `extract-images` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 60 | `extract-image-scans` | `src/suite/pdf/pdfScanExtraction.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 61 | `remove-image-pdf` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 62 | `remove-annotations` | `src/suite/pdf/review.ts`, `src/suite/pdf/pdfAnnotationCleanup.ts` | Real local artifact output tested; GUI parity and negative cases remain |
| 63 | `remove-blanks` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 64 | `ocr-pdf` | `src/suite/pdf/pdfLocalOcr.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Provider-dependent — real native execution and Windows UI still required |
| 65 | `text-editor-pdf` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 66 | `edit-table-of-contents` | `src/suite/pdf/pdfOutlineTree.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 67 | `update-metadata` | `src/suite/pdf/pdfMetadataEdit.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 68 | `get-info-on-pdf` | `src/suite/pdf/pdfInfo.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 69 | `compare` | `src/suite/pdf/textCompare.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 70 | `adjust-contrast` | `src/suite/pdf/pdfRasterEffects.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 71 | `replace-invert-pdf` | `src/suite/pdf/pdfRasterEffects.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 72 | `scanner-effect` | `src/suite/pdf/pdfRasterEffects.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | No pinned upstream endpoint — verify exact contract and GUI interaction |
| 73 | `repair` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 74 | `add-image` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 75 | `fields` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 76 | `fill` | `src/suite/pdf/editor.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 77 | `modify-fields` | `src/suite/pdf/formManagement.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 78 | `delete-fields` | `src/suite/pdf/formManagement.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 79 | `multi-tool` | `src/suite/pdf/pdfOfflinePipeline.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 80 | `compress-pdf` | `src/suite/pdf/pdfTwentyWorkflows.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 81 | `automate` | `src/suite/pdf/pdfOfflinePipeline.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 82 | `pipeline` | `src/suite/pdf/pdfOfflinePipeline.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 83 | `auto-rename` | `src/suite/pdf/pdfAutoRename.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Real local artifact output tested; GUI parity and negative cases remain |
| 84 | `view-pdf` | `src/suite/pdf/engine.ts`, `src/suite/pdf/PdfWorkspace.tsx` | Partial — full GUI + golden I/O proof required |
| 85 | `show-javascript` | `src/suite/pdf/pdfPreflight.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Partial — full GUI + golden I/O proof required |
| 86 | `dev-api-docs` | `src/suite/pdf/pdfApiManual.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Doc only — not a working runtime feature |
| 87 | `dev-folder-scanning-docs` | `src/suite/pdf/pdfDeveloperGuides.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Doc only — not a working runtime feature |
| 88 | `dev-sso-guide-docs` | `src/suite/pdf/pdfDeveloperGuides.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Doc only — not a working runtime feature |
| 89 | `dev-airgapped-docs` | `src/suite/pdf/pdfDeveloperGuides.ts`, `src/suite/pdf/PdfProviderToolsPanel.tsx` | Doc only — not a working runtime feature |
| 90 | `handleData` | `src/suite/pdf/pdfPipelineHandler.ts`, `src/suite/pdf/pdfOfflinePipeline.ts` | Real local artifact output tested; GUI parity and negative cases remain |

## Critical product acceptance tests added

1. Browser opens an actual PDF into a normal document tab, not a disposable module-only component.
2. A real PDF.js text layer overlays canvas pixels, exposing an I-beam and real text selection. Image-only PDFs must report the need for OCR, not fake searchable text.
3. Find opens from a visible toolbar button or Ctrl+F; searches real selectable text and highlights matching text nodes without interpreting untrusted PDF strings as HTML.
4. Page removal needs explicit confirmation, must be undoable, and must not mutate the user's source PDF.
5. Browser PDF/tool exports must keep `blob:` URLs valid until the download has completed. Downloads must parse as actual PDFs.
6. Switching from the PDF workspace to Home and back must preserve the browser document tab. A full browser reload still loses in-memory sessions; persistent storage is a separate outstanding design/acceptance item.

## Risk triage / next practical implementation work

**P0:** Complete the real Chromium UI acceptance job, reproduce and fix any timing, text-layer alignment, CSS stacking and download failures. Add persisted browser working-copy recovery with clear consent and storage bounds so accidental reloads do not lose unsaved work.

**P1:** Run each GUI flow and classify provider-dependent controls as unavailable with actionable explanations. Exercise local OCR and fallback/font fidelity; ensure image-only docs have truthful text-selection/search behavior.

**P2:** Improve keyboard and accessible control labels, active toolbar status, loading indicators, search cancellation, large-document performance, page organization and recovery, multi-document comparison.

**P3:** Finish independently validated local toolchain integration, upstream edge-case parity and air-gapped Windows acceptance, then consider release/installer only after a 90/90 audited pass.

### Review guardrails

- Never mark any of these rows fully implemented merely because its implementation path exists or because local PDF creation succeeds.
- For actual deletion concerns, note that the browser File API does not delete an original disk file, but previously temporary sessions could disappear on UI navigation; test the exact UI event independently.
- Keep Windows packaging/release gate blocked. No forced merge or release approval is implied by this audit.

