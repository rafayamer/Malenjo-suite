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

- current non-password text values;
- password and multiline text-field flags, while suppressing password plaintext;
- checkbox checked state;
- current radio/dropdown/list selections;
- single- vs multiselect choice semantics;
- required/read-only flags;
- available choice options.

## Mutation boundary

`fillPdfFormFields` in `src/suite/pdf/editor.ts`:

- requires an existing named field and preserves its exact PDF identifier;
- rejects read-only fields;
- validates choice selections against exact option strings already present in the PDF rather than normalizing those identifiers;
- preserves each dropdown/list field's single- vs multiselect semantics;
- supports clearing radio/dropdown/list selections;
- bounds text and choice-input counts/lengths without rewriting valid document values;
- updates field appearances normally for WinAnsi-compatible content;
- if pdf-lib's default Helvetica appearance generator cannot encode a Unicode value, preserves the field value, sets PDF `NeedAppearances`, disables the incompatible automatic appearance rewrite, and leaves appearance regeneration to a conforming reader;
- returns a new working-copy byte array rather than overwriting the source.

The workspace sends the mutation through the existing bounded per-tab history pipeline, preserving Undo/Redo, dirty state and export behavior.

## UI and commands

The Forms inspector preloads current non-sensitive field values and exposes controls for every detected field rather than truncating large forms.

- ordinary text → text input;
- multiline text → textarea;
- password text → masked replacement input; the existing plaintext value is never exposed in inventory/UI and is left unchanged unless the user enters a replacement;
- checkbox → checkbox control;
- radio → single bounded select;
- dropdown/list → single or multiple selection according to the field's actual multiselect flag;
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
- read-only rejection;
- external field names with significant surrounding whitespace;
- exact choice options with significant whitespace;
- single- vs multiselect enforcement;
- password/multiline metadata;
- invalid option rejection;
- non-WinAnsi/Unicode text serialization without the Helvetica encoding crash.

## Review hardening evidence

The Codex review edge cases are explicitly covered by the implementation/tests for this pass:

- forms with more than 16 detected fields render editing controls for every field rather than truncating the editor;
- password fields suppress existing plaintext in inventory/state and use a masked replacement control;
- multiline text fields retain line breaks through a textarea editor;
- external field names and choice option strings are matched exactly, including significant surrounding whitespace;
- dropdown/list controls honor the PDF field's actual single- vs multiselect flag;
- invalid choice values are rejected by regression tests;
- non-WinAnsi text values serialize without pdf-lib's Helvetica encoding crash by preserving the value and setting `NeedAppearances` when automatic appearance generation cannot encode it;
- read-only fields remain rejected at the mutation boundary.

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
