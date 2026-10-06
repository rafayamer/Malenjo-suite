# Tesseract OCR provenance

- Upstream: https://github.com/tesseract-ocr/tesseract
- Reviewed release: `5.5.3`
- Published: 2026-07-24
- Core license: Apache-2.0
- Official Windows x64 installer: `tesseract-ocr-w64-setup-5.5.3.20260724.exe`
- Installer SHA-256: `bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4`

## Offline language data

MALENJO does not allow the upstream installer to download OCR data at runtime. The pack builder pins `tesseract-ocr/tessdata_fast` to commit:

`87416418657359cb625c412a48b6e1d6d41c29bd`

Required blobs:

- `eng.traineddata`: Git blob `bbef4675053b5b468cdb477053e28b1c698ba08e`
- `osd.traineddata`: Git blob `527457ca8f8fe1fda7c2f88bce3c0e4be12be9d0`
- tessdata_fast license: Apache-2.0

The builder verifies Git blob identity after download, so moving branch content cannot silently enter the pack.

## Redistribution boundary

The Tesseract core and pinned model data are Apache-2.0. The official Windows installer is built from a moving MSYS2 package set (including dynamically linked third-party libraries) rather than a lockfile. MALENJO therefore classifies this component as **integration-approved / release-gated** until the exact extracted runtime inventory is mapped to source package versions and redistribution notices.

The pack may be used for local integration/CI while #143 remains open. It is not final business-release approval.


## Runtime banner evidence

CI extraction of the exact reviewed installer reports:

- Tesseract `v5.5.3.20260724`
- Leptonica `1.87.0`
- giflib `5.2.2`
- libjpeg-turbo `3.1.3`
- libpng `1.6.58`
- libtiff `4.7.2`
- zlib `1.3.1` in the image stack
- OpenJPEG `2.5.4`
- libarchive `3.8.8` with zlib `1.3.2`, liblzma `5.8.3`, bzip2 `1.0.8`, LZ4 `1.10.0`, zstd `1.5.7`, expat `2.8.2`
- libcurl `8.21.0` with Schannel, zlib `1.3.2`, brotli `1.2.0`, zstd `1.5.7`, libidn2 `2.3.8`, libpsl `0.21.5`, libssh2 `1.11.1`, WinLDAP

These runtime-reported versions improve the transitive audit input but do not by themselves prove the exact source package/license/notice mapping for every extracted DLL. The release gate remains open.
