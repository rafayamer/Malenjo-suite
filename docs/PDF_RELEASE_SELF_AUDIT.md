# MALENJO PDF: internal release-readiness audit

**Audited baseline:** source-pinned PDF parity register, current PR #202 branch, GitHub Windows provider smoke contract, and source-visible native bindings. **This is not a claim of functional acceptance of every operation.** The executable gate is `npm run pdf:release-status` (machine-readable: `node scripts/pdf-release-readiness.mjs --json`; strict: `npm run pdf:release-check`).

## Decision

**Full PDF parity release is blocked.** Exactly 90 handoff requirements are enumerated; **0 carry complete acceptance evidence**. There are 57 native/source-backed partial foundations plus 19 source-audited provider-dispatch-only partial integrations (76 partial total), with 14 implementation-source-unaudited requirements. The eight newly source-mapped native workflows remain partial: they are bounded feature subsets, not Windows-accepted upstream equivalence. The passing CI pipeline proves builds, tests and a subset of provider smoke routes, not the whole Windows installer + UI end-to-end matrix. The `tauri:release` command now fails closed until all 90 requirements have explicit acceptance evidence. Ordinary development builds remain possible.

The review's two PNG defects have implementation-level fixes in `pngIntegrity.ts` with Adam7/filter/palette positive and negative tests. This is not enough to accept PDF-to-images or extract-images as end-to-end workflows without live output saved and reopened on Windows.

## Scope classification

| Group | Requirements | Source-backed partial | Awaiting implementation audit |
|---|---:|---:|---:|
| page | 18 | 18 | 0 |
| conversion | 24 | 20 | 4 |
| security | 16 | 11 | 5 |
| scan-extraction | 6 | 5 | 1 |
| editing-analysis | 10 | 10 | 0 |
| forms | 4 | 4 | 0 |
| automation-view-developer | 12 | 8 | 4 |

## Audited requirement inventory

Classification is grounded in the existing pinned manifest: **native partial** means an in-repository implementation/test symbol was identified, not full upstream behavior; **provider-dispatch partial** means a tested UI-to-OpenAPI selector and output validation exist but real feature processing and Windows acceptance have NOT been demonstrated; **route-only** means a backend endpoint is source-pinned but this register lacks a verified local implementation mapping; **frontend-only** or **configuration-only** is not proof that any usable handler exists. A Windows smoke call is narrower than full operation acceptance.

