# MALENJO Master Specification Coverage Ledger

> Status: living engineering control document.  
> Source of truth: `MALENJO_SUITE_FINAL_MASTER_README.md` from the supplied MALENJO asset package, plus the MALENJO Enterprise Development & Implementation Guide.

## Why this ledger exists

The original Phase 1–7 implementation tickets delivered executable vertical slices, but they did not implement the complete nested feature/button/submodule tree required by the master specification.

The canonical master README audit contains:

- **5,945 lines**
- **382 Markdown headings**
- **1,114 bullet requirements/features**
- **1,092 unique bullet lines**
- **161 numbered instruction lines**

Those counts are not interchangeable with an exact feature count: some bullets are acceptance criteria, architecture rules, legal requirements, UI rules, or implementation tasks. They demonstrate the scale of the contract and why a small set of phase issues cannot be treated as feature completeness.

## Status vocabulary

| Status | Meaning |
|---|---|
| `foundation` | shell/interface/contract exists but the operational feature set is mostly absent |
| `partial` | real user operations exist, but substantial master-spec functionality remains |
| `adapter` | integration boundary/reference exists; user-facing module is not implemented |
| `planned` | master requirement exists but implementation has not started |
| `complete` | every material master-spec requirement for the module is implemented, tested and traced |

No module may be marked `complete` merely because CI passes a vertical slice.

## Current master-section coverage

| Master section | Bullet load | Current state | Major missing work |
|---|---:|---|---|
| Product identity / unified theme | 23+48 | partial | complete semantic design system, density modes, high contrast, full keyboard/a11y, command palette, complete contextual/inspector system |
| Scanner | 30 | partial | camera selection/resolution modes, auto edge detection, stability/blur/glare checks, auto capture, non-destructive processing history, reprocessing pipeline |
| Intelligent OCR | 15 | partial | full PaddleOCR packaging/model lifecycle, layout/table/handwriting options, structured JSON pipeline, confidence review/correction UI, broader language packs |
| Fully Local AI | 38 | partial | summarization, translation, clause/obligation/deadline extraction, invoice extraction, semantic library search, classification, naming, PII/redaction suggestions, OCR correction, comparison explanation, workflow assistance, organization RAG, model manager, license metadata, hardware/RAM/VRAM detection, CPU/GPU selection, presets, per-feature models, audit/prompt-version management |
| Word-like workspace | 21 | partial | rich styles, pagination fidelity, headers/footers, tables, lists, comments, tracked changes, fields, equations, images/anchoring, section/page layout, robust undo/redo and round-trip fidelity |
| Spreadsheet | 15 | partial | multi-sheet workbook UX, formulas/calculation, styles, merges, charts, filters, sort, freeze, validation, named ranges, comments, print/page setup, high-fidelity round trip |
| Presentation | 17 | partial | slide layouts/masters, shapes, images/media, tables/charts, notes, reorder/duplicate, transitions/animations policy, presenter/export fidelity |
| OOXML high fidelity | 15 | partial | docx4j/POI preservation layer, unsupported-construct detection, targeted save warnings, golden-file round-trip corpus |
| Advanced PDF object editing | 21 | foundation/partial | text/image/object editing, page operations, annotations/comments, forms, links, bookmarks, headers/footers, Bates/page labels, merge/split/organize/optimize/compress, search/replace, attachment handling and full undo/redo |
| Invoice Studio | 74 | adapter | entire operational invoice domain, profiles/customers/items/taxes/currencies/terms, deterministic live preview, PDF output, 50+ original templates, archive/DMS/sign/send flow |
| Mature e-signature | 20 | partial | visible placement/designer, multi-party routing, recipients/order/deadlines/reminders, completion records, trust/revocation UX, signed-version comparison |
| Enterprise RBAC | 11 | partial | identity-bound users/groups/roles, resource scopes, policy editor, approval and audit workflows |
| MFA / Passkeys / LDAP / SSO | 12 | planned | complete identity-provider integration and enterprise login/session lifecycle |
| DMS / Records | 21 | partial | folders/cabinets/records, advanced indexing/search, check-in/out, classifications, retention schedules, disposition workflow, legal hold management UX, record links and enterprise metadata |
| Branching Automation | 29 | partial | visual graph editor, conditions/branches/loops/retries, triggers, schedules, watches, connectors, variables, secrets, run history, node-level policy and recovery |
| Backup / DR | 14 | partial | scheduled policies, repository lifecycle, encryption/key strategy, restore drills, retention/rotation, full user data scope and enterprise recovery orchestration |
| Commercial integrity / anti-tamper | 17 | foundation | signed entitlement/config/update chain, integrity measurements, anti-rollback, hardened release pipeline and tamper response |
| Hardware-backed security | 10 | planned | TPM/Windows credential-backed keys, device binding and recovery architecture |
| CAD | 10 | adapter | actual DXF/CAD viewer/editor interactions and file operations |
| DICOM | 10 | adapter | DICOM study/series viewer, metadata, window/level, measurements, anonymization/export policy |
| Forensic/invisible watermarking | 15 | foundation | invisible/forensic marks, policy, verification, robustness testing and audit linkage |
| Post-quantum cryptography | 4 | planned | provider boundary, approved algorithms/policy, interoperability and migration plan |
| Product shell / unified UX | narrative contract | partial | common command bus, complete Open/Save/Save As/Export/Undo/Redo/Print/Share/Sign/AI/Automate/Version/Properties contract, autosave/recovery, multi-document recovery, command palette and full cross-workspace transitions |
| Local service manager | 14 | foundation | supervised Java/Python/OCR/AI/LibreOffice/etc lifecycle, ports, logs, health, restart/upgrade and crash recovery |
| Installer/update/uninstaller | 61+ | planned/partial docs | modular packs, NSIS/MSI/MSIX, repair/rollback/offline/silent install, signed updater, differential updates, channels, manifests, safe uninstall and Microsoft/direct release path |
| Enterprise UI/UX system | 16+ narrative subsections | partial | Acrobat-class information architecture with MALENJO identity, complete inspectors/context toolbars, density, accessibility/scaling, shortcuts, menus and visual regression |
| Metadata Studio | 254 | partial | EXIF/GPS/IPTC/XMP/ICC, Office extended/custom/hidden package data, forensic/raw views, batch operations, privacy presets, diff/preview, safe sanitize controls and complete format/provider coverage |

