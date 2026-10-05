# pdfjs-viewer adapter

MALENJO PDF rendering adapter.

## Pin

- Engine: Mozilla PDF.js / `pdfjs-dist`
- Version: `6.4.299`
- License: Apache-2.0
- Worker: bundled locally through Vite; no CDN
- UI ownership: MALENJO React components and MALENJO styling

## Security profile

The adapter loads byte arrays provided by MALENJO, disables PDF.js eval support, and does not register the upstream scripting service. Rendering failures are surfaced inside the workspace rather than crashing the shell.

## Boundary

PDF.js owns parse/render behavior only. Merge, split, redact, watermark, encrypt, optimize, signing, and other mutation operations belong to the separate MALENJO PDF backend interface in `src/suite/pdf/backend.ts`.

See `docs/PDF_PHASE2.md` and `third_party/pdfjs/PROVENANCE.md`.
