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
- Added qpdf 12.4.2 as the first integration-approved Windows binary provider pack; final distributable release approval remains gated.
- qpdf download is pinned to the official `qpdf-12.4.2-msvc64.zip` release asset and exact SHA-256.
- The qpdf directory is prepended only to the on-demand Stirling child process PATH. MALENJO does not modify the user/machine PATH.
- Native status reports qpdf implementation/version/source to the MALENJO provider contract.
- Retained qpdf Apache-2.0/NOTICE plus exact static libjpeg-turbo 3.2.0, OpenSSL 3.6.4 and zlib 1.3.2 license obligations; the required IJG acknowledgement is in the product notice.

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
- pinned Stirling minimum: 12.0.0\n- qpdf release build: workflow run `36273443816` (MSVC x64)\n- exact vcpkg cache: workflow run `35955712569`\n- static deps: `libjpeg-turbo-3.2.0#1`, `openssl-3.6.4#1`, `zlib-1.3.2#2`

## Windows CI gate

The Windows provider job now:

1. builds qpdf from the exact reviewed release asset;
2. verifies the manifest checksum/version, exact runtime file inventory and CycloneDX 1.5 component SBOM;
3. verifies retained qpdf/libjpeg-turbo/OpenSSL/zlib notices and executes `qpdf --version`;
4. builds the reviewed Stirling open-core JAR;
5. starts it on loopback with the qpdf pack injected only into the child PATH;
6. verifies health and OpenAPI;
7. requires Repair and Compress endpoints;
8. generates a deterministic structurally valid one-page PDF and verifies it with `qpdf --check`;
9. calls both endpoints with that valid fixture;
10. verifies both outputs begin with `%PDF-`.

This is executable operation-group evidence, not just endpoint discovery.

## Packaging / release boundary

Tauri resources use explicit source→target mappings so installed builds resolve both `provider-packs/stirling-core/` and `provider-packs/qpdf/` under stable resource paths. `providerPackaging.test.ts` guards the configured destination, qpdf generated layout and Rust packaged lookup from drifting apart.

qpdf's open-source binary obligations are recorded, but qpdf is **integration-approved / release-gated**, not unconditionally release-approved. qpdf's Windows build uses CMake `InstallRequiredSystemLibraries`; the pack builder now captures the exact generated runtime file inventory plus a CycloneDX component SBOM. Before a MALENJO distributable, any Microsoft Visual C++ runtime files present in that inventory must still be checked against the applicable Microsoft redistributable terms.

## Completion boundary

The remaining #143 providers/replacements are still open, including OCR, Office conversion, HTML/Markdown conversion, Ghostscript-only features, EPUB, scan extraction, CBR and open-core-compatible form detection. The legal/provider matrix is in `PDF-PROVIDER-MATRIX-PASS2.md`.

PDF remains **partial** and the canonical #39/#81/source-truth completion gate is unchanged.
