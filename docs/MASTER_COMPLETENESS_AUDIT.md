# MALENJO Master Completeness Audit

## Purpose

This document corrects an earlier project-management mistake: closing a development phase or passing CI does **not** mean the corresponding MALENJO module is feature-complete.

The canonical product contract is the complete MALENJO master README plus the Enterprise Development & Implementation Guide. Phase issues are implementation milestones only.

A module may be called **complete** only when its full source-of-truth feature tree, UI commands, operational states, error behavior, persistence, security requirements, tests, performance gates and applicable Windows integration have been implemented and traced.

## Source scale

The canonical master README audited for this program contains:

- 5,945 source lines in the currently mounted canonical README;
- 382 Markdown headings;
- 1,142 Markdown bullet lines;
- 1,120 unique bullet texts after simple de-duplication;
- additional numbered requirements, code-block command lists, journeys, acceptance criteria and engineering constraints that are not included in the bullet count.

The bullet count is **not** itself a feature count. It demonstrates why the existing Phase 1–7 issue checklists cannot be treated as the full MALENJO product specification.

The Developer Guide adds further detailed implementation requirements and traceability obligations.

## Status vocabulary

MALENJO module status means:

| Status | Meaning |
|---|---|
| `foundation` | Shell/contract exists; operational feature depth is minimal. |
| `partial` | A real vertical slice works, but substantial source-of-truth functionality remains. |
| `adapter` | Integration boundary/provider choice exists, but the user workspace is not complete. |
| `planned` | Product requirement exists but meaningful implementation has not started. |
| `complete` | Full traced source feature tree is implemented and acceptance/release gates pass. |

Passing unit tests or CI does not by itself promote a module to `complete`.

## UI benchmark, Stirling upstream and intellectual-property boundary

MALENJO's preferred reusable UI/UX and PDF workflow source is the **MIT-licensed open core of Stirling-PDF**, pinned and reviewed in `third_party/stirling-pdf/PROVENANCE.md`. Where a suitable MIT Stirling implementation exists, it should be adapted before inventing an unrelated shell/PDF interaction.

MALENJO still targets:

- Acrobat-class professional document information architecture;
- Foxit-class perceived speed;
- mature multi-document/tab workflows;
- task categories and contextual command sets;
- document-first canvas;
- collapsible left rail/panel;
- contextual right inspector;
- global Ctrl+K action/document/settings search;
- strong keyboard navigation and accessibility.

Stirling-PDF is open-core. MALENJO may reuse MIT content outside the restricted directories listed by the Stirling root LICENSE, but must **not** copy `engine/`, proprietary, saas, desktop, cloud, prototypes or portal-family restricted code without a separate valid agreement.

MALENJO also must not copy Adobe/Foxit trademarks, copyrighted icons/assets, exact proprietary layout, artwork, branding or trade dress. The customer-facing product identity remains MALENJO.

## Phase 1–7 correction

### Global shell / Files — PARTIAL

Implemented:

- local desktop library reference model;
- browser/Codespaces temporary file model;
- workspace routing;
- current correction branch adds persistent multi-document tabs;
- current correction branch adds multi-file open into independent tabs;
- current correction branch adds real Ctrl+K command palette for implemented actions;
- per-tab dirty/saving indicators and close behavior.

Still required:

- complete shared command bus for Open, Save, Save As, Export, Undo, Redo, Print, Share, Sign, OCR, AI, Automate, Version History, Security and Properties;
- independent undo/redo history contract for every editor;
- autosave/recovery working-copy system;
- abnormal-termination recovery UI;
- Windows double-click/file-association launch into the correct workspace;
- drag/drop open;
- complete task-category layer;
- collapsible left workspace rail/panel;
- dockable contextual right inspector;
- richer tab actions and session restoration;
- split/compare views where specified;
- command palette coverage for every implemented feature, document and setting;
- consistent context menus and overflow menus;
- complete keyboard shortcut map;
- visual regression against approved MALENJO concepts.

### PDF Workspace — PARTIAL

Current implementation is primarily a PDF.js viewing vertical slice.

Master requirements still include major operational families such as:

