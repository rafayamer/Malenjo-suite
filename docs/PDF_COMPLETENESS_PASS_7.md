# PDF Completeness Pass 7 — AcroForm Clear / Reset

## Scope

This pass adds MALENJO-owned form-value clearing and reset-to-default behavior for supported AcroForm value fields.

## Implemented

- **Clear form values** for editable text, checkbox, radio, dropdown and option-list fields.
- **Reset to PDF defaults** using each field's inherited `/DV` value when present; fields without a default are cleared.
- Read-only fields are preserved.
- XFA/hybrid forms are rejected before mutation.
- Password, rich-text and labeled choice fields keep appearance handling on the existing reader-deferred safety path when required.
- Duplicate-export and other ambiguous choice mappings remain conservatively unsupported rather than silently rewritten.
- Button and signature controls are left untouched because they are not value-entry fields in this workflow.

## Workspace integration

The Forms task toolbar and inspector expose:

- Apply field values
- Clear form values
- Reset to PDF defaults
- Flatten form fields

All mutations use the existing per-tab PDF history path, preserving Undo/Redo, dirty state and export behavior.

## Tests

`src/suite/pdf/editor.test.ts` covers:

- clearing editable values across text/checkbox/radio/dropdown/list fields;
- preserving read-only values during clear/reset;
- restoring `/DV` defaults for text, checkbox, radio, dropdown and multiselect list fields;
- XFA/hybrid rejection for clear/reset.

## Remaining Forms work

Still open after this pass:

- push-button creation;
- signature-field authoring/placement;
- field rename/delete/property editing;
- visual drag/resize placement;
- tab order;
- validation/calculation actions;
- JavaScript action policy;
- form-data import/export;
- richer appearance configuration;
- XFA compatibility/read-only policy;
- accessibility/tooltip mapping;
- interoperability corpus across major PDF readers.

The overall PDF module remains `partial`.
