# MALENJO Master Completeness Audit

## Purpose

This document corrects an earlier project-management mistake: closing a development phase or passing CI does **not** mean the corresponding MALENJO module is feature-complete.

The canonical product contract is the complete MALENJO master README plus the Enterprise Development & Implementation Guide. Phase issues are implementation milestones only.

A module may be called **complete** only when its full source-of-truth feature tree, UI commands, operational states, error behavior, persistence, security requirements, tests, performance gates and applicable Windows integration have been implemented and traced.

## Source scale

The canonical master README audited for this program contains:

- 5,946 lines;
- 1,114 Markdown bullet requirements/items;
- 1,088 unique bullet lines after simple normalized de-duplication;
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

## UI benchmark and intellectual-property boundary

MALENJO targets:

- Acrobat-class professional document information architecture;
- Foxit-class perceived speed;
- mature multi-document/tab workflows;
- task categories and contextual command sets;
- document-first canvas;
- collapsible left rail/panel;
- contextual right inspector;
- global Ctrl+K action/document/settings search;
- strong keyboard navigation and accessibility.

MALENJO must **not** copy Adobe/Foxit trademarks, copyrighted icons/assets, exact proprietary layout, artwork, branding or trade dress. Functional parity and familiar professional interaction patterns are the target; MALENJO retains its own dark-navy/electric-blue identity and component implementation.

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

The dedicated deep Metadata Studio source section contains **254 bullet requirements/items**.

Current implementation handles a small subset of PDF/OOXML standard metadata.

Still required includes the deep inspector/editor/privacy model across EXIF/TIFF, GPS, IPTC, XMP, ICC, PDF structures, DOCX core/extended/custom/package data, forensic mode, privacy risk scoring, before/after diff, transactional safety, batch operations, templates/policies, deep library adapters, performance/security requirements and enterprise policy integration.

### CAD — ADAPTER

Source CAD section contains 10 bullet requirements/items.

No complete CAD workspace exists yet.

### DICOM — ADAPTER

Source DICOM section contains 10 bullet requirements/items.

No complete DICOM workspace exists yet.

### Installer / Updater / Uninstaller — NOT COMPLETE

The locked installer/update/uninstaller section contains 61 bullet requirements/items plus many numbered subsections.

Still required includes the full NSIS/MSIX paths, component packs, custom/standard/enterprise offline setup, first-run onboarding, repair, rollback, silent deployment/removal, winget path, update channels/manifests, differential strategy, signing, installer security, CI matrix and uninstall data-preservation behavior.

### Packaging / component packs — NOT COMPLETE

The distribution/component-pack section still requires core/Office/OCR/AI/CAD/DICOM/enterprise pack manifests, checksums, optional downloads, offline deployment, cleanup, size budgets and CI size regression gates.

### Settings / Account / Help — FOUNDATION

These are registered shell modules, not full source-complete systems.

Unified settings, diagnostics/support, account/device identity and related enterprise policy surfaces remain incomplete.

## Commercial-source override for the current student build

The canonical source contains commercial Free/Pro/Enterprise pricing, trial and billing requirements.

The current user instruction overrides monetization for this build:

- personal/student/classroom use;
- no business/profit requirement;
- no paid upsell UI;
- no regional pricing;
- no paid trial counters.

The underlying architecture may preserve technical account, entitlement and policy hooks so a future legally reviewed edition can use them, but the current build must not reintroduce monetization merely because it exists in the older source contract.

## Immediate architectural correction program

Before claiming later phases are complete, MALENJO must use this sequence:

1. **Shell completeness** — multi-document sessions, common command bus, task categories, Ctrl+K, inspector/rail contracts, recovery.
2. **PDF completeness** — full command inventory and mutation/edit history architecture.
3. **Office completeness** — rich editors plus round-trip fidelity providers/corpus.
4. **Scanner/OCR completeness** — device/model packaging and full operational controls.
5. **AI completeness** — all source capabilities, model manager, hardware/resource UX and policy.
6. **Sign/Metadata/Security completeness** — full operational submodules and trust/privacy UX.
7. **Invoice implementation**.
8. **Enterprise identity/RBAC completeness**.
9. **DMS/Automation/Backup completeness**.
10. **CAD/DICOM/Watermark/PQC/TPM/anti-tamper**.
11. **Settings/Account/Help completeness**.
12. **Installer/updater/uninstaller/component packs**.
13. **Windows fidelity/performance/security/accessibility/release qualification**.

## Definition of a real operational button

A command/button is not considered implemented merely because it is rendered.

It must have:

- enabled/disabled rules;
- real handler;
- correct document/context binding;
- undo/redo behavior when mutating content;
- dirty/save/recovery behavior where applicable;
- progress/cancellation for long tasks;
- error state;
- audit/security behavior where applicable;
- keyboard/accessibility semantics;
- test coverage;
- traceability entry.

Unimplemented master features should not masquerade as working controls.

## Completion rule

No future issue, milestone, module badge or user-facing status may call a module `complete` unless its source-of-truth feature manifest reaches full traced coverage or contains an explicit user-approved/legal/technical exclusion.
