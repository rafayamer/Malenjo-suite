# MALENJO PDF — Stirling tool parity evidence register

The machine-readable source of truth is [pdf-stirling-parity-matrix.json](./pdf-stirling-parity-matrix.json). Its 90 operation identifiers were transcribed in order from the October 8, 2026 MALENJO development handoff (§5A–5G), **not** independently re-audited against a newer upstream release. The upstream comparison baseline is `Stirling-Tools/Stirling-PDF@25220cbdbde2d526cebf173b94357884e180b8c1`.

**No operation is credited as complete.** Twenty operations with real MALENJO source symbols, workspace paths and unit-test evidence are classified **`partial`**, and the other 70 remain **`null` (not yet source-audited)**. This is not a claim of Windows/provider end-to-end verification. For every tool, verify the real MALENJO code, UI command, actual local Windows execution, source license and notices, positive/negative fixtures and golden tests, memory/size limits, and export/save/reopen outcomes; then set a supported status: `implemented`, `partial`, `unavailable`, or `excluded-by-license`. Exclusions need user approval.

## Source-backed endpoint audit — pinned commit

The pinned upstream file `testing/endpoints.txt` at `Stirling-Tools/Stirling-PDF@25220cbdbde2d526cebf173b94357884e180b8c1` has **62 distinct smoke-test endpoint paths** (upstream file blob `1df2e53e690bcd4ca763f88d4d7fb5257c2d0a64`). A byte-for-byte snapshot lives in [pdf-stirling-pinned-endpoints.txt](./pdf-stirling-pinned-endpoints.txt).

Of the **90 handoff requirements**, **54 have an explicit path in that pinned endpoint-test list** and **36 do not**. There are **8 endpoint-test paths** not mapped to the handoff's tool IDs (six filters, PDF decompression, and ebook-to-PDF). These numbers measure *textual route coverage only*, not tool implementation, licensing approval, or user-facing functionality. For the 36 without a route, inspect upstream frontend/composite flows or alternate OpenAPI paths before calling anything absent.

The local PDF tools panel now cross-references the 90 items with **live** provider OpenAPI operation paths: `provider-not-loaded`, `not-in-live-openapi`, `provider-disabled`, or `provider-reports-available`. The final state means only that the local capability resolver advertises availability, **not that any document was processed, saved, reopened or validated offline**. No tools are assigned the evidence status `implemented` by this operation.

## Release and license constraints

Root Stirling MIT does **not** apply without exception. Independently verify each source file's terms; do not copy Stirling `engine/`, proprietary, SaaS or restricted editor/desktop subtrees under the MIT assumption. Keep source provenance, copyright notices and dependency audits. Provider binary startup alone does not prove an operation works offline.

This is an evidence register, **not an implementation roadmap or feature-completion claim**. It intentionally retains a separate `windowsOffline` verification field. Mark PDF module registry status `partial` until GitHub #39/#81/#141/#143 and the final manual Windows acceptance are satisfied. Automated checks enforce 90 unique IDs and guard against unjustified `implemented` classifications in `src/suite/pdf/parityMatrix.test.ts`.
