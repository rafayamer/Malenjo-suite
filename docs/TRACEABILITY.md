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


## Source-truth UI 53.5 — document tabs / multi-document state

| Requirement | Component | Implementation | Test/evidence | Status |
|---|---|---|---|---|
| Persistent document tabs in global shell | Shell | `DocumentTabs.tsx`, mounted `document-session-stack` | source-truth audit + PR CI #190 | Verified |
| Multiple open documents | Shell / Files | native picker, browser multi-open, drag/drop, independent sessions | `session.test.ts`, `browserStore.test.ts` | Implemented |
| Independent editor state | Shell | inactive document workspaces remain mounted by session ID | code audit; PDF/Office state tests | Implemented |
| Independent Undo/Redo | PDF / Office | per-workspace history refs and bounded history models | `pdf/history.test.ts`, `office/history.test.ts` | Implemented |
| Dirty and saving state | Shell + document writers | tab status indicator + PDF/Office write callbacks | session tests + PR CI #190 | Verified |
| Middle-click and keyboard close | Tab strip / shell shortcuts | middle-click, Ctrl/Cmd+W, Ctrl+Shift+W | code audit | Implemented |
| Keyboard tab switching | Shell shortcuts | Ctrl+Tab / Ctrl+Shift+Tab | `session.test.ts` cycle coverage | Implemented |
| Detailed audit | Documentation | `docs/audits/UI-53.5-DOCUMENT-TABS.md` | canonical README SHA recorded | Implemented |

## Source-truth UI 53.6 — left navigation rail / panel

| Requirement | Component | Implementation | Test/evidence | Status |
|---|---|---|---|---|
| Narrow icon rail + expandable panel | PDF Workspace | 58 px icon rail + 224 px expandable panel in `PdfWorkspace.tsx` / `theme.css` | `leftNavigation.test.ts`; source-truth audit | Verified in PR #64 / CI #193 |
| Canonical PDF panel set | PDF Workspace | Pages / Bookmarks / Attachments / Layers / Signatures / Comments / Search model in `leftNavigation.ts` | exact-set regression test | Verified in PR #64 / CI #193 |
| Operational existing panel functions | PDF Workspace | Pages thumbnails/selection, Search, Comments, attachment embed, signature-field inventory | existing PDF tests + new navigation regression | Verified in PR #64 / CI #193 |
| Honest unsupported nested features | PDF Workspace | Bookmarks/Layers render explicit unavailable state; no fake controls | audit/code review | Implemented |
| Collapsible suite navigation | Shell | application sidebar collapse to 60 px rail | build/typecheck + audit | Verified in PR #64 / CI #193 |
| Collapsible PDF navigation | PDF Workspace | independent panel collapse to 58 px rail | build/typecheck + audit | Verified in PR #64 / CI #193 |
| Detailed audit | Documentation | `docs/audits/UI-53.6-LEFT-NAVIGATION.md` | canonical README SHA + lines recorded | Implemented |

## Source-truth UI 53.7 — central canvas / PDF render priority

| Requirement | Component | Implementation | Test/evidence | Status |
|---|---|---|---|---|
| First visible page has highest render priority | PDF Workspace | `renderPriority.ts` focus phase + gated `PdfPageCanvas` | `renderPriority.test.ts` | Verified in PR #125 / CI #196 |
| Next/previous pages follow focus page | PDF Workspace | adjacent render phase opens only after focused page renders | scheduler regression tests | Verified in PR #125 / CI #196 |
| Visible thumbnails follow critical page pass | PDF Workspace | thumbnail render gate via `pdfCriticalPassReady` | scheduler regression tests | Verified in PR #125 / CI #196 |
| Remaining pages/thumbnails stay lazy | PDF Workspace | lazy phase + IntersectionObserver; offscreen `getPage()` avoided | code audit + build/tests | Verified in PR #125 / CI #196 |
| Neutral document-first canvas | PDF Workspace / theme | neutral dark gray/navy canvas + reduced page shadow | source-truth audit | Verified in PR #125 / CI #196 |
| Detailed audit | Documentation | `docs/audits/UI-53.7-CENTRAL-CANVAS.md` | canonical SHA/lines recorded | Implemented |

