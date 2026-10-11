# MALENJO Option B — Phase 1 integrated candidate

**Date:** 2026-10-11  
**Status:** Integration/test candidate ONLY — not a production release.  
**Source parent:** `95359a6c38576296f21057e8a737f5ed00f60908` (draft PR #223).  
**Candidate branch:** `release-candidate/option-b-phase1-2026-10-11`  
**Upstream:** `main` → PR #202 (`ce7550ae79bf1569dbe59055e6e6814676701e8f`) → stacked fixes PR #203–#223.  
**Merge/release policy:** No merge to `main`, no installer publication, no release tag without explicit approval and acceptance evidence.

## Source integration and conflict reconciliation

- The source parent is a descendant of both `main` and PR #202. Against PR #202, it contains 36 additional commits and 41 changed files; against `main`, 418 commits and 172 changed files at the time of integration inspection. Branching at the cumulative descendant avoids cherry-pick duplication and Git merge conflicts.
- PRs #203–#208, #213–#217 and #219–#223 were on the checked cumulative ancestry; note that individual drafts remain open and unmerged.
- Five older **current PR head** histories diverged after downstream branches were made. They were *not* blindly re-cherry-picked:
  - PRs **#209, #210, #211:** a Rust `join(&relative)` borrow repair was independently propagated into the cumulative head, confirmed in `src-tauri/src/suite/enterprise.rs`.
  - PR **#212:** selection semantics repair uses the explicit selected PDF page(s) for edit commands, confirmed in `src/suite/pdf/PdfWorkspace.tsx`.
  - PR **#218:** PDF.js affine coordinate conversion and a real Chromium hyperlink-click smoke test were independently applied downstream, confirmed in `src/suite/pdf/PdfPageCanvas.tsx` and `scripts/pdf-ui-browser-smoke.mjs`.
- These are source-level patch equivalence checks, not proofs of full feature parity. Do **not** merge divergent draft branch heads separately without a new diff review.

## Required candidate verification

The separate **draft PR from this branch to main** runs both GitHub Actions workflows, which must pass at the final **candidate head SHA**:

1. `CI / frontend` — Windows dependency install, TypeScript typecheck, Vitest, PDF release-gate unit tests, production frontend build and JSON readiness artifact.
2. `CI / rust` — Windows `cargo check` and library `cargo test`.
3. `CI / codespace-linux` — Linux AI helper checks plus Rust check and library tests.
4. `CI / pdf-execution-linux` — real PDF save/reopen, Codespaces CLI, qpdf encrypted output/reopen.
5. `CI / stirling-core-windows` — pinned Java, qpdf, Tesseract, WeasyPrint inventory, Stirling provider build checks.
6. `PDF browser acceptance / pdf-ui-browser-linux` — real Chromium PDF tab/Find/edit/export/reopen and on-page internal-link navigation.
7. `npm run pdf:release-check` — **strict release check**; DO NOT report a passing release without it. At the Phase 1 baseline, the canonical 90-item matrix reports **0/90 release accepted** (all rows marked source-functional partial). This gate is therefore **blocked**, not a CI failure to waive.
8. Manual installer, offline workflows, real-document fidelity, 22-module acceptance and fail-injection recovery are independent gates and are NOT satisfied by these Actions jobs.

## Known unresolved release blockers

- The **220-ticket Option B acceptance backlog is not completed**. Passing existing automation is distinct from acceptance of all 22 modules and all 90 PDF capabilities.
- Workspace backup includes native enterprise/security/library and Home state but **does not include all externally linked document bytes**, so full-workspace restore parity remains open.
- Multi-domain restore cannot guarantee atomic recovery following power loss between directory swaps; durable crash recovery and fault injection remain pending.
- DOCX rich-structure editing is incomplete; some unsupported modifications are safely refused, not functionally implemented.
- Non-streaming PDF native IPC has conservative 32 MiB budgets; large-file support requires streamed or file-backed execution.
- Windows installer + provider redistribution/legal closure and genuine human task acceptance are not replaced by unit/CI success.
- The strict PDF matrix requires independent fixture, Windows offline, provider response, reopen, licensing and per-operation human sign-off; no 90/90 release claim is authorized.

## Phase 1 exit checklist

- [x] Pin complete cumulative source from PR #202 through #223 into an isolated RC branch without touching main.
- [x] Reconcile known diverged draft branch heads and verify expected fixes exist in the cumulative source.
- [x] Inspect CI workflows, package scripts and hard release gates.
- [ ] Receive green exact-head CI and Chromium browser acceptance for this **new** RC PR.
- [ ] Triage any integration failures and amend the **RC branch**, not main; rerun exact-head CI.
- [ ] Produce a final candidate test/traceability record with all check conclusions and follow-on gates.
- [ ] Full product release acceptance **deferred to later phases**. Do not mark 220 tickets accepted merely because this checklist passes.

## Provenance

GitHub compare endpoints: `main...95359a6c38576296f21057e8a737f5ed00f60908`; `ce7550ae79bf1569dbe59055e6e6814676701e8f...95359a6c38576296f21057e8a737f5ed00f60908`. Source-of-truth PDF parity matrix: `docs/pdf-stirling-parity-matrix.json`. All PRs #202–#223 remain separate review records.
