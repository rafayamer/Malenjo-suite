# MALENJO Office adapter

Phase 3 implements MALENJO-owned DOCX, XLSX, and PPTX workspaces.

## Current architecture

- Native Tauri boundary reads only library-selected OOXML packages and validates ZIP signatures.
- `fflate 0.8.3` performs local ZIP package expansion/reassembly.
- MALENJO parses and updates selected OOXML parts.
- No Microsoft Office automation is required.
- No cloud conversion service is required.
- Advanced future conversion/rendering engines remain lazy optional adapters.

## Fidelity policy

Untouched documents use exact-copy export. After editing:

- DOCX text edits rebuild the document body while preserving other package parts.
- XLSX edits rewrite the first worksheet's cell data and may simplify formulas/styles in edited cells.
- PPTX edits update existing text runs; shapes/media/package parts are preserved, but text may reflow.

MALENJO visibly warns users when fidelity is not guaranteed. Complex content must be reviewed before replacing an original.

Future docx4j/Apache POI/LibreOffice integration remains behind provider boundaries and must not be started at application launch.
