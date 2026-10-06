# PDF Completeness Pass 6 — Page labels, links and document properties

## Implemented

### Page labels

MALENJO can create standard PDF `/PageLabels` number-tree ranges.

Each range supports:

- physical start page;
- decimal numbering;
- upper/lower Roman numerals;
- upper/lower alphabetic numbering;
- prefix-only labels;
- optional prefix;
- explicit logical start number.

Multiple ranges can coexist, enabling front matter such as `i, ii, iii` followed by body pages `1, 2, 3`.

The workspace can also clear the PDF page-label tree.

### External links

MALENJO can create real PDF `/Link` annotations on the current page.

Allowed external schemes:

- `http`
- `https`
- `mailto`

The user controls a normalized page rectangle. An optional visible label can be drawn in the PDF content while the annotation provides the clickable region.

Unsafe schemes such as `javascript:` are rejected.

### Internal links

MALENJO can create real internal PDF links targeting another page using a standard destination.

The user controls:

- source page;
- target page;
- normalized link rectangle.

### Document properties

The PDF inspector can read and update standard document information:

- title;
- author;
- subject;
- keywords;
- creator;
- producer;
- language;
- creation date (read-only display in this pass);
- modification date (read-only display, automatically refreshed after property update).

The broader Metadata Studio remains responsible for privacy/forensic metadata analysis and sanitization.

## History and source safety

Every mutation uses the existing bounded per-tab PDF history:

- apply;
- undo;
- redo;
- export.

The original source file is never silently overwritten.

## Tests

The pass verifies:

- serialized `/PageLabels` presence and removal;
- multiple label ranges;
- external/internal link annotation creation;
- document-property round trip;
- invalid link schemes;
- duplicate page-label range rejection.

## Still incomplete

This pass does not complete PDF navigation/production tooling. Remaining work includes:

- page-label inventory/edit-in-place rather than replace/clear;
- visual link rectangle placement and resize;
- link inventory/edit/delete;
- named destinations;
- bookmarks/outlines;
- actions beyond safe URI/internal-page navigation;
- viewer preference editor;
- initial page/open-action controls;
- richer metadata/XMP synchronization;
- accessibility metadata;
- full interoperability corpus.

The PDF module remains `partial`.
