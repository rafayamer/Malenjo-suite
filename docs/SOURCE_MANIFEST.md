# Source and asset manifest

The complete source package supplied for MALENJO has been preserved in the working project used to create this repository. Large binary references and the full DOCX guide are not silently treated as code dependencies.

## Canonical sources

- `MALENJO_SUITE_FINAL_MASTER_README.md` — canonical product specification.
- `MALENJO ENTERPRISE DEVELOPMENT & IMPLEMENTATION GUIDE - COMPLETE STEP-BY-STEP.docx` — implementation blueprint.
- Stirling integration specifications and source notes supplied in the MALENJO asset package.
- MALENJO logo concepts and UI reference images supplied in the asset archive.

## Repository policy

Textual engineering decisions derived from those sources are represented in `docs/`, the module registry, Tauri/Rust boundary, CI and integration adapter directories. Supplied visual/binary assets should be imported through Git/LFS or normal Git from the original asset package without recompression or substitution so their hashes can be verified.
