# PDF security and fidelity corpus

These fixtures are intentionally tiny. They establish categories that Phase 2 and later fuzz/corpus work must preserve.

- `truncated.pdf` — begins with a PDF header but is structurally incomplete.
- `javascript-action.pdf` — contains JavaScript/OpenAction markers. MALENJO's Phase 2 viewer does not register a PDF scripting service.
- `wrong-header.pdf` — has a .pdf filename but no PDF signature; the native read boundary must reject it.

Do not replace this directory with production/user documents. Add only redistributable synthetic fixtures.
- `encrypted-user-password.pdf` — 3 blank pages, AES-256 (R6) user password `secret`, owner password `owner`. Must prompt for a password, reject a wrong one and open read-only with the right one.
- `encrypted-owner-restricted.pdf` — same pages, empty user password, owner password `owner`, modify/extract disallowed. Opens without a prompt; edits must be refused with a plain-language message, never a raw pdf-lib error.

Both encrypted fixtures were generated synthetically with pikepdf 10.16 (qpdf) on 2026-10-24.
