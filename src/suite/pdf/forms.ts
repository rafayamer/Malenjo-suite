import {
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  type PDFField,
} from 'pdf-lib';

export type PdfFormFieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'option-list'
  | 'button'
  | 'signature'
  | 'unknown';

export interface PdfFormFieldDescriptor {
  name: string;
  type: PdfFormFieldType;
  value: string | boolean | string[] | null;
  options: string[];
  readOnly: boolean;
  required: boolean;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (!bytes.length) throw new Error('PDF bytes are empty.');
  return PDFDocument.load(bytes, { ignoreEncryption:false, updateMetadata:false });
}

function fieldType(field: PDFField): PdfFormFieldType {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'option-list';
  if (field instanceof PDFButton) return 'button';
  if (field instanceof PDFSignature) return 'signature';
  return 'unknown';
}

function describe(field: PDFField): PdfFormFieldDescriptor {
  const type = fieldType(field);
  let value: PdfFormFieldDescriptor['value'] = null;
  let options: string[] = [];

  if (field instanceof PDFTextField) {
    value = field.getText() ?? '';
  } else if (field instanceof PDFCheckBox) {
    value = field.isChecked();
  } else if (field instanceof PDFRadioGroup) {
    value = field.getSelected() ?? '';
    options = field.getOptions();
  } else if (field instanceof PDFDropdown) {
    value = field.getSelected();
    options = field.getOptions();
  } else if (field instanceof PDFOptionList) {
    value = field.getSelected();
    options = field.getOptions();
  } else if (field instanceof PDFSignature) {
    value = field.isReadOnly() ? 'signed/read-only' : 'signature field';
  }

  return {
    name:field.getName(),
    type,
    value,
    options,
    readOnly:field.isReadOnly(),
    required:field.isRequired(),
  };
}

export async function listPdfFormFields(bytes: Uint8Array): Promise<PdfFormFieldDescriptor[]> {
  const pdf = await load(bytes);
  return pdf.getForm().getFields().map(describe);
}

export type PdfFormValue = string | boolean | string[];

export async function setPdfFormFieldValue(
  bytes: Uint8Array,
  name: string,
  value: PdfFormValue,
): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const form = pdf.getForm();
  const field = form.getFieldMaybe(name);
  if (!field) throw new Error(`PDF form field "${name}" was not found.`);
  if (field.isReadOnly()) throw new Error(`PDF form field "${name}" is read-only.`);

  if (field instanceof PDFTextField) {
    if (typeof value !== 'string') throw new Error('Text fields require a text value.');
    field.setText(value.slice(0, 20_000));
  } else if (field instanceof PDFCheckBox) {
    if (typeof value !== 'boolean') throw new Error('Checkbox fields require a boolean value.');
    if (value) field.check(); else field.uncheck();
  } else if (field instanceof PDFRadioGroup) {
    if (typeof value !== 'string') throw new Error('Radio fields require one option value.');
    if (!field.getOptions().includes(value)) throw new Error('The selected radio option is not valid for this field.');
    field.select(value);
  } else if (field instanceof PDFDropdown) {
    if (typeof value !== 'string' && !Array.isArray(value)) throw new Error('Dropdown fields require one or more option values.');
    const requested = Array.isArray(value) ? value : [value];
    const options = field.getOptions();
    if (requested.some((item) => !options.includes(item))) throw new Error('The selected dropdown option is not valid for this field.');
    field.select(Array.isArray(value) ? value : value);
  } else if (field instanceof PDFOptionList) {
    if (typeof value !== 'string' && !Array.isArray(value)) throw new Error('Option-list fields require one or more option values.');
    const requested = Array.isArray(value) ? value : [value];
    const options = field.getOptions();
    if (requested.some((item) => !options.includes(item))) throw new Error('The selected list option is not valid for this field.');
    field.select(Array.isArray(value) ? value : value);
  } else if (field instanceof PDFSignature) {
    throw new Error('Signature fields are handled by MALENJO Sign and cannot be filled as ordinary form data.');
  } else if (field instanceof PDFButton) {
    throw new Error('Button fields do not have an editable form value.');
  } else {
    throw new Error('This PDF form field type is not supported yet.');
  }

  form.updateFieldAppearances();
  return Uint8Array.from(await pdf.save({ useObjectStreams:false }));
}

export async function clearPdfForm(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const form = pdf.getForm();

  for (const field of form.getFields()) {
    if (field.isReadOnly()) continue;
    if (field instanceof PDFTextField) field.setText('');
    else if (field instanceof PDFCheckBox) field.uncheck();
    else if (field instanceof PDFRadioGroup) field.clear();
    else if (field instanceof PDFDropdown) field.clear();
    else if (field instanceof PDFOptionList) field.clear();
  }

  form.updateFieldAppearances();
  return Uint8Array.from(await pdf.save({ useObjectStreams:false }));
}

export async function flattenPdfForm(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const form = pdf.getForm();
  form.updateFieldAppearances();
  form.flatten();
  return Uint8Array.from(await pdf.save({ useObjectStreams:false }));
}
