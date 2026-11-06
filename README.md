# MALENJO Suite

Professional PDF-first document editing, conversion, security and automation suite. This repository is **under active development** and is **NOT RELEASE-READY**. A green CI workflow, a deployed demo or an open/merged development PR does not establish complete feature acceptance.

## Start here

- [Complete Master Engineering Handoff (2 November 2026)](docs/MALENJO_MASTER_EXECUTION_HANDOFF_2026-11-02.md) — consolidated history, seven ordered milestones, all 90 required PDF capabilities, the 220-item backlog, current verified repository state, blockers and the next engineering tasks.
- [Master Specification v2](docs/MALENJO_MASTER_SPEC_V2.md) — controlling PDF-first product contract.
- [Completeness Audit](docs/MASTER_COMPLETENESS_AUDIT.md) — implemented versus missing feature depth.
- [Requirements Traceability](docs/TRACEABILITY.md) — module/test/evidence mapping.
- [PDF Parity Matrix](docs/PDF_STIRLING_PARITY_MATRIX.md) and [PDF Release Self-Audit](docs/PDF_RELEASE_SELF_AUDIT.md) — honest partial implementation versus acceptance.
- [GitHub Roadmap Issue #238](https://github.com/rafayamer/Malenjo-suite/issues/238) — historical ten-phase verification and 220-ticket release obligations, incorporated into the newer seven-phase structure.

## Development policy

Engineering changes target **integration/option-b-codespaces-validation** through narrow PRs and pass exact-head CI, real applicable Chromium, output and security checks before merge. Do not merge the accumulated integration branch wholesale into **main**, publish installers or call MALENJO release ready until full feature acceptance, user UAT and native Windows verification are complete. The owner has cancelled LottieFiles; use lightweight static first-party Home icons while preserving separate PDF 2.0 and MAL-001–090 requirements. No third-party assets or customer documents are included here by implication.

The original canonical README and enterprise guide named in [Source Manifest](docs/SOURCE_MANIFEST.md) were not accessible at their documented paths during the 2 November review; this README links verified in-repository materials without pretending to replace missing source packages.
