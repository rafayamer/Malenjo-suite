# WeasyPrint provenance

- Upstream: https://github.com/Kozea/WeasyPrint
- Reviewed release: `v70.0`
- Release commit: `4d3b7b6449e3494f59c7c2f36b512d129225679c`
- Release date: 2026-09-08
- License: BSD-3-Clause
- Official Windows asset: `weasyprint-windows-onedir.zip`
- Asset SHA-256: `ab1151f210b4e6bb7aa7a79e91a67e8ddb760094c107bfda55241b6aaefe7d53`

## Upstream Windows build

The reviewed upstream workflow builds the Windows executable on `windows-latest`
with Python 3.14 and PyInstaller. It installs the MSYS2 UCRT64 Pango package,
then places `C:\msys64\ucrt64\bin` on PATH before PyInstaller collects the
runtime.

The WeasyPrint project itself is BSD-3-Clause, but the resulting onedir bundle
contains Python and native runtime dependencies with their own licenses.

## MALENJO boundary

MALENJO does **not** currently expose WeasyPrint-backed PDF operations as
available. The pass-2E builder only:

1. downloads the immutable official `v70.0` onedir asset;
2. verifies the exact release SHA-256;
3. extracts without executing an installer;
4. validates `weasyprint.exe --info`;
5. inventories every extracted runtime file and every EXE/DLL/PYD by SHA-256.

HTML→PDF, URL→PDF and EML→PDF remain unavailable until every redistributed
runtime component is mapped to exact package/version/license provenance and all
required notice/source obligations are retained.