- object selection and editing;
- vector/path selection;
- Bézier/node editing;
- text-object editing;
- image replace/crop;
- clipping masks;
- grouping;
- advanced z-order;
- snapping and guides;
- exact positioning;
- opacity/blend controls where feasible;
- object property inspector;
- advanced text properties;
- page boxes;
- headers/footers;
- background;
- templates;
- richer OCG/layer controls;
- unified apply/undo/redo/serialize/save command history;
- full organize/convert/comment/protect/forms workflows required elsewhere in the guide;
- bookmarks, attachments, signatures, comments, search-result panels and richer inspector states;
- page manipulation and advanced mutation backend integration;
- full Windows rendering/printing/editing fidelity QA.

The master README Advanced PDF Object Editing section alone contains 21 bullet requirements/items; that does not include all PDF requirements elsewhere in the source.

The master-completeness correction branch now also adds operational page mutation primitives with tests:

- delete page while preserving at least one page;
- duplicate page;
- move page earlier/later;
- permanent 90° page rotation;
- insert a blank page;
- extract the current page to a new PDF;
- append one or more PDFs;
- export modified PDF bytes in both browser/Codespaces and Windows/Tauri paths.

These are real mutations, but they still do not make the PDF workspace source-complete.

### Document / Spreadsheet / Presentation — PARTIAL

Current implementation proves local OOXML package handling and bounded editing.

Still required includes:

- production-grade rich text formatting;
- paragraph/run/style fidelity;
- page/layout controls;
- headers/footers;
- tables;
- images and anchored objects;
- comments/review;
- tracked changes;
- fields;
- equations;
- links/bookmarks;
- advanced find/replace;
- multi-page layout fidelity;
- XLSX multi-sheet editing;
- formulas and recalculation strategy;
- cell styles/number formats;
- tables, charts, images and conditional formatting;
- merged cells/named ranges;
- presentation shape/object editing;
- masters/layouts/themes;
- media/charts/tables;
- speaker notes;
- animations/transitions where supported;
- high-fidelity docx4j/POI/LibreOffice provider path;
- comprehensive golden-document round-trip corpus.

Source bullet inventory:

- Word-like workspace: 21 items;
- Spreadsheet workspace: 15 items;
- Presentation workspace: 17 items;
- OOXML/high-fidelity handling: 15 items.

### Scanner — PARTIAL

Source scanner section contains 30 bullet requirements/items.

Current vertical slice covers capture/import and selected image processing.

Still required includes deeper production scanning behavior, device matrix, automatic/manual cleanup breadth, profile/preset behavior, page operations, feeder/device workflows where applicable, robust camera/document detection, complete Windows hardware QA and full workflow integration into OCR/PDF/DMS.

### OCR — PARTIAL

Source OCR section contains 15 bullet requirements/items.

Still required includes packaged/supervised PaddleOCR deployment, richer language/model management, complete OCR JSON contract coverage, region/layout behavior, confidence review UX, correction workflows, batch OCR, production caching/model lifecycle and broader accuracy/performance corpus.

### Malenjo AI — PARTIAL

Source Local AI section contains 38 bullet requirements/items.

Current implementation provides local document extraction, lexical retrieval, citations and Ollama/llama.cpp chat.

Still required includes:

- summarization;
- translation;
- contract clause extraction;
- obligations/deadline extraction;
- invoice/receipt extraction;
- semantic search;
- document classification;
- file naming suggestions;
- PII detection;
- redaction suggestions;
- OCR correction;
- document-comparison explanation;
- workflow decision assistance;
- organization-level local RAG;
- model download/import management surface;
- model license metadata;
- hardware capability detection;
- RAM/VRAM estimator;
- CPU/GPU selection;
- model presets;
- explicit offline mode controls;
- admin-disable-AI policy;
- per-feature model assignment;
- AI audit records;
- prompt/version management;
- sensitive-data policy;
- MODEL_LICENSES.json and model checksums;
- broader evaluation and multilingual quality gates.

#### Codespaces defect and correction

Previous code explicitly disabled model inference whenever `isTauri() === false`, which made generative AI impossible in the browser shell even if Ollama/llama.cpp was running inside the Codespace VM.

The master-completeness correction branch adds a constrained Vite development bridge for only:

- Ollama `GET /api/tags`;
- Ollama `POST /api/chat`;
- llama.cpp `GET /v1/models`;
- llama.cpp `POST /v1/chat/completions`.

Desktop/Tauri inference continues through the native Rust loopback-only boundary.

A model/runtime still has to be explicitly installed and running inside the Codespace. MALENJO does not pretend generative AI exists without a model.

### Invoice Studio — PLANNED

