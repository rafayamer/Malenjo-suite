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
must verify the three exact embedded JAR names against the repository-pinned
published SHA-256 identities in `ARTIFACTS.sha256`. Those identities are the
binary trust anchor for the Maven Central 0.2.2 artifacts resolved by the
pinned Stirling build; the source release remains pinned separately to commit
`673aab8d6ac784524cd1d90141c95e74b9fd26ae`. A fresh cross-platform source
build is not used as a byte-identity check because Java compiler/build outputs
can differ across the release Linux environment and Windows packaging runner.
The builder also runs the pinned Stirling dependency-license policy gate and
hashes each shipped Office license/dependency artifact in the manifest.

MALENJO enables only the reviewed in-process routes wired by the pinned
Stirling controllers. LibreOffice-only HTML/XML/PDF-A routes remain separately
gated unless their own reviewed implementation is provided.


## Reviewed Maven artifact SHA-256

`ARTIFACTS.sha256` pins the exact 0.2.2 JARs accepted by MALENJO:

- `stirling-office-convert-0.2.2.jar` — `79e67f69843095cfc557f3cb040bf0c34489ee51f86b815abf0faf5bd8b47a0c`
- `stirling-office-convert-legacy-0.2.2.jar` — `f57b17c14c91318e27c109e462955bc04d64fd3d67c6e79a50073e863425fe37`
- `stirling-office-convert-topdf-0.2.2.jar` — `210e212dd1345598080ef142c53fbba805cb83dbed150fa0970505bb290df741`

The provider build fails before packaging if any embedded artifact differs.
