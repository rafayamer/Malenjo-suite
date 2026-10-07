# PDF pass 2E — WeasyPrint Windows candidate inventory

Tracking issue: #143  
Base main: `82e7ccf69b5bda2615b1a6be55a916e411a019be`  
PDF state: **partial**.

## Target functions

The pinned Stirling core requires WeasyPrint for:

- HTML → PDF;
- URL → PDF;
- EML/MSG → PDF.

Markdown → PDF is not part of this dependency closure because the pinned core
already registers a Java alternative.

## Reviewed upstream release

- project: `Kozea/WeasyPrint`
- release: `v70.0`
- release commit: `4d3b7b6449e3494f59c7c2f36b512d129225679c`
- project license: BSD-3-Clause
- Windows asset: `weasyprint-windows-onedir.zip`
- asset SHA-256:
  `ab1151f210b4e6bb7aa7a79e91a67e8ddb760094c107bfda55241b6aaefe7d53`

The upstream v70.0 Windows workflow builds with Python 3.14 + PyInstaller after
installing MSYS2 UCRT64 Pango. Consequently the published archive contains a
native/runtime dependency closure beyond WeasyPrint's own BSD-3-Clause code.

## MALENJO pass-2E boundary

This pass intentionally does **not** enable the three functions.

The Windows builder:

1. downloads the immutable official onedir release asset;
2. verifies its exact SHA-256;
3. extracts it without executing an installer;
4. verifies `weasyprint.exe --info` reports 70.0;
5. inventories every runtime file by SHA-256;
6. separately inventories every EXE/DLL/PYD;
7. retains the upstream WeasyPrint BSD license;
8. writes a manifest with
   `redistribution=inventory-only-not-approved` and
   `capabilityEnabled=false`.

Clean Windows CI prints the native inventory so every redistributed native file
can be mapped to an exact upstream package/version/license.

## Completion rule

HTML/URL/EML → PDF remain unavailable until all of these are true:

- every bundled runtime/native file has reviewed package provenance;
- all LGPL/MPL/BSD/MIT/other redistribution obligations are retained;
- any required corresponding-source/source-offer mechanism is defined;
- the final reviewed runtime pack has a stable manifest/SBOM;
- Tauri verifies that exact pack at runtime;
- Stirling receives an explicit local
  `system.customPaths.operations.weasyprint` path;
- Windows operation smoke proves HTML → PDF, EML → PDF and a controlled local
  URL → PDF path;
- network/SSRF controls for URL → PDF are separately reviewed.

Until then PDF stays `partial`.