| # | Requirement | Current code evidence | Windows provider smoke | Release disposition |
|---:|---|---|---|---|
| 1 | `merge-pdfs` | Native partial | Route exercised (partial) | Partial; full parity and Windows acceptance pending |
| 2 | `split-pages` | Native partial | Route exercised (partial) | Partial; full parity and Windows acceptance pending |
| 3 | `extract-pages` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 4 | `remove-pages` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 5 | `rearrange-pages` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 6 | `rotate-pdf` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 7 | `crop` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 8 | `scale-pages` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 9 | `add-page-numbers` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 10 | `pdf-to-single-page` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 11 | `multi-page-layout` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 12 | `booklet-imposition` | Native vector spread partial | No matching execution proof | Partial; advanced printing and Windows acceptance pending |
| 13 | `overlay-pdf` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 14 | `split-pdf-by-sections` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 15 | `split-pdf-by-chapters` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 16 | `auto-split-pdf` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 17 | `split-by-size-or-count` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 18 | `add-attachments` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 19 | `pdf-to-img` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 20 | `img-to-pdf` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 21 | `file-to-pdf` | Native TXT-only partial | No matching execution proof | Partial; Office input formats and Windows acceptance pending |
| 22 | `pdf-to-word` | Native text-only partial | No matching execution proof | Partial; layout fidelity and Windows acceptance pending |
| 23 | `pdf-to-presentation` | Native raster PPTX partial | Route exercised (partial) | Partial; true editable-slide parity and Windows application acceptance pending |
| 24 | `pdf-to-text` | Native partial | Route exercised (partial) | Partial; full parity and Windows acceptance pending |
| 25 | `pdf-to-html` | Native partial (text-only) | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 26 | `pdf-to-xml` | Native partial | Route exercised (partial) | Partial; full parity and Windows acceptance pending |
| 27 | `pdf-to-markdown` | Native partial (text-only) | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 28 | `pdf-to-csv` | Native partial (text-only) | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 29 | `pdf-to-epub` | Native reflowable text partial | No matching execution proof | Partial; layout, graphics and Windows acceptance pending |
| 30 | `pdf-to-vector` | Configuration only | No matching execution proof | Not audited; implementation and acceptance pending |
| 31 | `pdf-to-json` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 32 | `pdf-to-rtf` | Native text-only partial | No matching execution proof | Partial; layout fidelity and Windows acceptance pending |
| 33 | `pdf-to-cbz` | Native partial (rasterized) | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 34 | `pdf-to-cbr` | Frontend-only alias | No matching execution proof | Not audited; implementation and acceptance pending |
| 35 | `pdf-to-pdfa` | Pinned API route only | No matching execution proof | Not audited; implementation and acceptance pending |
| 36 | `html-to-pdf` | Native HTML text-only PDF partial | No matching execution proof | Partial; CSS/images/typography and Windows acceptance pending |
| 37 | `url-to-pdf` | Pinned API route only | No matching execution proof | Not audited; implementation and acceptance pending |
| 38 | `markdown-to-pdf` | Native Markdown render partial | No matching execution proof | Partial; full Markdown fidelity and Windows acceptance pending |
| 39 | `eml-to-pdf` | Native text/plain MIME partial | No matching execution proof | Partial; HTML, attachments, Windows reopen pending |
| 40 | `cbz-to-pdf` | Native PNG/JPEG CBZ partial | No matching execution proof | Partial; full format parity and Windows acceptance pending |
| 41 | `json-to-pdf` | Native JSON text-report partial | No matching execution proof | Partial; visual conversion and Windows acceptance pending |
| 42 | `vector-to-pdf` | Native SVG vector-subset partial | No clean installed-Windows proof | Partial; arbitrary SVG and EPS parity and Windows acceptance pending |
| 43 | `add-password` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 44 | `remove-password` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 45 | `change-permissions` | Frontend-only alias | No matching execution proof | Not audited; implementation and acceptance pending |
| 46 | `add-watermark` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 47 | `add-stamp` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 48 | `sanitize-pdf` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 49 | `flatten` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 50 | `unlock-pdf-forms` | Native AcroForm flag partial | No matching execution proof | Partial; Windows accepted save/reopen pending |
| 51 | `cert-sign` | Pinned API route only | No matching execution proof | Not audited; implementation and acceptance pending |
| 52 | `sign` | Native graphical mark partial | No matching execution proof | Partial; handwriting/cert signing and Windows acceptance pending |
| 53 | `timestamp-pdf` | Pinned controller only | No matching execution proof | Not audited; implementation and acceptance pending |
| 54 | `remove-cert-sign` | Pinned API route only | No matching execution proof | Not audited; implementation and acceptance pending |
| 55 | `validate-signature` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 56 | `verify-pdf` | Native read-only preflight partial | No matching execution proof | Partial; full feature semantics and Windows acceptance pending |
| 57 | `redact` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 58 | `auto-redact` | Pinned API route only | No matching execution proof | Not audited; implementation and acceptance pending |
| 59 | `extract-images` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 60 | `extract-image-scans` | Native image-only page PNG ZIP partial | No matching execution proof | Partial; embedded image extraction and OCR-layer scan detection pending |
| 61 | `remove-image-pdf` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 62 | `remove-annotations` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 63 | `remove-blanks` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 64 | `ocr-pdf` | Pinned API route only | Route exercised (partial) | Not audited; implementation and acceptance pending |
| 65 | `text-editor-pdf` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 66 | `edit-table-of-contents` | Native nested /Outlines partial | No exact Windows execution proof | Partial; named destination editing and Windows acceptance pending |
| 67 | `update-metadata` | Native partial | Route exercised (partial) | Partial; full parity and Windows acceptance pending |
| 68 | `get-info-on-pdf` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 69 | `compare` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 70 | `adjust-contrast` | Native page-raster contrast partial | No matching execution proof | Partial; no preview or content-preserving adjustments |
| 71 | `replace-invert-pdf` | Native page-raster inversion partial | Route exercised (partial) | Partial; no color-profile/vector preserving inversion |
| 72 | `scanner-effect` | Native grayscale scan-look partial | Route exercised (partial) | Partial; deskew/noise presets and Windows acceptance pending |
| 73 | `repair` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 74 | `add-image` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 75 | `fields` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 76 | `fill` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 77 | `modify-fields` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 78 | `delete-fields` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 79 | `multi-tool` | Native JSON page multi-tool partial | No matching execution proof | Partial; rotate/delete/move only, no general multi-tool |
| 80 | `compress-pdf` | Provider-dispatch partial | Route known; operation-specific result unverified | Partial source wiring; real Windows processing and release acceptance pending |
| 81 | `automate` | Native one-shot page automation partial | No matching execution proof | Partial; no scheduling/folder watch/trigger workflow |
| 82 | `pipeline` | Native JSON page pipeline partial | No matching execution proof | Partial; only rotate/delete/move, no general Stirling pipeline |
| 83 | `auto-rename` | Native metadata-title partial | No matching execution proof | Partial; content-aware rename and Windows acceptance pending |
| 84 | `view-pdf` | Native partial | No matching execution proof | Partial; full parity and Windows acceptance pending |
| 85 | `show-javascript` | Native read-only preflight partial | No matching execution proof | Partial; full feature semantics and Windows acceptance pending |
| 86 | `dev-api-docs` | Live diagnostics partial | No matching execution proof | Partial; full developer reference and Windows acceptance pending |
| 87 | `dev-folder-scanning-docs` | Frontend-only alias | No matching execution proof | Not audited; implementation and acceptance pending |
| 88 | `dev-sso-guide-docs` | Frontend-only alias | No matching execution proof | Not audited; implementation and acceptance pending |
| 89 | `dev-airgapped-docs` | Frontend-only alias | No matching execution proof | Not audited; implementation and acceptance pending |
| 90 | `handleData` | Pinned controller only | No matching execution proof | Not audited; implementation and acceptance pending |