The master Invoice Studio section contains 74 bullet requirements/items plus templates and AI/integration requirements.

The current repository does not contain a production Invoice Studio.

Required work includes the source template system, 50+ product-owned templates, business/customer/item/tax/currency/payment-term data, deterministic live preview/PDF output, reusable profiles, custom templates, invoice lifecycle, PDF/sign/share/archive integration, AI-assisted data extraction where allowed and unified DMS/backup/audit integration.

### E-Signature — PARTIAL

The master mature e-signature section contains 20 bullet requirements/items.

Current implementation proves local cryptographic validation/signing adapter behavior.

Still required includes visual signature placement, signature fields, appearance editor, certificate UX, signer evidence separation, multi-party routing, pending/completed states, deadlines/reminders, ordered routing, audit/completion package, document-change evidence and broader trust/revocation workflows.

### RBAC / Identity / MFA / SSO — PARTIAL / PLANNED

Source inventory:

- enterprise RBAC: 11 items;
- MFA/passkeys/LDAP/SSO: 12 items.

Current Phase 7 local role policy is not the full enterprise identity system.

Still required includes identity provider integration, group/user binding, MFA/passkeys, LDAP/AD/SSO, session policy, organization administration, role assignment, central policy enforcement and the selected Keycloak/Authelia + Casbin/OpenFGA architecture.

### DMS / Records — PARTIAL

Source DMS section contains 21 bullet requirements/items.

Current implementation provides local registration, immutable version snapshots, retention and legal hold.

Still required includes the complete source entity model, indexing/search, richer records relationships, permissions, check-in/out where specified, metadata schemas, retention classes, lifecycle, records disposition/audit, connectors, collaboration and enterprise deployment behavior.

### Automation Studio — PARTIAL

Source advanced automation section contains 29 bullet requirements/items.

Current implementation supports a small versioned workflow contract and limited local steps.

Still required includes the full visual branching designer, source node types, triggers, conditions, branches, approvals, retries, schedules/watchers/connectors, trust-boundary visualization, execution history, per-node local/network/file-change/external-send declarations, enterprise node disable policies and broader Temporal worker/runtime integration.

### Backup / DR — PARTIAL

Source backup/DR section contains 14 bullet requirements/items.

Current implementation proves verified local app-state backup/restore plus a Kopia boundary.

Still required includes broader backup scope/policy, scheduling, encryption/key policy, destination/provider profiles, retention, validation drills, enterprise/offline deployment, managed restore flows, complete document/config/model coverage as specified and disaster-recovery runbooks.

### Security / Anti-tamper / Hardware / Watermark / PQC — PARTIAL OR NOT IMPLEMENTED

Source inventory includes:

- security baseline: 19 items;
- commercial integrity/anti-tamper: 17 items;
- hardware-backed security: 10 items;
- forensic/invisible watermarking: 15 items;
- post-quantum crypto: 4 items.

Phase 6 covers selected sanitization, audit, ClamAV and signing boundaries only.

TPM-backed protections, full integrity/signature chain, forensic watermarking and PQC are not complete.

### Metadata Studio — PARTIAL

The dedicated deep Metadata Studio source section contains **265 Markdown bullet lines** in the currently mounted canonical README.

Current implementation handles a small subset of PDF/OOXML standard metadata.

Still required includes the deep inspector/editor/privacy model across EXIF/TIFF, GPS, IPTC, XMP, ICC, PDF structures, DOCX core/extended/custom/package data, forensic mode, privacy risk scoring, before/after diff, transactional safety, batch operations, templates/policies, deep library adapters, performance/security requirements and enterprise policy integration.

### CAD — ADAPTER

Source CAD section contains 10 bullet requirements/items.

No complete CAD workspace exists yet.

### DICOM — ADAPTER

Source DICOM section contains 10 bullet requirements/items.

No complete DICOM workspace exists yet.

### Installer / Updater / Uninstaller — NOT COMPLETE

The locked installer/update/uninstaller section contains 69 Markdown bullet lines plus 33 nested headings in the currently mounted canonical README.

Still required includes the full NSIS/MSIX paths, component packs, custom/standard/enterprise offline setup, first-run onboarding, repair, rollback, silent deployment/removal, winget path, update channels/manifests, differential strategy, signing, installer security, CI matrix and uninstall data-preservation behavior.

### Packaging / component packs — NOT COMPLETE

