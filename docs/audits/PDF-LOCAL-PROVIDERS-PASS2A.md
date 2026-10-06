# PDF completion pass 2A — provider capability truth + qpdf

## Status

Tracking issue: #143  
Branch: `feat/pdf-complete-pass2-local-providers`  
Base main: `73268853cee830c444e682799d663f444bb59998`  
PDF registry state: **partial**.

This is a bounded sub-pass of #143. It must not close #143 or promote the PDF module.

## What changed

- Added MALENJO-owned per-operation capability metadata:
  - available/unavailable;
  - implementation/provider ID;
  - provider version;
  - component pack;
  - disabled reason;
  - real fallback;
  - legal/provenance reference.
- Added a capability resolver so runtime OpenAPI presence is not treated as proof that an operation is lawfully/actually available.
- Preserved reviewed Java/PDFBox fallbacks for Repair, Compress, Crop and Markdown→PDF where the pinned Stirling core has real alternatives.
- Explicitly blocks external-only operations when no reviewed provider is present.
- Added qpdf 12.4.2 as the first approved Windows binary provider pack.
- qpdf download is pinned to the official `qpdf-12.4.2-msvc64.zip` release asset and exact SHA-256.
- The qpdf directory is prepended only to the on-demand Stirling child process PATH. MALENJO does not modify the user/machine PATH.
- Native status reports qpdf implementation/version/source to the MALENJO provider contract.
- Retained upstream Apache-2.0 license and NOTICE.

## Windows architecture

The existing architecture remains unchanged:

Windows MALENJO Tauri process → on-demand loopback Stirling open-core child → reviewed local component executables.

Stirling remains bound to `127.0.0.1:28970`, has no application-launch autostart, and is reachable from the frontend only through MALENJO Tauri commands.

## qpdf source

- upstream: `qpdf/qpdf@v12.4.2`
- release date: 2026-09-27
- license: Apache-2.0
- Windows x64 asset: `qpdf-12.4.2-msvc64.zip`
- SHA-256: `db87077e683630c1217e0e8f9a20a9749d952ab676e881c3689187763a5de25d`
- pinned Stirling minimum: 12.0.0

## Windows CI gate

The Windows provider job now:

1. builds qpdf from the exact reviewed release asset;
2. verifies the manifest checksum/version;
3. executes `qpdf --version`;
4. builds the reviewed Stirling open-core JAR;
5. starts it on loopback with the qpdf pack injected only into the child PATH;
6. verifies health and OpenAPI;
7. requires Repair and Compress endpoints;
8. calls both endpoints with a repository PDF fixture;
9. verifies both outputs begin with `%PDF-`.

This is executable operation-group evidence, not just endpoint discovery.

## Completion boundary

The remaining #143 providers/replacements are still open, including OCR, Office conversion, HTML/Markdown conversion, Ghostscript-only features, EPUB, scan extraction, CBR and open-core-compatible form detection. The legal/provider matrix is in `PDF-PROVIDER-MATRIX-PASS2.md`.

PDF remains **partial** and the canonical #39/#81/source-truth completion gate is unchanged.
