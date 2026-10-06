# Tesseract OCR provenance

- Upstream engine: https://github.com/tesseract-ocr/tesseract
- Reviewed release: `5.5.3`
- Release commit: `db0ec62f81b0737fbbe184d8fea40af5738f8eef`
- Annotated release tag verification: GitHub reports a valid verified PGP signature
- Engine license: Apache-2.0
- Reviewed Windows x64 asset: `tesseract-ocr-w64-setup-5.5.3.20260724.exe`
- Asset SHA-256: `bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4`

## Language/model data

MALENJO does not execute the installer language-download sections because they reference mutable `tessdata_fast/main` URLs.

Instead, the provider builder downloads only these immutable blobs from `tessdata_fast` commit `65727574dfcd264acbb0c3e07860e4e9e9b22185` (release tag `4.1.0`):

- `eng.traineddata` — Git blob `bbef4675053b5b468cdb477053e28b1c698ba08e`, 4,113,088 bytes
- `osd.traineddata` — Git blob `527457ca8f8fe1fda7c2f88bce3c0e4be12be9d0`, 10,562,727 bytes

GitHub reports the annotated `tessdata_fast` 4.1.0 tag signature as verified. The model repository license is Apache-2.0.

## MALENJO use

The local Stirling open-core child uses this pack only for the reviewed Tesseract operation group:

- OCR PDF (Tesseract fallback path)
- Auto Rotate PDF (OSD)

The executable directory is injected only into the Stirling child PATH. `TESSDATA_PREFIX` is set to the reviewed pack's local `tessdata` directory. No user or machine PATH/environment mutation occurs.

## Redistribution state

The engine and reviewed model files are Apache-2.0. The official Windows installer is built from a rolling MSYS2 dependency set and includes DLLs discovered by the upstream dependency scanner. The upstream release workflow records the package names but not a complete immutable package-version/license tuple for every extracted DLL.

Therefore this pack is **integration-approved / release-gated**. The generated manifest inventories every extracted runtime file by SHA-256. A MALENJO distributable must not mark this pack release-approved until every extracted non-system DLL is mapped to its exact upstream package/version/license and the required notice/source-offer obligations are retained.
