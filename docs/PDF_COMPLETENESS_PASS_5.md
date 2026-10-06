# PDF Completeness Pass 5 — Links, Page Labels and Document Properties

## Implemented

### PDF links

MALENJO can add genuine PDF Link annotations to the current page.

Supported destinations:

- external HTTP URL;
- external HTTPS URL;
- mailto URL;
- internal page destination using PDF `/Dest [page /Fit]`.

External protocols such as `javascript:` and `file:` are rejected.

Link rectangles use normalized page coordinates and are validated to remain within the page.

### Page labels

MALENJO can write a PDF `/PageLabels` number tree with multiple start ranges.

Supported numbering styles:

- decimal;
- uppercase Roman;
- lowercase Roman;
- uppercase letters;
- lowercase letters.

Each range supports:

- physical start page;
- prefix;
- logical start number.

This changes PDF navigation/display labels, not printed page content.

### Document properties

The PDF inspector can edit standard document properties:

- title;
- author;
- subject;
- keywords;
- creator.

MALENJO updates producer/modification metadata through the local PDF mutation path.

Metadata Studio remains the deeper privacy/forensic surface.

## History and source safety

All three operation families use the existing bounded per-tab Undo/Redo history.

The original source document is not silently overwritten; the current tab contains the modified bytes until explicit export/save.

## Still incomplete

This pass does not make the PDF module complete.

Related open work includes:

- link inventory/edit/delete;
- visible link rectangle selection;
- named destinations;
- bookmark/outline tree editing;
- action policy beyond URI/internal page;
- page-label inventory/removal;
- custom page-label preview in thumbnails/navigation;
- deeper metadata/XMP synchronization;
- PDF portfolio/actions/navigation completeness;
- broader Acrobat/Foxit-class PDF tool coverage.

The PDF module remains `partial`.