## Source-truth UI 53.8A — contextual right-inspector shell

| Requirement | Component | Implementation | Test/evidence | Status |
|---|---|---|---|---|
| Canonical inspector tabs | Shell / PDF Workspace | Properties / AI / Security / Comments / Sign in `inspector.ts` and `PdfWorkspace.tsx` | `inspector.test.ts` exact-set regression | Verified in PR #127 / CI #200 |
| Per-document inspector state | PDF Workspace | inspector tab/hidden state owned by each mounted PDF workspace | code audit; persistent mounted sessions from §53.5 | Verified in PR #127 / CI #200 |
| Hide/show keyboard shortcut | Shell contract / PDF Workspace | `Ctrl/Cmd+Shift+.` via `isDocumentInspectorToggleShortcut` | shortcut unit tests | Verified in PR #127 / CI #200 |
| Reclaim canvas width when hidden | PDF Workspace / theme | `inspector-hidden` grid removes the right column | build + source-truth audit | Verified in PR #127 / CI #200 |
| Real PDF document/page context | PDF Workspace | page, selection count, document metadata, edit/history/view and existing operational controls | code audit | Verified in PR #127 / CI #200 |
| Real suite actions from inspector | Shell / PDF Workspace | AI, Security and Sign navigate to existing workspaces; Comments opens existing PDF panel | build/code audit | Verified in PR #127 / CI #200 |
| Unsupported selection contexts are not faked | PDF Workspace | text/image-specific controls explicitly remain separate requirements | audit | Implemented |
| Detailed audit | Documentation | `docs/audits/UI-53.8A-RIGHT-INSPECTOR-SHELL.md` | canonical SHA/lines recorded | Implemented |

## Source-truth UI 53.9A — PDF task categories / focused toolbar

| Requirement | Component | Implementation | Test/evidence | Status |
|---|---|---|---|---|
| Canonical PDF task categories | PDF Workspace | exact Home / Edit / Convert / Organize / Comment / Sign / Protect / Forms / AI / Scan / Automate model in `taskToolbar.ts` | `taskToolbar.test.ts` exact-order regression | Verified in PR #129 / CI #203 |
| Focused commands rather than every command at once | PDF Workspace | active category selects one bounded command set in `PdfWorkspace.tsx` | code audit + build | Verified in PR #129 / CI #203 |
| Lower-frequency tools move to overflow | PDF Workspace | primary six actions + `More` disclosure for remaining category actions | code audit | Verified in PR #129 / CI #203 |
| Explicit keyboard access | PDF Workspace | Alt+Shift category shortcuts + Arrow/Home/End roving category navigation | `taskToolbar.test.ts` | Verified in PR #129 / CI #203 |
| Ctrl+K discoverability | Command bus / palette | searchable Edit/Organize/Comment/signature operations plus existing suite routes | command registration + build | Verified in PR #129 / CI #203 |
| Accessibility labels and disabled reasons | PDF Workspace | tab/toolbar ARIA semantics, text labels, reason-bearing titles | source audit + build | Verified in PR #129 / CI #203 |
| Unsupported tools are not faked | PDF Workspace | Convert empty-state and explicit audit boundary for missing object-edit tools | audit | Implemented |
| Detailed audit | Documentation | `docs/audits/UI-53.9A-PDF-TASK-TOOLBAR.md` | canonical SHA/lines recorded | Implemented |

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

## Phase 6 traceability — Security, metadata and signing

