# Stirling-PDF MIT Core as MALENJO UI/UX Upstream

Status: **Accepted**  
Decision issue: #137  
Upstream pin: `Stirling-Tools/Stirling-PDF@25220cbdbde2d526cebf173b94357884e180b8c1`

## Decision

MALENJO will use the **MIT-licensed open core of Stirling-PDF as its primary UI/UX and PDF workflow baseline**.

This replaces the previous approach of independently inventing each shell and PDF interaction pattern. When a suitable open Stirling implementation exists and is legally reusable, MALENJO should adapt it before creating an unrelated custom interaction.

The product is therefore best treated as a **Stirling-open-core-derived MALENJO workstation with additional MALENJO modules**, not as a pixel-for-pixel copy of proprietary Stirling areas.

## What should track Stirling

Where compatible with the MALENJO canonical source, prefer Stirling open-core behavior for:

- application/workbench composition;
- home/startup and file-opening flows;
- tool discovery and tool navigation;
- file sidebars and workbench transitions;
- PDF viewer/editor navigation;
- reader/search interaction;
- open PDF operations and tool workflows;
- responsive/mobile interaction patterns;
- keyboard and accessibility behaviors;
- reusable open-core component and CSS patterns.

MALENJO-specific requirements remain authoritative when they add capability or conflict with the upstream product.

## MALENJO additions

MALENJO extends the baseline with its source-required capabilities, including:

- persistent multi-document desktop tabs and independent undo/dirty/saving state;
- DOCX/XLSX/PPTX workspaces;
- scanner and OCR;
- local Malenjo AI;
- signatures;
- Metadata Studio;
- Security Center;
- Invoice Studio;
- Enterprise DMS;
- Automation Studio;
- Backup / DR;
- Administration;
- CAD;
- DICOM;
- student/classroom-specific flows;
- MALENJO licensing/device architecture where applicable.

## Branding

Do not ship Stirling logos, wordmarks or customer-facing brand strings as MALENJO UI. Functional source code may be adapted under MIT, but visible identity must use MALENJO product language except where third-party attribution or diagnostics require provider names.

## License gate

Stirling-PDF is open-core. The root LICENSE grants MIT only outside named restricted directories. No code from those restricted directories may be copied into MALENJO without a separate valid Stirling license/agreement that explicitly permits the intended use and distribution.

See `third_party/stirling-pdf/PROVENANCE.md` for the exact exclusion list and reviewed commit.

## Implementation rule

For each Stirling-derived implementation:

1. identify exact upstream path and commit;
2. confirm it is outside every restricted directory;
3. copy/adapt only what is needed;
4. preserve required copyright/license notices;
5. replace customer-facing Stirling branding with MALENJO branding;
6. map the feature to MALENJO's canonical source requirement;
7. test browser/Codespaces and Windows/Tauri behavior;
8. record provenance in the feature audit/traceability;
9. do not call destination MALENJO modules complete merely because the upstream UI exists.

## Existing Home module

The current completed Home module remains operational. Its existing shadcn-admin provenance is historical and valid. A later visual-convergence change may replace its dashboard composition with Stirling MIT open-core Home/workbench patterns without changing the module's functional completion status, provided regression tests and accessibility gates remain green.

Going forward, **Stirling is the preferred UI/UX source before other generic dashboard repositories**.
