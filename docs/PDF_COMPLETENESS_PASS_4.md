# PDF Completeness Pass 4 — Headers, Bates Numbering and Page Boxes

## Implemented

This pass adds three operational PDF families to the existing MALENJO PDF mutation/history pipeline.

### Headers and footers

- selected-pages or all-pages scope;
- independent header/footer text;
- left/center/right alignment;
- font size and margin controls;
- template tokens:
  - `{page}`
  - `{pages}`
  - `{date}`
- permanent PDF text output;
- per-tab Undo/Redo before export.

### Bates-style numbering

- selected-pages or all-pages scope;
- prefix;
- suffix;
- start number;
- digit padding;
- six top/bottom alignment positions;
- font size and margin controls;
- deterministic numbering order;
- per-tab Undo/Redo before export.

### Page boxes

- CropBox;
- TrimBox;
- BleedBox;
- ArtBox;
- selected-pages or all-pages scope;
- top/right/bottom/left inset margins in PDF points;
- validation against each page's MediaBox;
- invalid/inverted boxes are rejected;
- per-tab Undo/Redo before export.

## Safety

These operations never overwrite the source document automatically. MALENJO modifies only the current in-memory tab state until the user explicitly exports/saves a new file.

## Still incomplete

This pass does not make PDF source-complete. Remaining related work includes:

- page-label number trees;
- header/footer removal/edit inventory;
- Bates scheme presets and removal;
- units other than points;
- visual crop handles;
- page-size normalization;
- N-up/imposition;
- booklet/print production controls;
- templates;
- backgrounds;
- richer production/prepress inspector states;
- full Acrobat/Foxit-class tool coverage.

The PDF module remains `partial`.