The new bounded offline HTML, page-raster, scan extraction and page-pipeline workflows have source and automated test mappings. They are **partial** and require iterative user diagnosis, fidelity extensions, and later Windows validation; this inventory does not certify implementation completeness or release readiness.

## Mandatory per-feature acceptance record

An operation can be marked accepted only when its **exact implementation source**, UI command binding, licensing/attribution, positive and negative real fixtures, resource/memory limits, signed/encrypted/corrupt-input refusal, expected output semantics, installer-running-offline Windows execution, provider response evidence, save/reopen fidelity, and **manual Windows approval for a specific tested build SHA** are recorded in the machine-readable matrix. `--strict` rejects any missing item. All 90 must pass the release command; status is not inferred from the presence of an OpenAPI endpoint or from a passing unit test.

**Unresolved cross-cutting release gates:** source-file licenses and redistribution notices, standalone Windows installer installation on a machine with no Java/qpdf/Tesseract preinstalled, UI workflows for each target endpoint, source-byte preservation and undo/redo after failure, signature/encryption/XFA handling, memory limits and decompression bombs, robust handling of malformed document/image data, output copy integrity and reopen, image fidelity, edge cases for OCR and conversions, and manual acceptance. Some pinned upstream features require remote timestamp authorities or third-party binaries; they cannot be claimed as fully offline without a lawful locally deployable alternative and acceptance evidence. Developer/documentation tools require an explicit, separately approved applicability rubric.

## Next execution order

1. Run `npm run test:pdf-release-gate`, `npm test`, Windows Rust checks, and the pinned provider smoke suite on every change. Confirm every workflow exercises a **real input** and independently reopen/verify its output. Negative fixtures must prove refusal without data loss.
2. Complete a function-by-function code inspection and real Windows positive/negative execution for all 20 current batch workflows; do not promote whole batches merely because their dispatcher is tested. Finish the other 70 in feature categories.
3. Record acceptance evidence **per operation**, including the Windows build SHA and provenance. Use `npm run pdf:release-check` as the release gate; ensure all applicable feature claims are justified before a signed installer is distributed.

**Do not merge PR #202 or claim full PDF parity acceptance solely from this audit file.**
