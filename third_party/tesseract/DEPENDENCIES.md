# Tesseract 5.5.3 Windows dependency record

Reviewed release asset: `tesseract-ocr-w64-setup-5.5.3.20260724.exe`  
Asset SHA-256: `bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4`  
Release commit: `db0ec62f81b0737fbbe184d8fea40af5738f8eef`

## Upstream build recipe

The reviewed 5.5.3 `nsis/build.sh` installs these top-level MSYS2 packages for the x64 installer:

- `mingw-w64-x86_64-curl-winssl`
- `mingw-w64-x86_64-giflib`
- `mingw-w64-x86_64-icu`
- `mingw-w64-x86_64-leptonica`
- `mingw-w64-x86_64-libarchive`
- `mingw-w64-x86_64-libidn2`
- `mingw-w64-x86_64-openjpeg2`
- `mingw-w64-x86_64-openssl`
- `mingw-w64-x86_64-pango`
- `mingw-w64-x86_64-libpng`
- `mingw-w64-x86_64-libtiff`
- `mingw-w64-x86_64-libwebp`

The upstream `find_deps.py` recursively discovers the DLL closure from the built executables, and the NSIS installer includes that closure plus MinGW runtime DLLs.

## Why this is still release-gated

The release workflow updates the rolling MSYS2 repository before building. The public release metadata does not provide a complete immutable package-version tuple for every DLL that `find_deps.py` copied. Source-license compatibility of Tesseract itself is therefore not sufficient evidence for binary redistribution.

MALENJO's builder:

1. verifies the official installer SHA-256;
2. extracts rather than executes the installer, so no mutable language downloads run;
3. copies only the runtime payload needed by `tesseract.exe`;
4. injects independently pinned `eng` and `osd` model blobs;
5. emits SHA-256 inventory for every generated runtime file;
6. emits a component SBOM containing the engine and model sources plus the unresolved transitive-DLL release gate.

Before a commercial/distributable release, every inventoried DLL must be mapped to an exact MSYS2/upstream package version and license/notice obligation.
