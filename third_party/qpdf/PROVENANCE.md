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

## MALENJO use

qpdf is an optional local component pack used by the reviewed Stirling open-core provider for structural PDF repair and optimization/compression. MALENJO does not shell-interpolate document paths into qpdf. Stirling invokes the executable inside its loopback-only, on-demand child process.

The pack builder verifies the upstream release asset checksum before extraction. Generated binaries are not committed to the source repository.

## Redistribution

Apache-2.0 permits commercial redistribution subject to its notice/license obligations. A release must include the upstream Apache-2.0 license, qpdf NOTICE material, material third-party notices from the binary distribution, and the exact pack entry in the release SBOM/provenance set.
