# PDF Completeness Pass 7 — Forms Authoring and Data

## Scope

This pass extends MALENJO-owned AcroForm workflows on top of the merged filling pass.

## Implemented

### Field authoring

The PDF workspace now creates:

- text fields;
- checkboxes;
- radio groups;
- dropdowns;
- option lists;
- push-button fields.

All created fields use normalized page coordinates, enforce in-page bounds, reject duplicate names, and flow through the existing per-tab mutation history.

Signature-field authoring remains in the Signing tranche because pdf-lib 1.17.1 exposes signature-field reading but no supported high-level signature-field constructor.

### Field properties

Existing AcroForm fields can toggle:

- Required;
- Read-only;
- Export with form data.

Property changes use pdf-lib's public field flag methods and are recorded through the normal PDF mutation history.

### Clear values

The Forms workspace can clear safely writable values while preserving field structure.

It skips:

- read-only fields;
- unsupported rich-text fields;
- ambiguous duplicate-export choice fields;
- radio groups that cannot toggle off;
- unsupported editable+multiselect dropdown combinations.

### Form-data export/import

MALENJO exports a versioned JSON format:

- format: `malenjo-pdf-form-data`;
- version: `1`;
- exported fields only;
- text, checkbox, radio, dropdown and option-list values.

Password values are never exported; password entries are emitted as redacted metadata only.

Import validates:

- format/version;
- field count and field-name limits;
- field type;
- value shape and size;
- matching field names/types in the target PDF;
- read-only protection.

Import mutations reuse the existing safe AcroForm filling implementation.

### Workspace/commands

Forms toolbar and Ctrl+K expose:

- add configured field;
- apply field values;
- clear values;
- import form data;
- export form data;
- edit supported field properties;
- flatten fields.

## Tests

Focused tests cover:

- push-button creation;
- required/read-only/exported property flags;
- clear-values behavior;
- password-redacted data export;
- JSON form-data import round-trip.

## Remaining Forms work

Still open:

- signature-field creation;
- true reset-to-`/DV` defaults;
- validation/calculation actions/rules;
- custom tab order;
- richer appearance/font/alignment/tooltip properties;
- visual drag/resize field designer;
- interoperability corpus across major PDF readers.

The PDF module remains `partial`.