| Requirement | Component | Implementation | Evidence | Status |
|---|---|---|---|---|
| Metadata inspect/edit/sanitize | Metadata Studio | `metadata.ts`, `MetadataWorkspace.tsx` | metadata unit tests + CI #118 | Implemented |
| Destructive redaction/CDR | Security Center | rasterized clean-room PDF export | redaction bounds tests + CI #118 | Implemented |
| Watermark | Security Center | content-preserving pdf-lib watermark copy | code review/manual | Implemented |
| Encryption | Security Center | AES-256-GCM MALENJO envelope | round-trip/wrong-password tests | Implemented |
| ClamAV | Native security adapter | bounded direct `clamscan` process | Rust tests + external matrix pending | Implemented adapter |
| CDR isolation | Security architecture | independent from malware result, browser-local raster rebuild | docs/code review | Implemented |
| pyHanko validation | Native signing adapter | `pyhanko sign validate` | external matrix pending | Implemented adapter |
| pyHanko signing | Native signing adapter | isolated Python worker + PKCS#12 + stdin secret | external matrix pending | Implemented adapter |
| Secret protection | Native SecurityState | zeroized ephemeral passphrase tokens; no key persistence | Rust baseline tests | Implemented |
| Audit events | Native security layer | JSONL app-data audit + UI | Rust/UI review | Implemented |
| Security corpus | testing/suite/fixtures/security + signatures | synthetic cases and failure matrix | repository evidence | Implemented |

## Phase 7 traceability — DMS, automation, backup and administration

| Requirement | Component | Implementation | Evidence | Status |
|---|---|---|---|---|
| DMS indexing/version model | Enterprise DMS | app-data index + immutable version snapshots | Rust tests + CI #120 | Implemented |
| Version integrity | Enterprise DMS | SHA-256 per snapshot | native implementation | Implemented |
| Retention controls | Enterprise DMS | preview + explicit apply; newest protected | Rust retention tests | Implemented |
| Legal hold | Enterprise DMS | legal-hold exclusion from retention | Rust test | Implemented |
| Automation contracts | Automation Studio | versioned audit/snapshot workflow contract | TypeScript contract tests | Implemented |
| Local workflow runner | Automation Studio | native audit + DMS snapshot steps | native implementation | Implemented |
| Temporal adapter | Automation Studio | direct CLI, fixed 127.0.0.1:7233 | docs/code review; Windows matrix pending | Implemented adapter |
| Offline backup | Backup / DR | copied enterprise/security state + SHA-256 manifest | native tests | Implemented |
| Offline restore | Backup / DR | verify, recovery copy, stage, install, rollback attempt | Rust restore test | Implemented |
| Backup tamper detection | Backup / DR | manifest hash/size verification | Rust tamper test | Implemented |
| Kopia adapter | Backup / DR | direct snapshot/restore commands | docs/code review; external matrix pending | Implemented adapter |
| Shared policy model | Administration | owner/admin/editor/viewer permission matrix | Rust permission test | Implemented |
| Native authorization | DMS/Automation/Backup/Admin | Rust `require_permission` gates | code review + CI #120 | Implemented |
| Audit integration | Enterprise services | Phase 6 audit writer reused | code review | Implemented |
| Audit retention | Administration | archive expired events, retain active JSONL | implementation/docs | Implemented |
| Shared settings/permissions | Enterprise policy | one versioned local policy used across enterprise modules | UI/native contract | Implemented |

## Source-truth UI 53.10 — global command palette

| Requirement | Component | Implementation | Evidence | Status |
|---|---|---|---|---|
| Ctrl+K suite-wide action/search surface | Shell / command palette | existing global shortcut + shared palette retained and expanded | `CommandPalette.tsx`, `App.tsx`, audit | Verified |
| Search actions | Shell / document command bus | registered workspaces, canonical aliases and active-document commands indexed | `App.tsx`, `commandPaletteModel.ts` | Verified |
| Search documents | Files / Library + shell | desktop library + browser-session library indexed; open tabs remain switchable; unavailable files disabled | `App.tsx`, model tests | Verified |
| Search settings | Settings / shell | dedicated searchable Settings destination and setting icon/type | `App.tsx`, `CommandPalette.tsx` | Verified |
| Canonical example discoverability | Shell | every §53.10 example resolves to a real destination or an explicit disabled unavailable state | `commandPaletteModel.ts`, `commandPaletteModel.test.ts` | Verified |
| No fake unsupported operations | Shell | compression, PDF-to-Word, password protection and invoice creation are disabled discovery entries only | audit + tests | Verified |
| Detailed audit | Documentation | `docs/audits/UI-53.10-GLOBAL-COMMAND-PALETTE.md` | source SHA/lines and completion boundary recorded | Implemented |