## Immediate architectural corrections

### 1. Multi-document workspace

The shell must maintain multiple independent document sessions simultaneously.

Required behavior:

- open several PDFs/Office files without replacing earlier documents;
- persistent document tabs;
- preserve editor state while switching;
- independent dirty/saving state;
- close and middle-click close;
- `Ctrl/Cmd+W` close;
- correct workspace routing per tab;
- future unsaved-document recovery/autosave;
- future tab reorder/pin/split-window support.

The correction branch implements the first operational version of this contract.

### 2. Codespaces file path

Browser/Codespaces mode must be able to select several local files into an in-memory session library and route each into the same multi-tab shell used by desktop sessions.

Browser-session files are ephemeral and are not claimed to be the persistent native MALENJO library.

### 3. Codespaces local AI

Browser mode must not simply return “Tauri required.”

The correction branch uses constrained Vite development routes for only:

- Ollama `GET /api/tags`
- Ollama `POST /api/chat`
- llama.cpp `GET /v1/models`
- llama.cpp `POST /v1/chat/completions`

This allows the browser UI to talk to an explicitly started model server inside the Codespace VM. Desktop builds continue to use the Rust native fixed-loopback boundary.

### 4. Acrobat/Foxit benchmark rule

MALENJO should reach the same **class of operational completeness**: professional multi-document workflows, dense document tooling, contextual commands, inspectors, fast rendering, strong keyboard support and deep PDF/Office operations.

It must **not** become a pixel-for-pixel clone or copy Adobe/Foxit trademarks, proprietary icons, artwork, exact layout, or trade dress. The master README explicitly requires MALENJO's own dark navy/electric-blue identity.

## Completion rule

Before any area is changed to `complete`:

1. every material master README requirement for the area is entered into traceability;
2. every required operational button/action exists or is deliberately mapped to a contextual menu/inspector/command palette;
3. nested submodules are implemented rather than represented by placeholders;
4. browser/Codespaces and Windows behavior is defined where applicable;
5. native/third-party engines pass licensing and security review;
6. unit/integration/UI/document-fidelity/security/performance tests cover the implementation;
7. the module passes its Windows and Codespaces/Linux CI gates;
8. release-quality external integration matrices remain explicitly tracked when physical software/hardware is required.
