# Implementation status

This repository is the **Phase 0 / Phase 1 executable foundation**, not a claim that all 300+ pages of the developer guide are already implemented.

| Area | Status | Next gate |
|---|---|---|
| Unified shell/theme | Implemented scaffold | visual regression against supplied references |
| Module registry/navigation | Implemented scaffold | command palette + deeper document routing |
| Rust native boundary | Phase 1 file-library commands implemented | staged-save/secret-store/update commands |
| Local service manager | Contract scaffold | supervised subprocess lifecycle + health checks |
| PDF | Phase 2 viewer implemented on feature branch | CI + Windows rendering/printing verification, then mutation backend proof of concept |
| Office | Adapter boundary | Tiptap/Univer + OOXML fidelity proof of concept |
| Scanner/OCR | Adapter boundary | camera + OpenCV + PaddleOCR proof of concept |
| Local AI | Adapter boundary | Ollama/llama.cpp local RAG proof of concept |
| Sign/Invoice/Metadata | Adapter boundary | module-by-module implementation and tests |
| DMS/Automation/Admin | Planned scaffold | data model and policy service implementation |
| CAD/DICOM | Adapter boundary | optional-pack proof of concept |
| Packaging | Configured developer targets | signing, SBOM, installer QA, update manifests |

Do not mark a module complete until its acceptance criteria and traceability entries in the master guide pass.

## Phase 1 evidence — document library

Implemented on `feat/document-library-native-pipeline`:

- Persistent local library index stored under the application data directory.
- Explicit native file picker integration; no startup network dependency.
- Add/import by reference: originals are not copied, moved or modified when added.
- Recent-file ordering using last-opened timestamps.
- File availability/metadata refresh and workspace routing by document type.
- Save As creates an explicit copy and adds that copy to the library.
- Remove only deletes the MALENJO index entry; the source document is never deleted.
- Dirty-state session model for future workspace editors.
- Rust malformed-path/type tests plus TypeScript routing/session tests.

Remaining before Issue #8 can be considered fully closed: real editor dirty-state wiring and end-to-end Windows picker/save tests. A MALENJO-controlled staging/commit API for same-file Save is now implemented.

## Phase 2 evidence — PDF viewer

Implemented on `feat/pdf-workspace-phase-2`:

- MALENJO-owned three-pane PDF workspace.
- PDF.js 6.4.299 local worker integration.
- Native raw-byte PDF IPC boundary with signature and 512 MB safety checks.
- Lazy page canvas and thumbnail rendering.
- Page navigation, fit width/page, zoom, rotation, export-copy and print controls.
- Browser/Codespaces ephemeral PDF preview.
- First-page render timing and scroll-FPS telemetry.
- Malformed/active-content fixture corpus.
- Viewer-only backend capability boundary and third-party provenance.

Phase 2 remains open until branch CI and post-merge validation pass; Windows manual print/render checks remain a release-quality gate.
