# PDF Completeness Pass 3 — Comments, Forms and Attachments

## Scope

This pass deepens the existing PDF workspace with real PDF document structures rather than cosmetic placeholder buttons.

Implemented:

- real PDF `/Text` sticky-note annotations;
- AcroForm text fields;
- AcroForm checkboxes;
- AcroForm field inventory;
- form flattening;
- embedded PDF file attachments;
- multi-file attachment embedding;
- command-palette actions for attachment embedding and form flattening;
- bounded per-tab Undo/Redo integration for all new mutations.

## Comments

Comments are created as genuine PDF annotation dictionaries in the current page's `/Annots` array.

The current PDF.js canvas-only renderer does not yet include a MALENJO annotation-layer UI. Comments therefore persist into exported PDF files and participate in MALENJO history, but a later pass must add visual annotation rendering, selection, editing, replying, resolving, filtering and deletion.

## Forms

The current workspace can create:

- text fields;
- checkboxes.

Field placement uses normalized page coordinates and validates that new controls remain inside the page.

Flattening converts field appearances into static PDF page content and removes interactive fields. MALENJO warns that flattening is destructive after the tab is exported/closed; before that point, the current per-tab history can undo the operation.

Still required:

- radio buttons;
- dropdown/combo boxes;
- list boxes;
- buttons;
- signature fields;
- field property inspector;
- required/read-only flags;
- validation/calculation actions;
- visual drag/resize placement;
- tab order;
- import/export form data;
- full AcroForm/XFA compatibility policy.

## Attachments

MALENJO can embed arbitrary selected files inside a PDF using the PDF embedded-files name tree.

Safety limits:

- empty attachments are rejected;
- each new attachment is capped at 50 MB;
- file names are sanitized;
- source documents are never silently overwritten.

Still required:

- attachment inventory UI;
- open/extract attachment;
- rename;
- remove;
- malware scan integration;
- attachment policy restrictions;
- attachment-level metadata and audit entries.

## Acceptance

This pass is not full PDF completeness. It closes only a subset of the master comments/forms/attachments requirements.

The PDF module remains `partial` until the full master feature tree is implemented and traced.
