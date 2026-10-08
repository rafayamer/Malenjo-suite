# PDF Completeness Pass 7 — AcroForm Field Creation Hardening

## Scope

This pass hardens the existing MALENJO-owned AcroForm field-creation primitives for:

- text fields;
- checkboxes;
- radio groups;
- dropdowns;
- option/list fields.

The primitives already existed on `main`; this pass closes data-integrity gaps so creation follows the same conservative semantics established by AcroForm filling.

## Creation boundary

Field creation in `src/suite/pdf/editor.ts` now:

- preserves the exact user-authored field name instead of silently rewriting whitespace or punctuation;
- rejects empty, overlong, or control-character field names;
- rejects duplicate field names before mutation;
- preserves exact option strings, including significant surrounding whitespace;
- rejects empty, overlong, control-character, or duplicate option values instead of normalizing them;
- rejects invalid initial choice selections rather than silently dropping them;
- rejects multiple initial selections for single-select choice fields;
- rejects duplicate initial selected values;
- rejects text defaults above the explicit 2,000-character workspace bound instead of silently truncating them;
- rejects AcroForm field creation on XFA/hybrid PDFs so MALENJO does not risk desynchronizing or discarding XFA form data;
- keeps placement bounded to the active page and existing normalized page-coordinate contract;
- preserves required/read-only flags;
- returns a new working-copy byte array.

## Workspace semantics

The Forms workspace no longer trims, comma-splits, auto-generates, or otherwise rewrites field names/options before they reach the mutation boundary.

Creation continues through the existing `mutate()` pipeline, so successful edits participate in:

- bounded Undo/Redo;
- dirty state;
- working-copy replacement;
- export/save semantics;
- current-page restoration;
- error reporting;
- AcroForm reinspection after the source bytes change.

## Tests

`src/suite/pdf/editor.test.ts` now adds regression coverage for:

- exact field-name preservation;
- exact option-value preservation;
- duplicate-name rejection;
- duplicate-option rejection;
- invalid-selection rejection;
- overlong default-text rejection;
- XFA/hybrid creation rejection.

Existing tests continue to cover:

- text-field creation;
- checkbox creation;
- radio-group creation;
- dropdown creation;
- option-list creation;
- required/read-only flags;
- initial selections;
- save/reload inspection;
- flattening of ordinary AcroForms.

## Deliberately not claimed

This pass does not implement:

- push buttons;
- signature-field authoring;
- field rename/delete/property editing;
- visual drag/resize designer;
- validation or calculation JavaScript;
- tab order;
- reset/clear;
- form-data import/export;
- richer appearance design;
- accessibility/tooltip authoring;
- XFA authoring.

The Forms tree and overall PDF module therefore remain `partial`.
