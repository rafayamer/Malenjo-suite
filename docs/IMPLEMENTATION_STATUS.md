# Implementation status

This repository contains the **Phase 0–7 executable foundation**. This is not a claim that all 300+ pages of the developer guide or later phases are already implemented.

| Area | Status | Next gate |
|---|---|---|
| Unified shell/theme | Implemented scaffold | visual regression against supplied references |
| Module registry/navigation | Implemented scaffold | command palette + deeper document routing |
| Rust native boundary | Phase 1 file-library commands implemented | staged-save/secret-store/update commands |
| Local service manager | Contract scaffold | supervised subprocess lifecycle + health checks |
| PDF | Phase 2 viewer implemented and CI-verified | Windows rendering/printing verification, then mutation backend proof of concept |
| Office | Phase 3 merged and CI-verified | Windows Office/LibreOffice interoperability validation |
| Scanner/OCR | Phase 4 merged and CI-verified | packaged PaddleOCR/model pack + Windows camera matrix |
| Local AI | Phase 5 merged and branch CI-verified | post-merge CI + Windows CPU/GPU runtime matrix |
| Sign/Metadata/Security | Phase 6 merged and tree-equivalent CI-verified | Windows ClamAV/pyHanko matrix + persistent secret-store provider |
| DMS/Automation/Admin/Backup | Phase 7 merged and tree-equivalent CI-verified | Windows Temporal/Kopia matrix + identity-provider binding |
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

Phase 2 branch CI and post-merge main CI #93 passed across frontend, Windows Rust, and Codespaces/Linux. Windows manual print/render checks remain a release-quality gate.

## Phase 3 evidence — Office workspaces

Implemented on `feat/office-workspaces-phase-3`:

- Native OOXML read/export boundary with ZIP signature validation and 256 MB limits.
- DOCX paragraph editor with paged MALENJO UI.
- XLSX editable first-sheet grid.
- PPTX slide/text-run editor.
- Exact-copy path for untouched documents.
- Package-preserving warned export after edits.
- Print paths and Codespaces/browser file preview.
- OOXML unit tests and fidelity corpus documentation.
- fflate 0.8.3 MIT provenance.
- No mandatory LibreOffice/Java conversion service at startup.

Phase 3 merged through PR #19 and main CI #100 passed. Manual Microsoft Office/LibreOffice interoperability remains a release-quality fidelity gate.

## Phase 4 evidence — Scanner/OCR

Implemented on `feat/scanner-ocr-phase-4`:

- camera capture and multi-image import;
- crop, rotate, brightness/contrast/grayscale processing;
- manual four-corner perspective correction;
- multi-page assembly/reorder with resource limits;
- supervised optional PaddleOCR worker with timeout/cancellation;
- Tesseract.js 7.0.0 portable fallback;
- SHA-256 OCR session cache;
- latency/confidence and ground-truth accuracy benchmarking;
- text export and searchable PDF via pdf-lib 1.17.1;
- scanner/OCR tests and provenance records.

Phase 4 merged through PR #20 and main CI #103 passed. Packaged PaddleOCR/model installation and physical Windows camera coverage remain release-quality gates.

## Phase 5 evidence — Malenjo AI local RAG

Implemented on `feat/local-ai-rag-phase-5`:

- local-only Ollama and llama.cpp server adapters;
- hard-coded loopback endpoints and disabled redirects;
- model discovery separated from model download/startup;
- bounded local PDF/Office/text source extraction and chunking;
- citation-bearing lexical retrieval;
- grounded prompt construction with untrusted-source boundaries;
- prompt-injection regression tests;
- cancellable local inference;
- Lite Mode memory/context/token limits;
- explicit runtime/model/resource status UI;
- no AI/model process launched during MALENJO startup.

Phase 5 merged through PR #21 after hardened-head CI #107 passed across frontend, Windows Rust, and Codespaces/Linux. Post-merge main validation remains required; Windows CPU/GPU model-runtime performance and optional model-pack installation remain release-quality gates.

## Phase 6 evidence — Security Center, Metadata Studio and signing

Implemented on `feat/security-signing-phase-6`:

- PDF/OOXML metadata inspection and sanitized-copy export;
- destructive rasterized PDF CDR/redaction export;
- separate content-preserving watermark operation;
- AES-256-GCM MALENJO secure-envelope export;
- bounded direct ClamAV adapter with audit events;
- pyHanko validation and signed-copy adapter;
- native ephemeral zeroizing signing-secret store;
- append-only native JSONL audit events;
- security/tamper/error corpus and provenance records.

Phase 6 merged through PR #23 after tree-equivalent develop CI #118 passed frontend, Windows Rust and Codespaces/Linux. Physical Windows ClamAV/pyHanko integration and a persistent Windows Credential Manager/DPAPI provider remain release-quality gates.

## Phase 7 evidence — DMS, automation, backup and administration

Implemented on `feat/enterprise-workflows-phase-7`:

- local DMS index and immutable SHA-256 version snapshots;
- legal hold plus preview/apply retention that protects the newest version;
- versioned local workflow contracts and native execution;
- optional fixed-loopback Temporal CLI handoff;
- verified offline backup with SHA-256 manifest;
- integrity-gated restore with pre-restore recovery copy;
- automated restore and tamper-detection tests;
- optional Kopia snapshot/restore adapter;
- shared owner/admin/editor/viewer permission model enforced in Rust;
- shared DMS/audit retention policy;
- audit retention archives expired events rather than silently discarding them;
- Phase 6 audit logging reused by enterprise operations.

Phase 7 merged through PR #24 after tree-equivalent develop CI #120 passed frontend, Windows Rust and Codespaces/Linux. Physical Windows Temporal/Kopia testing and multi-user identity-provider binding remain release-quality gates.
