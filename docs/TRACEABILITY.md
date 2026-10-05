# Requirements traceability

The canonical MALENJO specification and the Developer Guide remain the controlling sources for implementation.

Each implementation pull request must record:

| Field | Required evidence |
|---|---|
| Requirement | Guide/source identifier or quoted requirement |
| Component | MALENJO module, adapter, service or packaging component |
| Implementation | Paths and architectural decision |
| Tests | Unit/integration/E2E/security/performance evidence |
| License review | Dependency provenance and redistribution conclusion |
| Status | Planned / Implemented / Verified / Blocked |

No module is complete merely because its navigation entry exists. Completion requires the guide acceptance criteria, security review, performance budget and relevant offline/fidelity tests.

## Phase 1 traceability

| Requirement | Component | Implementation | Test/evidence | Status |
|---|---|---|---|---|
| One file library | Files / Document Library | `src-tauri/src/suite/library.rs`, `src/suite/files/FileLibrary.tsx` | library index + UI | Implemented |
| Recent files | Library index | `last_opened_ms` sorting | Rust/interactive | Implemented |
| Import/open | Dialog + native commands | `chooseAndAddDocuments`, `open_library_document` | path/type tests | Implemented |
| Save As/export copy | Native file pipeline + workspace UI | `save_as_library_document`, Files actions, workspace Save As | Windows CI + manual E2E pending | Implemented, verification pending |
| Never delete source on library removal | Library index | `remove_library_document` changes index only | code review | Implemented |
| Type routing | Shell router | `workspaceForDocument` | `route.test.ts` | Implemented |
| Dirty state | Workspace session | `session.ts` | `session.test.ts` | Implemented model; editor wiring pending |
| Same-file Save | Workspace-native adapter contract | `stage_library_document` + `commit_staged_document` + app-data recovery backup + source-change manifest | Rust token/path tests; Windows E2E pending | Implemented, verification pending |
| Offline startup | Shell/native services | no network call; services remain lazy | CI/manual offline test pending | Implemented, verification pending |

| Lost-update protection | Native staged save | source size/modified timestamp captured in staging manifest and rechecked before commit | code review + Windows E2E pending | Implemented, verification pending |
| Symlink overwrite defense | Save As | existing symbolic-link destinations are rejected | code review + Windows E2E pending | Implemented, verification pending |

## Phase 2 traceability — PDF workspace

| Requirement | Component | Implementation | Test/evidence | Status |
|---|---|---|---|---|
| PDF.js central viewer | PDF Workspace | `PdfWorkspace.tsx`, `PdfPageCanvas.tsx`, `engine.ts` | Phase 2 CI + browser/manual | Implemented, verification pending |
| First-page performance measurement | PDF Workspace | load-start timestamp to first page render | inspector metric | Implemented |
| 60 FPS scroll measurement | PDF Workspace | `useScrollFps.ts` sampled RAF metric | live inspector; <55 warning | Implemented |
| Page navigation | PDF Workspace | thumbnails, prev/next, direct page input | layout unit tests + UI | Implemented |
| Zoom / fit | PDF Workspace | fit width/page + 25–400% clamp | `layout.test.ts` | Implemented |
| Open local PDF | Native PDF boundary | `read_pdf_document` raw IPC response | Rust tests + CI | Implemented, verification pending |
| Save/export copy | Phase 1 pipeline + PDF toolbar | desktop Save As / browser preview download | CI/manual E2E pending | Implemented |
| Print | PDF Workspace | force-render + browser/WebView print path | Windows manual check pending | Implemented, verification pending |
| Malformed PDF safety | Native boundary + PDF.js error state | signature check, 512 MB limit, fixtures | Rust tests + fixture corpus | Implemented |
| Backend separation | PDF backend | `backend.ts` capability-denied default | architecture review | Implemented |
| PDF.js license provenance | Third-party records | `third_party/pdfjs/PROVENANCE.md` | Apache-2.0 upstream review | Implemented |
| No proprietary Stirling copy | Repository boundary | no Stirling source vendored | tree/review | Implemented |
