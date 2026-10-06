# PDF completion pass 2B — Tesseract OCR provider

Tracking issue: #143  
Base main: `3f7dfe08f7959fbbf5740a6834570be63503352b`  
Stirling open-core pin: `25220cbdbde2d526cebf173b94357884e180b8c1`  
PDF registry state: **partial**.

## Scope

This bounded pass addresses the Tesseract-backed Stirling operation family only:

- `/api/v1/misc/ocr-pdf`
- `/api/v1/misc/auto-rotate-pdf`

It does not close #143 and does not imply the PDF module is complete.

## Reviewed Windows component

Tesseract:

- version: **5.5.3**
- official upstream asset: `tesseract-ocr-w64-setup-5.5.3.20260724.exe`
- asset SHA-256: `bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4`
- Tesseract core license: Apache-2.0

Offline OCR data:

- source: `tesseract-ocr/tessdata_fast`
- commit: `87416418657359cb625c412a48b6e1d6d41c29bd`
- `eng.traineddata` Git blob: `bbef4675053b5b468cdb477053e28b1c698ba08e`
- `osd.traineddata` Git blob: `527457ca8f8fe1fda7c2f88bce3c0e4be12be9d0`
- model-data repository license: Apache-2.0

## Offline/Windows architecture

MALENJO does not run the upstream NSIS installer. The builder:

1. downloads only the exact official installer asset;
2. verifies its SHA-256;
3. extracts it with 7-Zip rather than installing it;
4. preserves the executable's adjacent runtime files in the MALENJO provider pack;
5. downloads `eng` and `osd` only from the exact tessdata commit;
6. verifies model Git blob identities;
7. emits a runtime inventory, manifest and CycloneDX component SBOM.

The Tauri bundle maps the generated pack to `provider-packs/tesseract/`. The Rust provider boundary detects the reviewed executable/data, places only reviewed provider directories on the Stirling child PATH, and sets `TESSDATA_PREFIX` to the local pinned data. The user's PATH is not inherited.

No OCR process is started at MALENJO launch. Stirling remains on-demand and loopback-only.

## Capability truth

Native component readiness is merged into the MALENJO-owned provider contract. `ocr-pdf` and scanned-page `auto-rotate-pdf` are operational only when the reviewed Tesseract executable and both required data files are present. Missing executable or data keeps the operation unavailable.

OCRmyPDF is not used as the business redistribution path in this pass because its common runtime stack introduces the Ghostscript boundary.


The pinned Stirling direct-Tesseract fallback does not implement OCRmyPDF-only request controls such as deskew/cleanup/remove-images and does not provide equivalent sidecar semantics. MALENJO therefore removes those fields from the operational Tesseract-backed tool surface instead of presenting them as working options. The direct Tesseract surface exposes only the active PDF, language selection, and OCR mode.

## Windows executable gate

The provider CI job builds both qpdf and Tesseract packs, builds the reviewed Stirling core, and starts Stirling on `127.0.0.1:28970` with an isolated provider PATH. It then exercises:

- Repair
- Compress PDF
- OCR PDF using Tesseract `eng`
- Auto Rotate PDF using Tesseract OSD path

Returned PDF outputs are signature-checked.

## Legal release gate

Functional integration is not equivalent to final redistribution approval. Tesseract's official Windows build workflow installs a moving MSYS2 package set rather than a dependency lock. The exact extracted DLL inventory therefore still needs source package/version/license mapping and retained notices before a business distributable can be approved.

Status for this pass: **integration-approved / release-gated**.

## Completion boundary

Still open under #143 after this pass include Office conversion, HTML/URL/EML conversion, Ghostscript-only feature replacements, EPUB replacement, scan extraction/OpenCV, CBR, MALENJO-owned form detection, and final release-legal/installed-package gates.

PDF remains **partial**.
