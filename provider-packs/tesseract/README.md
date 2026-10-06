# MALENJO Tesseract OCR provider pack

Generated Windows OCR component pack used only by the on-demand local PDF provider.

- Tesseract: 5.5.3
- official upstream Windows x64 installer
- installer SHA-256: `bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4`
- offline OCR data: pinned `tessdata_fast@87416418657359cb625c412a48b6e1d6d41c29bd`
- languages bundled in this pass: `eng` + `osd`
- build: `powershell -ExecutionPolicy Bypass -File scripts/build-tesseract-windows.ps1`

Generated runtime/model files are not committed. MALENJO injects only the generated Tesseract executable directory into the Stirling child PATH and sets `TESSDATA_PREFIX` to the pinned local data directory.

Legal status: integration-approved / release-gated. See `third_party/tesseract/PROVENANCE.md`.
