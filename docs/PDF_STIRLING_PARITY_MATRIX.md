# MALENJO PDF — Stirling tool parity evidence register

The machine-readable source of truth is [pdf-stirling-parity-matrix.json](./pdf-stirling-parity-matrix.json). Its 90 operation identifiers were transcribed in order from the October 8, 2026 MALENJO development handoff (§5A–5G), **not** independently re-audited against a newer upstream release. The upstream comparison baseline is `Stirling-Tools/Stirling-PDF@25220cbdbde2d526cebf173b94357884e180b8c1`.

**No operation is credited as complete by this initial register.** `functionalStatus: null` means **not yet audited**, not unavailable or unsuccessful. For every tool, verify the real MALENJO code, UI command, actual local Windows execution, source license and notices, positive/negative fixtures and golden tests, memory/size limits, and export/save/reopen outcomes; then set a supported status: `implemented`, `partial`, `unavailable`, or `excluded-by-license`. Exclusions need user approval.

## Release and license constraints

Root Stirling MIT does **not** apply without exception. Independently verify each source file's terms; do not copy Stirling `engine/`, proprietary, SaaS or restricted editor/desktop subtrees under the MIT assumption. Keep source provenance, copyright notices and dependency audits. Provider binary startup alone does not prove an operation works offline.

This is an evidence register, **not an implementation roadmap or feature-completion claim**. It intentionally retains a separate `windowsOffline` verification field. Mark PDF module registry status `partial` until GitHub #39/#81/#141/#143 and the final manual Windows acceptance are satisfied. Automated checks enforce 90 unique IDs and guard against unjustified `implemented` classifications in `src/suite/pdf/parityMatrix.test.ts`.
