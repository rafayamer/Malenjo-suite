# MALENJO Suite — Third-party notices

This file is the **in-product notice destination for the current source tree**. It records the principal direct dependencies and optional external engines currently referenced by MALENJO. It is not a substitute for the release SBOM and exact transitive-license scan required before redistribution.

## Direct frontend/runtime dependencies

| Component | Manifest version/range | License family recorded for integration |
|---|---:|---|
| Tauri API / Tauri dialog plugin | 2.x | MIT OR Apache-2.0 |
| React / React DOM | 19.x | MIT |
| lucide-react | 0.468.x | ISC |
| pdfjs-dist / Mozilla PDF.js | 6.4.299 | Apache-2.0 |
| fflate | 0.8.3 | MIT |
| tesseract.js | 7.0.0 | Apache-2.0 |
| pdf-lib | 1.17.1 | MIT |

## Direct Rust dependencies

| Component | Manifest version/range | License family recorded for integration |
|---|---:|---|
| tauri / tauri-build / tauri-plugin-dialog | 2.x | MIT OR Apache-2.0 |
| serde / serde_json | 1.x | MIT OR Apache-2.0 |
| thiserror | 2.x | MIT OR Apache-2.0 |
| reqwest | 0.13.5 | MIT OR Apache-2.0 |
| tokio | 1.x | MIT |
| zeroize | 1.8.x | MIT OR Apache-2.0 |
| sha2 | 0.10.x | MIT OR Apache-2.0 |

## UI/design source adaptations

| Component | Pinned source | License | MALENJO use |
|---|---|---|---|
| Stirling-Tools/Stirling-PDF open core | `25220cbdbde2d526cebf173b94357884e180b8c1` | MIT outside root-LICENSE restricted directories | Primary MALENJO UI/UX and PDF workflow upstream baseline. Restricted proprietary/saas/engine/desktop/cloud/portal/prototypes paths are excluded from copying. |
| CasualOffice/desktop | `39fe70960462a9f16ea4f1e9aaa8b963d5da6ef1` | Apache-2.0 | Home launcher structure and adapted source components: action cards, recent-file cards, search, segmented filtering, context menu, Office-Backstage grouping/pinning. |

Upstream license/provenance are retained under `third_party/stirling-pdf/` and `third_party/casualoffice/`. Stirling is open-core; its restricted directories are governed by separate non-MIT licenses and are not copied into MALENJO. The earlier shadcn-admin Home attribution was removed by correction issue #139 because that repository was not actually the structural source used by the corrected Home implementation.

## Local provider packs

| Component | Pinned version/source | License | MALENJO use |
|---|---|---|---|
| qpdf | 12.4.2 / official `msvc64.zip` SHA-256 `db87077e683630c1217e0e8f9a20a9749d952ab676e881c3689187763a5de25d` | Apache-2.0 | Local PDF structural repair/optimization helper exposed to the Stirling core child through MALENJO's provider-pack PATH. |

qpdf license, NOTICE and provenance are retained under `third_party/qpdf/`. Generated qpdf binaries are not committed; the Windows pack installer verifies the official release digest before extraction.

## Optional external engines/adapters

MALENJO may call locally installed tools such as Ollama, llama.cpp, PaddleOCR/Python, ClamAV, pyHanko, Temporal and Kopia through product-owned adapter boundaries. Their executable/model/package licenses are reviewed independently from this source notice before bundling or redistribution. Availability in Help diagnostics does **not** mean the engine is bundled.

## Release requirement

Before a distributable release, regenerate notices from the exact locked dependency graph and component/model pack manifests, include material transitive licenses, model/font/codec/binary notices, and produce the required SBOM/provenance artifacts. See `docs/THIRD_PARTY_POLICY.md`.
