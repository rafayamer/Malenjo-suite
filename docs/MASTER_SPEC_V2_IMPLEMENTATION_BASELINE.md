# MALENJO Master Development Specification v2.0 — engineering baseline

**Source of authority:** the product owner's October 12, 2026 Master Development Specification v2.0 (sections 1–15). Its exact wording, acceptance criteria, limitations, catalog numbering, and requirements control implementation. This file is an engineering checkpoint, **not** a substitute for the master specification or product-owner approval.

## Unambiguous product definition

- MALENJO is **PDF-first**. The main workflow is native PDF viewing, modification, organization, conversion, forms, signing, security, and automation.
- Exactly **Light and Dark**, using MALENJO blue/cyan design tokens.
- Single-window desktop-style top application bar, compact contextual ribbon, document tabs, large central PDF canvas, compact bottom status/navigation area. **No permanent application sidebar.** Optional document inspectors/panels are closed by default.
- **Office DOCX/XLSX/PPTX viewers/editors are conversion-result workspaces only**: launch automatically after independently verified PDF-to-format conversion and open the resulting artifact. No standalone Office launch or Windows Office associations.
- **Top-bar AI** opens a permission-controlled, document-aware, source-citing right chat panel. Irreversible or sensitive commands require explicit confirmation and authorization. Optional local/approved inference only, never unsanctioned public AI use.
- Windows associations may be opted into only for supported PDF, CAD and DICOM types. No silent default-app takeover.
- Every enabled UI command must perform real work; every released output must independently reopen/validate. Never use decorative no-ops, fake outputs, or inflated release claims.

## Numbering and discovery

`src/suite/commands/masterCatalog.ts` is the typed registration of MAL-001 through MAL-090, with a separate mapping for the **15 original legacy tool rows**. The catalog records:

- Requirement ID, exact user-spec feature name and category
- Semantic icon token, tooltip and expected output contract
- Document/selection/permission prerequisites
- Explicit readiness state and an execution boundary that refuses unverified operations

**All 90 currently have status NOT_RELEASE_READY in the v2 contract.** This does **not** assert there is no working code elsewhere in the repository; it indicates the exact v2 acceptance contract has not yet been fully independently verified, bound and approved. Existing functional PDF engine entry points continue to work separately until reconciled with the shared registry.

The global command launcher searches the full catalog by ID, title, category and expected output. Unverified commands remain disabled with reasons. To set a command RELEASE_READY, engineering must bind the real handler, validate inputs, authorization, cancellation and error feedback, independently validate outputs, and attach traceable tests/evidence. Flipping a status field alone is prohibited.

## Master implementation sequence

1. Application Foundation — minimal shell, Home picker/recent files, document tabs, real rendering, exactly two themes, contextual command discovery.
2. Core PDF Manipulation — native editing pathways A/B/C, page operations, markup, metadata, OCR, compression and scanning.
3. Conversion & Forms — verified output fidelity, auto-open converted Office outputs, form designer/validation/batches.
4. Security & Collaboration — redaction permanence, encryption, cryptographic signing, permissions and audits.
5. AI & Automation — policy-controlled private RAG, source citations, human-approved tools, workflows, invoicing and integrations.
6. Specialized Tools — independently supported 3D PDF, CAD, DICOM and print/prepress.
7. Stabilization — 90-feature functional gates, security/performance/accessibility, clean-installed Windows, user approval and deployment readiness.

The earlier ten-phase planning issue is a historical tracker; map remaining tickets into these seven consolidated milestone headings without silently declaring any former phase completed. Joint developer/user intensive testing and Windows release acceptance remain mandatory stabilization subgates.

## Strict definition of done

**NOT RELEASE-READY** until every catalog capability MAL-001–MAL-090 and all 15 legacy tools have independently verified real execution, appropriate error/permission handling, valid opened output, UI discoverability, nonfunctional targets, performance/security/accessibility evidence, and product-owner review. Binary readiness applies **per requirement and to the whole release**, never to a passing build alone.

As of this file's creation, the v2 catalog/discovery mapping is engineering infrastructure. Native editing, PDF→Office converters and automatic editor handoff, comprehensive accessibility, AI privacy/service isolation, cloud APIs, security and Windows acceptance are still separate unverified gates.

## Critical acceptance references

- Master Specification v2.0 §§2, 3, 4, 5, 6, 8.4, 9, 10, 11, 13, 15.
- Existing issue #121 (UI/UX), issue #238 (roadmap), and 220-ticket backlog are evidence stores, not authority to reduce the newer master-spec scope.
- A green frontend test, Chromium test or pull-request merge does not certify release readiness.
