# PDF provider packs — pass 2 licensing and qpdf integration

## Status

Parent PDF completion: #141  
Provider-gap tracking: #143  
PDF registry state: **partial**.

This pass begins replacing/packaging the external executables that the reviewed Stirling open core expects on a clean Windows PC.

## qpdf — implemented provider pack

Pinned component:

- upstream: `qpdf/qpdf`;
- version: `12.4.2`;
- Windows x64 release: `qpdf-12.4.2-msvc64.zip`;
- official release SHA-256: `db87077e683630c1217e0e8f9a20a9749d952ab676e881c3689187763a5de25d`;
- license: Apache-2.0;
- exact upstream license/NOTICE retained under `third_party/qpdf/`.

`scripts/install-qpdf-pack.ps1` downloads only that pinned release asset, verifies the SHA-256 before extraction, preserves the binary distribution root, verifies `qpdf --version`, and writes a generated provider manifest.

Generated binaries are not committed. Tauri packages the provider-pack directory for release builds after the release pipeline has materialized it.

The local Stirling child receives a MALENJO-controlled PATH that prepends the verified qpdf executable directory. qpdf is therefore available only to the local provider process and does not require machine-global installation.

Provider status now reports qpdf readiness/version through the MALENJO-owned `PdfProviderStatus.components` contract.

## Remaining external-provider legal matrix

This table is a **planning classification**, not a bundling claim.

| Upstream dependency observed by Stirling | Current license direction | MALENJO decision |
|---|---|---|
| qpdf | Apache-2.0 | **Bundle as verified component pack — implemented in this pass.** |
| Tesseract OCR | Apache-2.0; Leptonica permissive | Candidate for a reviewed Windows OCR pack; exact binary/model provenance still required. |
| OCRmyPDF | MPL-2.0 | Candidate, but its exact Python dependency graph and external-tool requirements must be reviewed before redistribution. |
| LibreOffice | MPL-2.0 core with additional per-component licenses | Candidate component pack; binary distribution notices/transitives must be preserved. |
| WeasyPrint | BSD-3-Clause | Candidate Python/provider pack; exact Cairo/Pango/native dependency notices still required. |
| OpenCV 4.5+ | Apache-2.0 | Candidate/current scanner foundation; exact Windows binary pack review required. |
| Ghostscript | AGPLv3 or commercial license | **Do not bundle under the intended closed-source/business profile without a commercial Artifex license.** Replace its PDF functions where possible with permissive MALENJO/qpdf/PDFBox/raster implementations. |
| Poppler / pdftohtml | GPL-family | Do not make it a required bundled closed-source provider. Replace HTML/Markdown extraction with MALENJO/PDF.js/PDFBox-compatible paths. |
| calibre / ebook-convert | GPL-family | Do not make it a required bundled closed-source provider. Implement/export EPUB through a compatible MALENJO path instead. |
| rar encoder | proprietary | Do not redistribute casually. CBR output needs a lawful replacement or separately licensed optional provider. |
| unoconvert | review pending | Not bundled until exact version, license and transitive boundary are pinned. |
| form-detection model | model-specific | Not bundled until model source, checksum, license and inference runtime are pinned. |

## Windows validation gate

The `stirling-core-windows` CI job now:

1. installs the pinned qpdf provider pack;
2. verifies the exact qpdf version;
3. adds the qpdf executable directory to the job PATH;
4. builds the reviewed Stirling core JAR;
5. starts the local provider on `127.0.0.1:28970`;
6. smoke-tests health/OpenAPI;
7. verifies qpdf remains callable in the provider process environment.

## Completion boundary

This does not close #143. A clean Windows machine still lacks other optional executables used by Stirling. Each must be either:

- bundled under a reviewed business-compatible provider pack;
- replaced by a compatible MALENJO implementation; or
- explicitly excluded only if the canonical MALENJO source marks the function not applicable.

No unavailable Stirling operation may be represented as operational, and the PDF module remains `partial`.
