# PDF security and fidelity corpus

These fixtures are intentionally tiny. They establish categories that Phase 2 and later fuzz/corpus work must preserve.

- `truncated.pdf` — begins with a PDF header but is structurally incomplete.
- `javascript-action.pdf` — contains JavaScript/OpenAction markers. MALENJO's Phase 2 viewer does not register a PDF scripting service.
- `wrong-header.pdf` — has a .pdf filename but no PDF signature; the native read boundary must reject it.

Do not replace this directory with production/user documents. Add only redistributable synthetic fixtures.
