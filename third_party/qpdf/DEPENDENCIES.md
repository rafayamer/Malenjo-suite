# qpdf 12.4.2 Windows binary dependency record

Reviewed qpdf release: `v12.4.2`  
Reviewed asset: `qpdf-12.4.2-msvc64.zip`  
Asset SHA-256: `db87077e683630c1217e0e8f9a20a9749d952ab676e881c3689187763a5de25d`

## Exact upstream build evidence

qpdf release build workflow `QPDF Build`, run **36273443816**, Windows job `Windows (msvc, x64, windows-latest)`, built the release from commit `4eba95899886e851cc41d76886483b347612f2a8`.

The release consumed qpdf's September 24 vcpkg cache. The cache package workflow `vcpkg cache`, run **35955712569**, records the exact dependency version tuple:

- `libjpeg-turbo-3.2.0#1`
- `openssl-3.6.4#1`
- `zlib-1.3.2#2`

The x64 MSVC release link log shows qpdf linking the static vcpkg libraries `turbojpeg.lib`, `libssl.lib`, `libcrypto.lib`, and `zs.lib`.

qpdf's Windows CMake configuration also uses CMake `InstallRequiredSystemLibraries`, so the official ZIP may contain Microsoft Visual C++ runtime files required by the MSVC build.

## Retained open-source obligations

MALENJO retains the following exact reviewed license material under this directory:

- qpdf 12.4.2: Apache-2.0 + upstream NOTICE
- libjpeg-turbo 3.2.0: IJG license/readme + Modified BSD license
- OpenSSL 3.6.4: Apache-2.0
- zlib 1.3.2: zlib license

For executable/static libjpeg-turbo redistribution, MALENJO documentation must include the acknowledgement: **This software is based in part on the work of the Independent JPEG Group.**

## Release gate

The provider is approved for development/integration and its open-source dependency obligations are recorded. A MALENJO distributable must not mark the qpdf pack release-approved until the exact generated `provider-packs/qpdf/runtime/` file inventory is captured in the release SBOM and every Microsoft runtime file is confirmed against the applicable Microsoft Visual Studio redistributable list/terms.

This keeps the business-redistribution decision separate from source-code license compatibility and prevents a source-license review from silently approving unexamined binary runtime files.
