# PDF Completeness Pass 5 — Advanced AcroForm fields

## Scope

This pass deepens the existing MALENJO PDF form editor with additional real AcroForm field types and field-state inspection.

Implemented:

- radio groups;
- dropdowns;
- option/list boxes;
- multiselect where supported by the field type;
- required field flag;
- read-only field flag;
- default/selected values;
- richer field inventory with type, flags, options and current selections;
- command-palette action for the currently configured form field;
- bounded per-tab Undo/Redo through the existing PDF history pipeline.

## Field types

### Text

Existing text fields now also support:

- required;
- read-only;
- default value;
- normalized page placement.

### Checkbox

Existing checkboxes now also support:

- required;
- read-only;
- initial checked state.

### Radio group

A radio group:

- requires at least two unique options;
- creates one PDF radio widget per option;
- can select an initial value;
- renders a simple MALENJO-generated text label beside each option;
- validates that all generated widgets remain inside the page;
- supports required/read-only flags.

### Dropdown

Dropdown fields support:

- bounded option lists;
- initial selection;
- optional PDF multiselect flag;
- required/read-only flags;
- normalized placement and size.

Editable-combo-box behavior is not part of this pass.

### Option list

Option-list fields support:

- bounded option lists;
- single or multiple initial selections;
- PDF multiselect mode;
- required/read-only flags;
- normalized placement and size.

## Inventory

The right inspector reads the current AcroForm and reports:

- field name;
- field type;
- required state;
- read-only state;
- option values when applicable;
- current selected value(s) when applicable.

This inventory is the foundation for later property editing, deletion, tab order and form-data import/export.

## Safety

- duplicate field names are rejected;
- control characters are removed from field option values;
- option counts and lengths are bounded;
- coordinates/sizes must remain inside the target page;
- radio groups must fit all generated widgets on the page;
- source PDFs are not silently overwritten;
- every mutation remains undoable within the current MALENJO tab until export/close.

## Still incomplete

This pass does not make PDF forms complete. Remaining work includes:

- push buttons;
- signature-field authoring/placement;
- editable combo boxes;
- field deletion/rename/property editing;
- visual drag/resize;
- tab order;
- validation/calculation actions;
- JavaScript action policy;
- import/export form data;
- richer appearance configuration;
- XFA compatibility/read-only policy;
- form accessibility/tooltip mapping;
- full interoperability corpus against Acrobat/Foxit/Chrome/Edge and other readers.

The PDF module remains `partial`.
