# qpdf provenance

- Upstream: https://github.com/qpdf/qpdf
- Reviewed release: `v12.4.2`
- Release date: 2026-09-27
- License: Apache-2.0
- Upstream NOTICE copyright: qpdf copyright (c) 2005-2021 Jay Berkenbilt, 2022-2026 Jay Berkenbilt and Manfred Holger
- Windows x64 reviewed binary: `qpdf-12.4.2-msvc64.zip`
- SHA-256: `db87077e683630c1217e0e8f9a20a9749d952ab676e881c3689187763a5de25d`
- Release source: https://github.com/qpdf/qpdf/releases/tag/v12.4.2
- License source: https://github.com/qpdf/qpdf/blob/v12.4.2/LICENSE.txt
- NOTICE source: https://github.com/qpdf/qpdf/blob/v12.4.2/NOTICE.md
- Release build workflow: qpdf `QPDF Build` run `36273443816`, MSVC x64 job
- vcpkg cache workflow: qpdf `vcpkg cache` run `35955712569`
- Static dependency tuple: `libjpeg-turbo-3.2.0#1,openssl-3.6.4#1,zlib-1.3.2#2`

## MALENJO use

qpdf is an optional local component pack used by the reviewed Stirling open-core provider for structural PDF repair and optimization/compression. MALENJO does not shell-interpolate document paths into qpdf. Stirling invokes the executable inside its loopback-only, on-demand child process.

The pack builder verifies the upstream release asset checksum before extraction. Generated binaries are not committed to the source repository.

## Redistribution

qpdf itself is Apache-2.0. The reviewed MSVC x64 release statically links the exact libjpeg-turbo/OpenSSL/zlib versions recorded in `DEPENDENCIES.md`; their required license/acknowledgement material is retained under `third_party/qpdf/deps/`.

The provider is approved for MALENJO development/integration. Final distributable release approval remains gated on the exact generated runtime file inventory/SBOM and confirmation that any Microsoft Visual C++ runtime files copied by qpdf's CMake `InstallRequiredSystemLibraries` step are included under applicable Microsoft redistributable terms. This branch therefore does not treat source-license compatibility alone as a complete binary redistribution review.
