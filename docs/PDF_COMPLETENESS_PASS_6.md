# PDF Completeness Pass 6 — AcroForm Filling

## Scope

This pass closes the MALENJO PDF requirement to fill existing AcroForm fields without relying on Stirling's restricted form-detection model.

## Implemented

The PDF workspace can now edit values for existing:

- text fields;
- checkboxes;
- radio groups;
- dropdowns;
- option/list fields.

The existing MALENJO-owned field inventory now also reports:

- current text values;
- checkbox checked state;
- current radio/dropdown/list selections;
- required/read-only flags;
- available choice options.

## Mutation boundary

`fillPdfFormFields` in `src/suite/pdf/editor.ts`:

- requires an existing named field;
- rejects read-only fields;
- constrains radio/dropdown/list selections to options present in the PDF;
- supports clearing radio/dropdown/list selections;
- bounds text input;
- updates field appearances before serialization;
- returns a new working-copy byte array rather than overwriting the source.

The workspace sends the mutation through the existing bounded per-tab history pipeline, preserving Undo/Redo, dirty state and export behavior.

## UI and commands

The Forms inspector preloads current field values and exposes type-appropriate controls.

- text → text input;
- checkbox → checkbox control;
- radio/dropdown → bounded select;
- option list → multi-select;
- unsupported button/signature fields remain detected but are not falsely exposed as fillable.

The Forms task toolbar and Ctrl+K command bus expose **Apply field values** only when editable fillable fields exist.

## Tests

`src/suite/pdf/editor.test.ts` covers:

- text value replacement;
- checkbox state changes;
- radio selection;
- dropdown selection;
- multiselect option-list values;
- field re-inspection after serialization;
- read-only rejection.

## Remaining Forms work

PDF Forms are not complete yet. Still open:

- push-button creation;
- signature-field authoring/placement;
- field rename/delete/property editing;
- visual drag/resize placement;
- tab order;
- validation/calculation actions;
- JavaScript action policy;
- reset/clear workflow;
- form-data import/export;
- richer appearance configuration;
- XFA compatibility/read-only policy;
- accessibility/tooltip mapping;
- interoperability corpus across major PDF readers.

The PDF module remains `partial`.
