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

## Phase 3 traceability — Office workspaces

| Requirement | Component | Implementation | Evidence | Status |
|---|---|---|---|---|
| DOCX editor | Document Workspace | `OfficeWorkspace.tsx`, `ooxml.ts` | OOXML unit tests | Implemented, CI pending |
| XLSX editor | Spreadsheet | editable grid + first-sheet OOXML adapter | OOXML unit tests | Implemented, CI pending |
| PPTX editor | Presentation | slide list + text-run editor | OOXML unit tests | Implemented, CI pending |
| Exact untouched fidelity | OOXML core | `exactCopy` | byte equality test | Implemented |
| Edited fidelity warning | Office UI | fidelity pill + module warnings | UI/code review | Implemented |
| Export | Native/browser Office adapter | explicit copy writer / download | CI + manual pending | Implemented |
| Print | Office UI | print CSS + browser/WebView print | manual Windows check pending | Implemented |
| Lazy heavy engines | Office architecture | no LibreOffice/Java startup dependency | architecture review | Implemented |
| Corpus | testing/suite/fixtures/{docx,xlsx,pptx} | synthetic cases + future matrix | tests/docs | Implemented |
| Dependency licensing | third_party/fflate | fflate 0.8.3 MIT | provenance record | Implemented |

## Phase 4 traceability — Scanner/OCR

| Requirement | Component | Implementation | Evidence | Status |
|---|---|---|---|---|
| Capture/import | Scanner | file import + MediaDevices camera capture | UI/code review | Implemented |
| Crop/rotate | Scan processing | normalized crop + 90-degree rotation | image pipeline | Implemented |
| Perspective correction | Scan processing | manual quadrilateral bilinear mapping | geometry unit tests | Implemented |
| Page assembly | Scanner | multi-page list/reorder/remove, 50-page cap | UI/code review | Implemented |
| PaddleOCR worker | Native OCR | supervised Python worker, timeout, JSON contract | Rust tests/CI pending | Implemented |
| Searchable output | OCR export | text export + pdf-lib image/text PDF | code review/CI pending | Implemented |
| OCR cache | OCR core | SHA-256 session cache | code review | Implemented |
| Cancellation | OCR core/native | Tesseract terminate + Paddle child kill | native/frontend code | Implemented |
| Accuracy/latency | OCR benchmark | Levenshtein accuracy + per-page latency/confidence | unit tests/UI | Implemented |
| Resource bounds | Scanner/native OCR | 25 MB, 25 MP, 50 pages, 120 sec worker | unit tests | Implemented |
| Offline path | PaddleOCR pack | optional local worker; no startup process | architecture review | Implemented; pack QA pending |

## Phase 5 traceability — Malenjo AI local RAG

| Requirement | Component | Implementation | Evidence | Status |
|---|---|---|---|---|
| Ollama adapter | Native AI | hard-coded loopback `127.0.0.1:11434`, tags/chat APIs | Rust tests/CI pending | Implemented |
| llama.cpp adapter | Native AI | hard-coded loopback `127.0.0.1:8080`, OpenAI-compatible models/chat APIs | Rust tests/CI pending | Implemented |
| Model discovery separate from download | AI runtime UI | status/list only; no pull/download action | UI/code review | Implemented |
| Document chunking/indexing | RAG core | bounded chunk windows + lexical retrieval | unit tests | Implemented |
| Source citations | RAG core/UI | stable `[S#]` citation objects and excerpts | unit tests/UI | Implemented |
| PDF/Office/text sources | Source extraction | PDF.js + OOXML + text loaders | code review/CI pending | Implemented |
| Runtime/resource UI | AI workspace | provider/model/status/resource cards | UI/code review | Implemented |
| Cancellation | Native/frontend AI | watch-channel cancellation + UI cancel | Rust/frontend code | Implemented |
| Lite Mode | RAG + model request | lower corpus/chunk/context/token caps, Ollama keep_alive=0 | unit tests/UI | Implemented |
| Prompt injection defense | Grounded prompt | source blocks explicitly untrusted, hostile-source test | `rag.test.ts` | Implemented |
| No model startup at app launch | Architecture | provider probing only when AI workspace mounts; no spawn/download | architecture review | Implemented |
| Local-only network boundary | Native AI | provider enum + hard-coded loopback + redirects disabled | Rust tests | Implemented |
