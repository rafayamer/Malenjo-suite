# Stirling Office Convert provenance

- Upstream repository: https://github.com/Stirling-Tools/Stirling-Office-Convert
- Reviewed release: `v0.2.2`
- Release source commit: `673aab8d6ac784524cd1d90141c95e74b9fd26ae`
- Release published: 2026-10-05
- License: MIT
- Upstream copyright: Copyright (c) 2026 Stirling Tools
- MALENJO use: embedded Java library already resolved by the pinned Stirling-PDF open-core build.

The pinned Stirling-PDF commit `25220cbdbde2d526cebf173b94357884e180b8c1`
sets `officeConvertVersion = "0.2.2"` and resolves these modules into the
backend runtime:

- `com.stirling:stirling-office-convert:0.2.2`
- `com.stirling:stirling-office-convert-legacy:0.2.2`
- `com.stirling:stirling-office-convert-topdf:0.2.2`

MALENJO does not execute the standalone Office Convert CLI asset. The feature
runs in-process inside the local Stirling core sidecar. The provider builder
must verify the three exact embedded JAR names, record their SHA-256 values in
the generated provider manifest, run the pinned Stirling dependency-license
policy gate, and package the generated dependency-license report with the
sidecar resources.

MALENJO enables only the reviewed in-process routes wired by the pinned
Stirling controllers. LibreOffice-only HTML/XML/PDF-A routes remain separately
gated unless their own reviewed implementation is provided.
