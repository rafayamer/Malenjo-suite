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

## Optional external engines/adapters

MALENJO may call locally installed tools such as Ollama, llama.cpp, PaddleOCR/Python, ClamAV, pyHanko, Temporal and Kopia through product-owned adapter boundaries. Their executable/model/package licenses are reviewed independently from this source notice before bundling or redistribution. Availability in Help diagnostics does **not** mean the engine is bundled.

## Release requirement

Before a distributable release, regenerate notices from the exact locked dependency graph and component/model pack manifests, include material transitive licenses, model/font/codec/binary notices, and produce the required SBOM/provenance artifacts. See `docs/THIRD_PARTY_POLICY.md`.
