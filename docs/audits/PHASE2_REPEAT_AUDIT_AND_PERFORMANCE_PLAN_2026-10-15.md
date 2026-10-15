# MALENJO — mandatory three-pass audit/fix and competitive qualification plan

**Status: NOT COMPLETED** until all applicable acceptance tests and output audits have passed. No repository merge into `main` and no public release. Owner independently controls eventual `main` merge.

## Mandatory execution order (repeat at every active phase)

1. **Audit → fix → edit**: inventory every applicable source-of-truth requirement, UI affordance, input/negative case, save/export/reopen, security boundary, and unresolved bug. Apply actual code fixes with regression tests and source links.
2. **Re-audit → fix → edit again**: independently review the changed files and end-to-end journeys, deliberately try malformed/large/encrypted inputs, cancelled operations, crashes, source-file conflicts, theme and keyboard states. Fix newly found defects. Record exact commits and failing/passing test runs.
3. **Third audit → performance/optimization → competitive UX/functionality evaluation → fix/edit**: profile with realistic files and document corpus. Measure p50/p95, peak RSS/renderer memory, first usable page, cached page switching, typing latency, export bytes/integrity and cancellation UI responsiveness. Compare workflows to Acrobat, Foxit PDF Editor/Reader, PDF-XChange Editor and iLovePDF in a controlled, same-machine environment. Correct implementation bottlenecks and interaction defects. Rerun the entire regression suite after optimizing.

The three passes are engineering obligations **before** declaring each phase COMPLETED, but do not override the sequential Phase 1→7 gating, owner/UAT obligations or Windows clean-install release gates.

## Owner's authoritative v2 performance targets (section 11)

| Metric | Target |
| --- | --- |
| First usable page of typical 100-page PDF | p95 ≤ 3 s |
| Cached page switch | p95 ≤ 250 ms |
| Ordinary local text edit response | p95 ≤ 200 ms |
| Render standard page | p95 ≤ 1.5 s |
| OCR clean 300-DPI page on benchmark worker | p95 ≤ 5 s |
| Search indexed 1,000-page PDF | p95 ≤ 3 s |
| Metadata API response | p95 ≤ 300 ms |
| Monthly API availability | ≥ 99.95% |
| Baseline supported document | 2 GB |
| Baseline supported PDF page count | 10,000 |

These are **targets, not observed achievements**. 2 GB / 10,000-page support requires explicit memory and stress evidence, never inference.

## Reproducible comparative protocol

- Fixed Windows hardware and current supported versions; record CPU/GPU, RAM, OS, DPI, runtime, storage and product versions. No fabricated measurements.
- Same 1-, 10-, 100-, 1,000- and 10,000-page realistic PDFs with scans, vector graphics, layers, tables, forms, malformed inputs and sensitive/redacted sample data; document actual corpus provenance and SHA-256.
- 30 repeated runs minimum per operation when practical; separate cold-open from warm cache, calculate p50 and p95, failures, peak memory, source SHA-256 protection and output reimport.
- Functional parity: open, find, crop/rotate/reorder, undo/redo, safe copy export, annotations, text editing, conversions, batch tools, permissions, OCR, accessibility and error behavior. Mark unsupported tools **NOT COMPLETED**; never present a gallery/placeholder as functional.
- UX comparisons: document-first PDF canvas, contextual icon ribbon, task discoverability, efficient keyboard navigation, dialogs, left/right panels, visible progress and cancellation, dark/light contrast, high DPI, narrow windows and screen-reader labels. Preserve MALENJO identity; never copy competitor artwork or trade dress.
- Write benchmark data, scripts and Chromium screenshots under auditable test artifacts; record exact branch head and GitHub Actions links. Don't claim vendor speed parity without directly comparable measurements.

## Implementation evidence from this three-pass kickoff

- PDF outline traversal was recursive over document-provided items; mitigated by bounded iterative DFS and ancestor-cycle guard, plus deep-tree/cycle/limit regression cases.
- PNG page-to-image ZIP export retained large canvas buffers after failed rendering or encoding; guarded release in `finally`, plus failure-path tests.
- The above code exists on `fix/phase2-outline-depth-cycle-20261015`, with proposed integration in PR #291. **Not validated or accepted until exact-head CI/browser confirms it.**

## Upstream source/legal boundaries

- Preferred adapted open-core UI/PDF upstream: `Stirling-Tools/Stirling-PDF` at pinned reviewed commit; only MIT-granted paths, exclude restricted proprietary, SaaS, engine, desktop/cloud, prototype and portal paths.
- Additional adopted UI baseline: `CasualOffice/desktop` (Apache-2.0); actual adaptation noted in `third_party/casualoffice/PROVENANCE.md`.
- Engines/adapters and other libraries from `third_party/*/PROVENANCE.md` must be pinned, license reviewed and attributed; a GitHub repository's public visibility does **not** confer permission to copy every file.
- See `docs/THIRD_PARTY_POLICY.md` and `docs/THIRD_PARTY_NOTICES.md` for material license and release SBOM requirements.

## Phase gates

Each numbered phase and each requirement is only **COMPLETED** or **NOT COMPLETED**. Unimplemented, untested, partially operating, failing, blocked or unapproved requirements remain **NOT COMPLETED**. Later phases cannot be actively advanced or marked COMPLETED while their required earlier phase remains NOT COMPLETED.

A change merged into the isolated Codespaces integration branch is **not** release acceptance. Owner UAT and explicit approval remain distinct. Do not merge to `main`.
