# MALENJO — PDF 2.0 and MAL-001–090 independent acceptance gates

**Status: NOT COMPLETED.** This document records test obligations, not implementation, ISO certification, release approval, benchmark results, or acceptance evidence.

**Provenance:** Separately preserved from the non-animation requirements in PR #292 (`docs/PDF2_AND_LOTTIE_ACCEPTANCE.md`, unmerged), checked against `docs/MALENJO_MASTER_SPEC_V2.md` §§3, 10–15, `docs/TRACEABILITY.md`, `docs/PDF_STIRLING_PARITY_MATRIX.md`, `docs/PDF_RELEASE_SELF_AUDIT.md`, and issue #238. The owner's 2026-10-16 instruction **removes the LottieFiles requirement**. This document intentionally does not retain Lottie runtimes, licensed animations, CDN dependencies, or motion acceptance criteria. No other master-v2, PDF 2.0, 90-tool, security, accessibility, performance, or native Windows requirement is waived.

## Two distinct acceptance contracts

1. **PDF 2.0 / ISO 32000-2:2020 interoperability** (see the standard's published scope at https://www.iso.org/standard/75839.html): test representative real PDF 2.0 files and PDF 1.x backward compatibility, declared versions, rendering, text extraction/search, Unicode/fonts, color spaces, structure/tags, links, annotations, form fields, embedded files, metadata, encryption, incremental updates, signatures and relevant optional constructs. Record unsupported features and safe refusals explicitly. Successfully opening a file does **not** establish writer/editing compatibility or blanket ISO conformance.
2. **MAL-001 through MAL-090 product capabilities:** each named requirement and **every** explicitly described suboperation in the v2 specification needs discoverable accessible UI, valid inputs, actual execution, authorization checks, correct error/cancellation states, independently validated outputs, source preservation, undo/redo where applicable, and positive/negative/reopen tests. The 90 product commands are not the same inventory as ISO PDF features or the separate Stirling parity matrix. Provider-dispatch-only, UI-only and partially implemented capabilities remain NOT COMPLETED.

## Binary release-evidence matrix

| Gate | Required reproducible evidence |
| --- | --- |
| PDF 2.0 reader | Real-file corpus SHA-256, declared version, independent second-tool rendering/text/search/links/tags/annotations comparison, precise supported/unsupported matrix |
| PDF 2.0 writer/mutation | Expected output version; independent reopen and object/content inspection; unchanged original hash; signature/form/layer preservation or explicit safe refusal |
| MAL-001–090 | Per-ID and per-suboperation source fixture, handler/UI, actual saved artifact, positive/negative/cancel tests, independent output reopen and requirement-to-test record |
| 2 GB / 10,000 pages | Representative stress fixtures, measured peak CPU/memory and latency, documented document-complexity tiers and bounded failure behavior |
| Performance | Real p50/p95, fixed hardware and corpus hashes, cold/warm cache separation, baseline and comparable competitive workflow measurements when actually run |
| Accessibility | Keyboard-only and assistive-technology checks, dialog/focus, Light/Dark, zoom, high DPI and operating-system reduced-motion behavior for any remaining native transitions |
| Security/privacy | Malformed/encrypted/hostile PDFs; unsafe links/actions, embedded resources, redaction text-extraction attempts, signature integrity, source-byte protection, authorization and fail-closed cases |
| Windows and owner | Exact-head CI plus native Windows clean-install, real-file reopen, UI/hardware verification and separate explicit owner UAT |

**Targets, not measured results (v2 §11):** typical 100-page PDF open-to-first-usable-page p95 ≤3 s; cached page switch ≤250 ms; ordinary text-edit feedback ≤200 ms; standard page render ≤1.5 s; clean 300-DPI OCR page ≤5 s; indexed 1,000-page search ≤3 s; ordinary metadata API ≤300 ms; 2 GB and 10,000 pages baseline.

## Required execution and traceability

Keep the seven ordered v2 milestones. For each applicable requirement: **Pass 1** audit/fix/implement with real inputs and negative cases; **Pass 2** independently re-audit, fix, save and reopen the actual output, verify unchanged originals; **Pass 3** inspect security/accessibility/UX and optimize only measured performance, then rerun regressions. Preserve traceability for all 220 tracked requirements and MAL-001–090 separately from PDF 2.0. A green unit suite, UI affordance, provider endpoint, PR merge or synthetic-only fixture is insufficient for COMPLETED.

**Owner scope exception:** Home Open File and Recent Files use lightweight first-party **static** icons. No LottieFiles assets, WASM runtime, third-party animation downloads, or animation CI gate. Remaining native transitions must respect system reduced-motion preferences and must not degrade accessibility, responsiveness or privacy.

**Current decision:** all above acceptance gates remain **NOT COMPLETED** pending evidence; no main-branch transition, release, installer or compliance claim follows from this documentation.
