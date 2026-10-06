# PDF completion pass 2B — Tesseract OCR / OSD provider

Tracking issue: #143  
Base main: `3f7dfe08f7959fbbf5740a6834570be63503352b`  
Stirling open-core pin: `25220cbdbde2d526cebf173b94357884e180b8c1`  
PDF registry state: **partial**.

## Source truth

Engine:
- Tesseract OCR `5.5.3`
- release commit `db0ec62f81b0737fbbe184d8fea40af5738f8eef`
- GitHub reports the annotated release tag PGP signature as verified
- Windows x64 upstream asset `tesseract-ocr-w64-setup-5.5.3.20260724.exe`
- asset SHA-256 `bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4`
- engine license: Apache-2.0

Model data:
- `tessdata_fast` release tag `4.1.0`, commit `65727574dfcd264acbb0c3e07860e4e9e9b22185`
- GitHub reports the annotated model release tag PGP signature as verified
- `eng.traineddata`: Git blob `bbef4675053b5b468cdb477053e28b1c698ba08e`
- `osd.traineddata`: Git blob `527457ca8f8fe1fda7c2f88bce3c0e4be12be9d0`
- model repository license: Apache-2.0

## Hermetic packaging rule

The upstream NSIS installer contains language sections that download from mutable `tessdata_fast/main`. MALENJO never executes those sections.

The pack builder:
1. checksum-verifies the official installer;
2. extracts it with 7-Zip without executing it;
3. copies the runtime payload needed by `tesseract.exe`;
4. downloads only the two immutable model blobs from the pinned commit;
5. verifies exact Git blob IDs and expected byte sizes;
6. verifies `tesseract --version` and `--list-langs`;
7. retains engine/model licenses and dependency record;
8. inventories every runtime file by SHA-256;
9. emits a CycloneDX 1.5 component SBOM.

## Runtime boundary

MALENJO native status only reports Tesseract available when:
- the executable is present;
- it reports a 5.x version;
- both `eng.traineddata` and `osd.traineddata` are present.

The Stirling child receives:
- a PATH containing only reviewed/configured qpdf and Tesseract directories;
- `TESSDATA_PREFIX` pointing at the reviewed local model directory.

The user/machine PATH is not modified and is not inherited by Stirling, preventing unreviewed Ghostscript/LibreOffice/Tesseract installations from silently changing provider selection.

## Capability effect

When the reviewed pack is present:
- OCR PDF resolves to Tesseract 5.5.3 instead of unavailable OCRmyPDF/Tesseract state;
- Auto Rotate PDF resolves to Tesseract OSD;
- provider status reports implementation/version/component pack.

When the pack is absent, both operations remain unavailable in the MALENJO provider contract.

## Windows operation gate

The Windows provider job builds qpdf + Tesseract + reviewed Stirling core, then:
- starts Stirling on `127.0.0.1:28970`;
- checks OpenAPI for Repair, Compress, OCR PDF, and Auto Rotate;
- generates a text-dense PDF fixture;
- runs `ocr-pdf` with English force-OCR;
- runs `auto-rotate-pdf` with `detectionMode=osd`;
- verifies every returned PDF signature.

## Redistribution boundary

Tesseract and the pinned model files are Apache-2.0, but the upstream Windows installer is assembled from a rolling MSYS2 DLL graph. Its public release workflow records top-level package names but does not expose a complete immutable package-version/license tuple for every extracted DLL.

Therefore the pack is **integration-approved / release-gated**. Final distributable approval requires mapping every inventoried non-system DLL to exact package/version/license and retaining all corresponding obligations.

This pass advances #143 but does not close it and does not promote PDF above `partial`.


## Executed CI evidence

GitHub Actions CI **#292** on the pass-2B implementation head passed all four jobs:

- frontend typecheck/tests/build;
- Windows Rust check/tests;
- Codespaces/Linux Rust check/tests;
- Windows provider pack + Stirling operation smoke.

The Windows provider job produced a Tesseract pack with **144 inventoried runtime files**, started the pinned Stirling core with the reviewed local Tesseract data path, successfully completed the Tesseract OCR PDF operation, required a positive forced-OSD dry-run verdict (`method=osd`, `detectedByOsd >= 1`), and then completed the PDF-producing Auto Rotate operation. Repair and Compress remained green in the same isolated local-provider environment.

This is integration evidence only. It does not remove the Tesseract DLL redistribution release gate and does not make the PDF module complete.


## Direct Tesseract control truth

The pinned Stirling OCR controller accepts a broad request model because OCRmyPDF can provide deskew/clean/sidecar/render/image-removal features. Its direct Tesseract fallback actually consumes only the input PDF, selected languages and OCR type.

MALENJO therefore filters the runtime OCR form when the resolved provider is Tesseract and exposes only:
- `fileInput`;
- `languages`;
- `ocrType`.

`sidecar`, `deskew`, `rotatePages`, `clean`, `cleanFinal`, `ocrRenderType` and `removeImagesAfter` are not advertised as Tesseract-backed controls. Auto-rotation remains a separate reviewed Tesseract OSD operation.


## Configured-provider provenance hardening

Review hardening requires configured provider paths to remain truthful after Stirling changes its child working directory:

- `MALENJO_QPDF_BIN` and `MALENJO_TESSERACT_BIN` are accepted only as existing files and canonicalized before their parent directories enter the child PATH;
- `MALENJO_TESSDATA_DIR` is accepted only when both reviewed runtime-required model filenames are present and is canonicalized before `TESSDATA_PREFIX` is set;
- if a configured tessdata directory overrides a bundled Tesseract executable, the combined provider source is reported as `configured`, so the frontend does not claim the immutable bundled component pack supplied the active models;
- the direct Tesseract OCR UI exposes the reviewed English model as scalar `languages=eng`, matching Stirling multipart semantics instead of serializing an array as one JSON form value.
