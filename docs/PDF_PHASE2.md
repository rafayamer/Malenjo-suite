# Phase 2 — MALENJO PDF Workspace

## Scope

Phase 2 establishes the first real MALENJO document workspace. Rendering is owned by MALENJO UI code and uses Mozilla PDF.js only as the parsing/rendering engine. PDF mutation operations remain behind `src/suite/pdf/backend.ts` and are not enabled until a backend passes the legal, security, fidelity, Windows/offline, and performance gates.

## Viewer architecture

```text
MALENJO Library
    |
    v
Rust read_pdf_document
  - library-only document ID
  - canonical regular file
  - %PDF- signature check
  - 512 MB safety limit
  - raw Tauri IPC response
    |
    v
MALENJO PDF adapter
    |
    v
PDF.js 6.4.299 worker (local bundle)
    |
    +--> lazy page canvases
    +--> lazy thumbnails
    +--> page navigation
    +--> fit width / fit page / custom zoom
    +--> view rotation
    +--> print rendering
    +--> first-page and scroll-FPS metrics
```

Codespaces/browser mode also accepts an ephemeral local PDF through a browser file input. That preview is not added to the MALENJO document library.

## Security decisions

- No PDF is fetched from a remote URL by the Phase 2 viewer.
- The PDF.js worker is bundled locally; there is no CDN dependency.
- MALENJO does not register PDF.js scripting/JavaScript action services, so document JavaScript actions are not executed by this viewer integration.
- The native read command accepts only a document ID already present in the MALENJO library.
- The native command re-resolves the canonical regular file and validates the PDF signature.
- A 512 MB Phase 2 read limit bounds a single IPC payload.
- Malformed PDF input must fail into the workspace error state rather than crashing the shell.
- PDF mutation backends are capability-denied by default.

## Performance evidence

The workspace records:

- milliseconds from start of PDF load until page 1 finishes its first render;
- sampled animation-frame rate while the central PDF canvas scrolls.

Developer-guide targets remain approximately 500 ms for feasible first-page scenarios and 60 FPS scrolling. The UI marks sampled scrolling below 55 FPS as a warning. Measurements are device/document dependent and are not claimed as universal guarantees.

## Third-party provenance

| Component | Pin | Role | License | Distribution decision |
|---|---:|---|---|---|
| Mozilla PDF.js / pdfjs-dist | 6.4.299 | local parse/render worker | Apache-2.0 | allowed for this viewer slice; retain license/notices in release process |

Upstream: https://github.com/mozilla/pdf.js

The MALENJO UI is not a copy of Mozilla's generic viewer. It uses PDF.js APIs behind MALENJO-owned React components and styling.

## Deferred PDF backend

Stirling/PDFBox or another PDF mutation backend is not vendored by this phase. Before enabling merge/split/redaction/watermark/encryption/optimization, record the exact implementation source, version, license boundaries, transitive dependencies, and test evidence.

## Acceptance checklist

- [x] MALENJO-owned PDF workspace shell.
- [x] PDF.js viewer integrated into central canvas.
- [x] Lazy full-page rendering.
- [x] Lazy page thumbnails.
- [x] Previous/next/direct page navigation.
- [x] Fit width, fit page, custom zoom.
- [x] View rotation.
- [x] Local Save As/export-copy path.
- [x] Browser-preview download path.
- [x] Print path.
- [x] First-page timing.
- [x] Scroll-FPS sampling.
- [x] Malformed/active-content fixture corpus.
- [x] Backend capability boundary.
- [x] Dependency provenance.
- [x] Automated CI/typecheck/build verification on Phase 2 branch (CI #90: frontend, Windows Rust, Codespaces/Linux all passed).
- [ ] Windows desktop manual rendering/printing check.
- [ ] Representative fidelity corpus expansion.