The distribution/component-pack section still requires core/Office/OCR/AI/CAD/DICOM/enterprise pack manifests, checksums, optional downloads, offline deployment, cleanup, size budgets and CI size regression gates.

### Home — COMPLETE AFTER OSS-STRUCTURE CORRECTION

Home's functional feature tree remains implemented, but its earlier `complete` promotion relied on an inaccurate UI-source provenance claim: the merged structure did not actually follow `satnaing/shadcn-admin` closely enough.

Correction #139 replaces that with a source-level adaptation of the Apache-2.0 `CasualOffice/desktop` launcher at commit `39fe70960462a9f16ea4f1e9aaa8b963d5da6ef1`. Adapted source components now cover action cards, recent-file cards, search, segmented filtering, context menus and Office-style recent grouping.

Home was deliberately demoted during correction and re-promoted only after corrected implementation CI #224 passed frontend typecheck/tests/build, Windows Rust check/tests and Codespaces/Linux validation. Final-head and post-merge CI remain required evidence for the correction merge.

This correction does not affect the incomplete status of Home destination modules.

### Shell / Files
- Tauri webview native file-drop handling adds dropped paths through the persistent MALENJO library command;
- Codespaces/browser drag/drop registers temporary session files and opens them into independent document tabs;
- tab action menu: close, close others, close tabs to right, close all;
- Ctrl/Cmd+Shift+W closes all tabs with a dirty-document confirmation gate;
- current Ctrl/Cmd+W single-tab behavior remains.

### PDF
- local PDF.js full-document text search over up to 500 pages, capped to 100 result pages per search;
- search-result snippets navigate directly to matching pages;
- permanent text placement on the current PDF page;
- permanent highlight or outline rectangle placement;
- overlay mutations flow through PR #33's bounded per-tab Undo/Redo history;
- overlay coordinates are validated and tested.

These are operational additions, not source-complete Acrobat/Foxit parity. Visual drag handles, direct existing-text/object editing, comments/true annotation objects, forms, bookmarks, attachments, compare, advanced protect/convert flows and many other master requirements remain open.


## Completion pass — Codespaces AI bootstrap

The Codespaces bridge already routes only approved local status/chat endpoints. This pass makes the development runtime operational rather than merely reachable:

- explicit `npm run ai:codespace:setup` installs/starts the Ollama runtime on loopback only and downloads no model;
- explicit `npm run ai:codespace:setup:model` installs the reviewed `qwen3:0.6b` development model and runs a local smoke test;
- `third_party/models/MODEL_LICENSES.json` records the reviewed model source, Apache-2.0 license and expected Ollama digest prefix;
- `npm run ai:codespace:check` now distinguishes server-only from AI-ready runtime+model state;
- the Malenjo AI runtime panel surfaces the correct setup command based on current state;
- CI syntax-validates both shell helpers and JSON-validates the model manifest without downloading external software or weights.

This remains a development profile, not the full master AI model manager. Production model import/download, license acceptance, checksums, resource estimation, policy and per-feature model assignment remain open under the AI completeness workstream.


## Completion pass 3 — PDF comments, forms and attachments

Implemented on `feat/pdf-completeness-comments-forms-attachments`:

- genuine PDF `/Text` sticky-note annotations;
- AcroForm text fields and checkboxes;
- interactive form-field inventory;
- form flattening;
- embedded file attachments with per-file limits;
- command-bus actions for attachment embedding and form flattening;
- all mutations use the existing bounded per-tab Undo/Redo history.

Still open in these families: annotation rendering/edit/reply/resolve/delete, attachment inventory/extract/remove/scan, richer AcroForm field types/properties/signature fields, visual field placement, form data import/export, XFA policy and deeper compatibility testing.

The PDF module remains `partial`.


## Completion pass 4 — PDF headers, Bates numbering and page boxes

Implemented on `feat/pdf-completeness-numbering-pageboxes`:

- permanent header/footer templates with page/pages/date tokens;
- selected-page or all-page scope;
- left/center/right alignment;
- Bates-style prefix/start/digit/suffix numbering;
- six Bates positions;
- CropBox, TrimBox, BleedBox and ArtBox inset controls;
- all mutations use the existing bounded per-tab Undo/Redo history and explicit export path.

Still open: page-label number trees, header/footer/Bates inventory/removal/editing, visual crop handles, page-size normalization, print-production controls, templates/backgrounds and the wider master PDF tool tree.

The PDF module remains `partial`.
