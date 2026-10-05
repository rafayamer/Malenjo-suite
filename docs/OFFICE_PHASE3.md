# Phase 3 — Office Workspaces and OOXML Fidelity

## Scope

Phase 3 creates usable MALENJO workspaces for DOCX, XLSX and PPTX without requiring Microsoft Office or a startup conversion service.

## Architecture

```text
MALENJO Library / browser preview
          |
          v
Native OOXML read boundary
  - library document ID
  - canonical regular file
  - ZIP signature
  - 256 MB limit
          |
          v
MALENJO OOXML adapter
  - fflate 0.8.3
  - selected XML parts
          |
          +--> DOCX text editor
          +--> XLSX cell grid
          +--> PPTX slide text editor
          |
          v
Exact copy OR warned edited export
```

## Fidelity levels

### Exact-copy

If the user opens and exports without editing, MALENJO returns the original OOXML bytes unchanged.

### Structure-preserving

The editor loads selected OOXML content while keeping the package's unrelated parts.

### Reflow warning

After an edit, the UI displays a compatibility warning. The Phase 3 adapter does not claim perfect Microsoft Office round-trip fidelity for advanced constructs.

## DOCX

Implemented:

- paragraph extraction;
- text editing;
- paged document UI;
- package-preserving export;
- print path.

Known Phase 3 limits include styles/runs being simplified in the rewritten body, tracked changes, fields, equations, anchored objects, headers/footers and complex layout.

## XLSX

Implemented:

- first worksheet detection;
- inline/shared/numeric cell reading;
- editable grid;
- package-preserving export;
- print path.

Edited worksheet cells are rewritten as numeric or inline-string cells. Advanced formulas/styles/macros require a later high-fidelity provider.

## PPTX

Implemented:

- slide discovery;
- slide sidebar;
- existing text-run editing;
- preservation of the surrounding package;
- print path.

Text may reflow inside existing shapes. Phase 3 does not create new PowerPoint shapes or claim fidelity for animation/layout-master behavior.

## Lazy engines

No LibreOffice, Java service, docx4j or Apache POI process starts with MALENJO. Future high-fidelity providers remain lazy optional adapters.

## Security

- Office input is limited to regular library files or explicit browser selections.
- Native packages must have ZIP signatures.
- Native reads/writes are capped at 256 MB.
- Export rejects symbolic-link destinations.
- Original files are not silently overwritten by the Office editor.

## Third-party provenance

| Component | Version | License | Use |
|---|---:|---|---|
| fflate | 0.8.3 | MIT | local OOXML ZIP read/write |

## Acceptance checklist

- [x] DOCX editor.
- [x] XLSX editor.
- [x] PPTX editor.
- [x] Exact-copy round-trip test.
- [x] Edited DOCX package-preservation test.
- [x] Edited XLSX package test.
- [x] Edited PPTX package test.
- [x] Explicit fidelity warnings.
- [x] Export paths.
- [x] Print paths.
- [x] Lazy heavy-engine architecture.
- [x] Fidelity corpus documentation.
- [x] Dependency/license record.
- [ ] Automated CI validation.
- [ ] Manual Windows interoperability checks with Microsoft Office/LibreOffice.
