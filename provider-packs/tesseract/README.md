# MALENJO Tesseract OCR provider pack

Generated Windows x64 component pack used by the local Stirling open-core provider.

- Tesseract: **5.5.3**
- upstream release asset: `tesseract-ocr-w64-setup-5.5.3.20260724.exe`
- asset SHA-256: `bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4`
- engine license: Apache-2.0
- model source: `tesseract-ocr/tessdata_fast@65727574dfcd264acbb0c3e07860e4e9e9b22185`
- pinned models: English OCR + orientation/script detection
- build: `powershell -ExecutionPolicy Bypass -File scripts/build-tesseract-windows.ps1`

The builder requires 7-Zip only as a build-time extractor. It never executes the upstream installer, so the installer's mutable `tessdata_fast/main` download sections are bypassed.

Generated `runtime/`, `manifest.json`, and `sbom.cdx.json` are not committed. MALENJO injects the generated executable directory and `TESSDATA_PREFIX` only into the on-demand local Stirling child.

This pack is integration-approved but release-gated pending exact license mapping of the extracted MSYS2 DLL inventory. See `third_party/tesseract/DEPENDENCIES.md`.
