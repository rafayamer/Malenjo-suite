/* MAL-046 / 047 / 048 / 049 form designer engine.
 *
 * Fields are placed from rectangles drawn on the page as shown (fractions, any view rotation) and
 * stay ordinary AcroForm fields: text (plain, number, date), check box, radio group, dropdown,
 * list box and unsigned signature placeholders. Logic is written as standard form scripts
 * (formLogic.ts). Signed documents are refused: changing them would invalidate the signature.
 */
import {
  PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFNumber, PDFOptionList, PDFRadioGroup,
  PDFRef, PDFSignature, PDFStream, PDFString, PDFTextField, StandardFonts, TextAlignment, decodePDFRawStream, PDFRawStream,
  rgb, type PDFField, type PDFFont, type PDFForm, type PDFPage,
} from 'pdf-lib';
import { frameOf } from '../content/objectEdit';
import type { ShownRect } from '../pdfMarkup';
import { calculationOrder, displayValue, logicScripts, parseLogic, renameInLogic, logicDependencies, type FieldFormat, type FieldLogic, type FieldScripts } from './formLogic';

export type DesignKind = 'text' | 'number' | 'date' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'signature';
export interface ChoiceOption { value: string; label: string }
export interface SignatureLock { action: 'none' | 'all' | 'include' | 'exclude'; fields: string[] }
export interface DesignFieldSpec {
  kind: DesignKind; name: string; pageNumber: number; viewRotation: number; rect: ShownRect;
  tooltip?: string; required?: boolean; readOnly?: boolean;
  maxLength?: number; comb?: boolean; multiline?: boolean; defaultValue?: string;
  format?: FieldFormat;
  options?: ChoiceOption[]; selected?: string[]; multiselect?: boolean; checked?: boolean;
  lock?: SignatureLock;
}
export interface DesignWidget { ref: string; pageNumber: number; shown: ShownRect }
export interface DesignField {
  name: string; kind: DesignKind | 'button'; widgets: DesignWidget[];
  tooltip: string; required: boolean; readOnly: boolean; maxLength: number | null; comb: boolean; multiline: boolean;
  options: ChoiceOption[]; multiselect: boolean; lock: SignatureLock | null; logic: FieldLogic; signed: boolean;
  /** Check box on-value ("Yes" for new fields). */
  onValue: string | null;
}
export interface FieldPropertyChange {
  tooltip?: string; required?: boolean; readOnly?: boolean; maxLength?: number | null; comb?: boolean; multiline?: boolean;
  logic?: Omit<FieldLogic, 'unsupported'>; lock?: SignatureLock;
}

const N = PDFName.of;
const BORDER = rgb(0.08, 0.32, 0.56), FILL = rgb(0.97, 0.98, 1);

export async function loadForm(bytes: Uint8Array): Promise<PDFDocument> {
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { throw new Error('This PDF could not be read because it is encrypted, invalid or damaged.'); }
  if (pdf.catalog.lookupMaybe(N('AcroForm'), PDFDict)?.has(N('XFA'))) throw new Error('XFA forms are not supported: changing them would discard the XFA form data.');
  return pdf;
}
function refuseSigned(pdf: PDFDocument): void {
  if (pdf.catalog.has(N('Perms'))) throw new Error('This PDF is certified; changing its form would invalidate the certification.');
  for (const field of pdf.getForm().getFields()) {
    if (field instanceof PDFSignature && field.acroField.dict.has(N('V'))) throw new Error('This PDF is signed; changing its form would invalidate the signature.');
  }
}
export const saveForm = async (pdf: PDFDocument) => Uint8Array.from(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));

function checkName(form: PDFForm, name: string, except?: string): string {
  const clean = name.trim();
  if (!/^[\p{L}\p{N}_ -]{1,60}$/u.test(clean)) throw new Error('Field names use letters, digits, spaces, _ or - (up to 60 characters).');
  if (clean !== except && form.getFieldMaybe(clean)) throw new Error(`A field named “${clean}” already exists.`);
  return clean;
}

// ---- Scripts ------------------------------------------------------------------------------------

function scriptText(action: unknown, pdf: PDFDocument): string {
  const dict = action instanceof PDFRef ? pdf.context.lookup(action) : action;
  if (!(dict instanceof PDFDict)) return '';
  const js = dict.get(N('JS')); const value = js instanceof PDFRef ? pdf.context.lookup(js) : js;
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  if (value instanceof PDFRawStream) return new TextDecoder().decode(decodePDFRawStream(value).decode());
  if (value instanceof PDFStream) return new TextDecoder().decode(value.getContents());
  return '';
}
export function readScripts(pdf: PDFDocument, fieldDict: PDFDict): FieldScripts {
  const aa = fieldDict.lookupMaybe(N('AA'), PDFDict);
  const scripts: FieldScripts = {};
  for (const trigger of ['K', 'F', 'V', 'C'] as const) { const text = aa ? scriptText(aa.get(N(trigger)), pdf) : ''; if (text) scripts[trigger] = text; }
  return scripts;
}
/** Writes the supported logic plus any unsupported statements the field already had. */
function writeLogic(pdf: PDFDocument, fieldDict: PDFDict, logic: FieldLogic): void {
  const scripts = logicScripts(logic);
  for (const kept of logic.unsupported) {
    const trigger = kept.slice(0, 1) as keyof FieldScripts;
    scripts[trigger] = [scripts[trigger], kept.slice(3)].filter(Boolean).join('\n');
  }
  const aa = fieldDict.lookupMaybe(N('AA'), PDFDict) ?? pdf.context.obj({});
  for (const trigger of ['K', 'F', 'V', 'C'] as const) {
    if (scripts[trigger]) aa.set(N(trigger), pdf.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(scripts[trigger]!) }));
    else aa.delete(N(trigger));
  }
  if (aa.keys().length) fieldDict.set(N('AA'), aa); else fieldDict.delete(N('AA'));
}
/** Rebuilds /CO: every field with a calculate script, each after the fields it reads. */
function writeCalculationOrder(pdf: PDFDocument): void {
  const form = pdf.getForm();
  const fields = form.getFields().map((field) => ({ name: field.getName(), field, logic: parseLogic(readScripts(pdf, field.acroField.dict)) }));
  const withScripts = fields.filter((f) => f.logic.calculate || f.logic.showWhen || f.logic.unsupported.some((u) => u.startsWith('C:')));
  const ordered = [...withScripts.filter((f) => !f.logic.calculate), ...calculationOrder(withScripts)];
  if (ordered.length) form.acroForm.dict.set(N('CO'), pdf.context.obj(ordered.map((f) => f.field.ref)));
  else form.acroForm.dict.delete(N('CO'));
}

// ---- Geometry and appearances -----------------------------------------------------------------

function pageRect(pdf: PDFDocument, pageNumber: number, viewRotation: number, rect: ShownRect) {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 0.005 || rect.height < 0.005) throw new Error('Drag a larger box for the field.');
  const frame = frameOf(pdf, pageNumber, viewRotation);
  const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y]].map(([x, y]) => frame.toPage(x, y));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
const pageRotation = (page: PDFPage) => (((page.getRotation().angle % 360) + 360) % 360);

/** Form XObject for a widget appearance, drawn upright for the page's rotation. */
function appearance(pdf: PDFDocument, width: number, height: number, rotation: number, content: string | ((w: number, h: number) => string), font?: PDFFont): PDFRef {
  const [bw, bh] = rotation % 180 ? [height, width] : [width, height];
  const r = (rotation * Math.PI) / 180, c = Math.round(Math.cos(r)), s = Math.round(Math.sin(r));
  return pdf.context.register(pdf.context.stream(typeof content === 'string' ? content : content(bw, bh), {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, bw, bh], Matrix: [c, s, -s, c, 0, 0], Resources: font ? { Font: { Helv: font.ref } } : {},
  }));
}
function signatureAppearance(pdf: PDFDocument, widget: PDFDict, font: PDFFont): void {
  const [x1, y1, x2, y2] = widget.lookup(N('Rect'), PDFArray).asArray().map((v) => (v as PDFNumber).asNumber());
  const rotation = widget.lookupMaybe(N('MK'), PDFDict)?.lookupMaybe(N('R'), PDFNumber)?.asNumber() ?? 0;
  const size = Math.max(6, Math.min(10, (rotation % 180 ? x2 - x1 : y2 - y1) * 0.4));
  const ap = appearance(pdf, Math.abs(x2 - x1), Math.abs(y2 - y1), rotation, (w, h) =>
    `q 0.97 0.98 1 rg 0 0 ${w} ${h} re f 0.08 0.32 0.56 RG 1 w 0.5 0.5 ${w - 1} ${h - 1} re S 0.25 0.3 0.38 rg BT /Helv ${size} Tf 4 4 Td ${font.encodeText('Sign here').toString()} Tj ET Q`, font);
  widget.set(N('AP'), pdf.context.obj({ N: ap }));
}
/** Radio buttons carry their own label in the appearance, so moving a button moves its label. */
function radioAppearance(pdf: PDFDocument, widget: PDFDict, font: PDFFont): void {
  const label = widget.lookupMaybe(N('MALENJO_Label'), PDFString, PDFHexString)?.decodeText();
  const on = widget.lookupMaybe(N('AP'), PDFDict)?.lookupMaybe(N('N'), PDFDict)?.keys().map((k) => k.decodeText()).find((k) => k !== 'Off');
  if (label === undefined || !on) return;
  const [x1, y1, x2, y2] = widget.lookup(N('Rect'), PDFArray).asArray().map((v) => (v as PDFNumber).asNumber());
  const rotation = widget.lookupMaybe(N('MK'), PDFDict)?.lookupMaybe(N('R'), PDFNumber)?.asNumber() ?? 0;
  const [w, h] = rotation % 180 ? [y2 - y1, x2 - x1] : [x2 - x1, y2 - y1];
  const d = Math.min(h - 2, w), cy = h / 2, rr = d / 2, k = 0.5523, cx = 1 + rr;
  const circle = (r: number) => `${cx + r} ${cy} m ${cx + r} ${cy + r * k} ${cx + r * k} ${cy + r} ${cx} ${cy + r} c ${cx - r * k} ${cy + r} ${cx - r} ${cy + r * k} ${cx - r} ${cy} c ${cx - r} ${cy - r * k} ${cx - r * k} ${cy - r} ${cx} ${cy - r} c ${cx + r * k} ${cy - r} ${cx + r} ${cy - r * k} ${cx + r} ${cy} c`;
  const size = Math.max(6, Math.min(11, h * 0.7));
  const text = `0.08 0.12 0.16 rg BT /Helv ${size} Tf ${d + 5} ${cy - size * 0.35} Td ${font.encodeText(label).toString()} Tj ET`;
  const base = `q 0.97 0.98 1 rg 0.08 0.32 0.56 RG 1 w ${circle(rr - 0.5)} b ${text} Q`;
  const make = (dot: boolean) => appearance(pdf, x2 - x1, y2 - y1, rotation, dot ? `${base} q 0.08 0.32 0.56 rg ${circle(rr * 0.45)} f Q` : base, font);
  widget.set(N('AP'), pdf.context.obj({ N: pdf.context.obj({ [on]: make(true), Off: make(false) }) }));
}

/** Widget refs of a field (its /Kids widgets, or the field itself when merged). */
function widgetRefs(field: PDFField): PDFRef[] {
  const kids = field.acroField.dict.lookupMaybe(N('Kids'), PDFArray);
  return kids ? kids.asArray().filter((k): k is PDFRef => k instanceof PDFRef) : [field.ref];
}
function pageIndexOfAnnots(pdf: PDFDocument): Map<string, number> {
  const map = new Map<string, number>();
  pdf.getPages().forEach((page, index) => page.node.lookupMaybe(N('Annots'), PDFArray)?.asArray().forEach((ref) => { if (ref instanceof PDFRef) map.set(ref.toString(), index + 1); }));
  return map;
}

/** Draws a choice field showing its labels while /V and /I keep the export values. */
function choiceAppearance(pdf: PDFDocument, field: PDFDropdown | PDFOptionList, font: PDFFont): void {
  const dict = field.acroField.dict;
  const [v, i] = [dict.get(N('V')), dict.get(N('I'))];
  const options = choiceOptions(pdf, field);
  const values = v instanceof PDFArray ? v.asArray() : v ? [v] : [];
  const labels = values.map((x) => (x instanceof PDFString || x instanceof PDFHexString || x instanceof PDFName ? x.decodeText() : ''))
    .map((value) => options.find((o) => o.value === value)?.label ?? value);
  const known = labels.filter((label) => field.getOptions().includes(label));
  try {
    if (known.length) field.select(field.isMultiselect() ? known : known[0]); else field.clear();
    field.defaultUpdateAppearances(font);
  } finally {
    if (v) dict.set(N('V'), v); else dict.delete(N('V'));
    if (i) dict.set(N('I'), i); else dict.delete(N('I'));
    pdf.getForm().markFieldAsClean(field.ref);
  }
}

async function refreshAppearances(pdf: PDFDocument, field: PDFField): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  if (field instanceof PDFSignature) { for (const ref of widgetRefs(field)) signatureAppearance(pdf, pdf.context.lookup(ref, PDFDict), font); return; }
  if (field instanceof PDFRadioGroup && widgetRefs(field).some((ref) => pdf.context.lookup(ref, PDFDict).has(N('MALENJO_Label')))) {
    for (const ref of widgetRefs(field)) radioAppearance(pdf, pdf.context.lookup(ref, PDFDict), font);
    return;
  }
  if (field instanceof PDFTextField) {
    const raw = field.getText() ?? '';
    const shown = displayValue(raw, parseLogic(readScripts(pdf, field.acroField.dict)));
    if (shown !== raw) field.setText(shown);
    try { field.defaultUpdateAppearances(font); } finally { if (shown !== raw) field.acroField.dict.set(N('V'), PDFHexString.fromText(raw)); }
  } else if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) field.defaultUpdateAppearances();
  else if (field instanceof PDFDropdown || field instanceof PDFOptionList) choiceAppearance(pdf, field, font);
  pdf.getForm().markFieldAsClean(field.ref);
}
export { refreshAppearances as refreshFieldAppearances };

// ---- Create -------------------------------------------------------------------------------------

function checkOptions(options: ChoiceOption[] | undefined, minimum: number): ChoiceOption[] {
  const list = (options ?? []).map((o) => ({ value: o.value.trim(), label: (o.label || o.value).trim() }));
  if (list.length < minimum) throw new Error(`Add at least ${minimum} option${minimum > 1 ? 's' : ''}.`);
  if (list.length > 50) throw new Error('Up to 50 options are supported.');
  if (list.some((o) => !o.value || o.value.length > 120 || o.label.length > 120)) throw new Error('Options need an export value (up to 120 characters).');
  if (new Set(list.map((o) => o.value)).size !== list.length) throw new Error('Each option needs its own export value.');
  return list;
}
const encodable = (font: PDFFont, text: string, what: string) => { try { font.encodeText(text); } catch { throw new Error(`${what} can only use characters the standard Helvetica font can draw.`); } };

export async function addFormField(bytes: Uint8Array, spec: DesignFieldSpec): Promise<Uint8Array> {
  const pdf = await loadForm(bytes);
  refuseSigned(pdf);
  if (!Number.isInteger(spec.pageNumber) || spec.pageNumber < 1 || spec.pageNumber > pdf.getPageCount()) throw new Error('Choose a page in this PDF.');
  const page = pdf.getPage(spec.pageNumber - 1);
  const form = pdf.getForm();
  const name = checkName(form, spec.name);
  const box = pageRect(pdf, spec.pageNumber, spec.viewRotation, spec.rect);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  // pdf-lib's own rotate option also turns the rectangle; the widget is rotated through /MK /R below instead.
  const look = { borderWidth: 1, borderColor: BORDER, backgroundColor: FILL, textColor: rgb(0.05, 0.08, 0.12) };
  let field: PDFField;
  if (spec.kind === 'text' || spec.kind === 'number' || spec.kind === 'date') {
    const text = form.createTextField(name);
    if (spec.maxLength) { if (!Number.isInteger(spec.maxLength) || spec.maxLength < 1 || spec.maxLength > 2000) throw new Error('Maximum length must be 1 to 2000.'); text.setMaxLength(spec.maxLength); }
    if (spec.comb) { if (!spec.maxLength) throw new Error('A comb field needs a maximum length.'); text.enableCombing(); }
    if (spec.multiline && spec.kind === 'text') text.enableMultiline();
    if (spec.kind !== 'text') text.setAlignment(TextAlignment.Right);
    const format = spec.kind === 'number' ? (spec.format?.kind === 'number' ? spec.format : { kind: 'number' as const, decimals: 2, separator: 0 as const, currency: '' })
      : spec.kind === 'date' ? (spec.format?.kind === 'date' ? spec.format : { kind: 'date' as const, pattern: 'yyyy-mm-dd' }) : undefined;
    if (format) writeLogic(pdf, text.acroField.dict, { format, unsupported: [] });
    if (spec.defaultValue) text.setText(spec.defaultValue);
    text.addToPage(page, { ...box, ...look, font });
    field = text;
  } else if (spec.kind === 'checkbox') {
    const box2 = form.createCheckBox(name);
    const side = Math.min(box.width, box.height);
    box2.addToPage(page, { x: box.x, y: box.y + box.height - side, width: side, height: side, ...look });
    if (spec.checked) box2.check();
    field = box2;
  } else if (spec.kind === 'radio') {
    const options = checkOptions(spec.options, 2);
    options.forEach((o) => encodable(font, o.label, 'Option labels'));
    const radio = form.createRadioGroup(name);
    // Options stack down the drawn box as shown; each button carries its label.
    const step = spec.rect.height / options.length;
    options.forEach((option, index) => {
      const sub = pageRect(pdf, spec.pageNumber, spec.viewRotation, { x: spec.rect.x, y: spec.rect.y + step * index + step * 0.1, width: spec.rect.width, height: step * 0.8 });
      radio.addOptionToPage(option.value, page, { ...sub, ...look });
    });
    const kids = widgetRefs(radio);
    kids.forEach((ref, index) => pdf.context.lookup(ref, PDFDict).set(N('MALENJO_Label'), PDFHexString.fromText(options[index].label)));
    if (spec.selected?.[0]) { if (!options.some((o) => o.value === spec.selected![0])) throw new Error('The selected option is not in the list.'); radio.select(spec.selected[0]); }
    field = radio;
  } else if (spec.kind === 'dropdown' || spec.kind === 'list') {
    const options = checkOptions(spec.options, 1);
    options.forEach((o) => encodable(font, o.label, 'Option labels'));
    const choice = spec.kind === 'dropdown' ? form.createDropdown(name) : form.createOptionList(name);
    choice.addOptions(options.map((o) => o.label));
    if (spec.multiselect) choice.enableMultiselect();
    const selected = spec.selected ?? [];
    if (selected.some((s) => !options.some((o) => o.value === s))) throw new Error('A selected option is not in the list.');
    if (selected.length > 1 && !spec.multiselect) throw new Error('Allow several selections first.');
    choice.addToPage(page, { ...box, ...look, font });
    // Export values differ from the shown labels: /Opt pairs, with the selection stored by export value.
    pdf.context.lookup(choice.ref, PDFDict).set(N('Opt'), pdf.context.obj(options.map((o) => (o.value === o.label ? PDFHexString.fromText(o.value) : [PDFHexString.fromText(o.value), PDFHexString.fromText(o.label)]))));
    const dict = choice.acroField.dict;
    dict.delete(N('V')); dict.delete(N('I'));
    if (selected.length) {
      dict.set(N('V'), selected.length === 1 ? PDFHexString.fromText(selected[0]) : pdf.context.obj(selected.map((s) => PDFHexString.fromText(s))));
      if (selected.length > 1) dict.set(N('I'), pdf.context.obj(selected.map((s) => options.findIndex((o) => o.value === s)).sort((a, b) => a - b)));
    }
    choiceAppearance(pdf, choice, font);
    field = choice;
  } else if (spec.kind === 'signature') {
    const dict = pdf.context.obj({
      FT: 'Sig', T: PDFHexString.fromText(name), Type: 'Annot', Subtype: 'Widget', F: 4, P: page.ref,
      Rect: [box.x, box.y, box.x + box.width, box.y + box.height], MK: { BC: [0.08, 0.32, 0.56], BG: [0.97, 0.98, 1], R: pageRotation(page) },
    });
    const ref = pdf.context.register(dict);
    form.acroForm.addField(ref);
    page.node.addAnnot(ref);
    signatureAppearance(pdf, dict, font);
    field = form.getField(name);
  } else throw new Error('Choose a field type.');
  // Appearances are drawn upright for the page's rotation.
  for (const ref of widgetRefs(field)) {
    const widget = pdf.context.lookup(ref, PDFDict);
    const mk = widget.lookupMaybe(N('MK'), PDFDict) ?? pdf.context.obj({});
    mk.set(N('R'), PDFNumber.of(pageRotation(page)));
    widget.set(N('MK'), mk);
  }
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) choiceAppearance(pdf, field, font);
  setCommon(pdf, field, { tooltip: spec.tooltip, required: spec.required, readOnly: spec.readOnly, ...(spec.kind === 'signature' ? { lock: spec.lock ?? { action: 'none', fields: [] } } : {}) });
  if (!(field instanceof PDFSignature) && !(field instanceof PDFDropdown || field instanceof PDFOptionList)) await refreshAppearances(pdf, field);
  writeCalculationOrder(pdf);
  return saveForm(pdf);
}

function setCommon(pdf: PDFDocument, field: PDFField, change: FieldPropertyChange): void {
  const dict = field.acroField.dict;
  if (change.tooltip !== undefined) {
    if (change.tooltip.length > 200) throw new Error('Tooltips are up to 200 characters.');
    // Also on separate widgets: some readers look for the tooltip on the widget itself.
    for (const target of [dict, ...widgetRefs(field).filter((r) => r !== field.ref).map((r) => pdf.context.lookup(r, PDFDict))]) {
      if (change.tooltip.trim()) target.set(N('TU'), PDFHexString.fromText(change.tooltip.trim())); else target.delete(N('TU'));
    }
  }
  if (change.required !== undefined) { if (change.required) field.enableRequired(); else field.disableRequired(); }
  if (change.readOnly !== undefined) { if (change.readOnly) field.enableReadOnly(); else field.disableReadOnly(); }
  if (change.lock !== undefined) {
    if (!(field instanceof PDFSignature)) throw new Error('Only signature fields lock other fields.');
    if (change.lock.action === 'none') dict.delete(N('Lock'));
    else {
      const names = change.lock.fields;
      if (change.lock.action !== 'all' && !names.length) throw new Error('Choose the fields the signature locks.');
      const missing = names.find((n) => !pdf.getForm().getFieldMaybe(n));
      if (missing) throw new Error(`There is no field named “${missing}”.`);
      dict.set(N('Lock'), pdf.context.obj({ Type: 'SigFieldLock', Action: { all: 'All', include: 'Include', exclude: 'Exclude' }[change.lock.action],
        ...(change.lock.action === 'all' ? {} : { Fields: names.map((n) => PDFHexString.fromText(n)) }) }));
    }
  }
}

// ---- List ---------------------------------------------------------------------------------------

function kindOf(field: PDFField, logic: FieldLogic): DesignField['kind'] {
  if (field instanceof PDFTextField) return logic.format?.kind ?? 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'list';
  if (field instanceof PDFSignature) return 'signature';
  return 'button';
}
function readLock(dict: PDFDict): SignatureLock | null {
  const lock = dict.lookupMaybe(N('Lock'), PDFDict);
  if (!lock) return { action: 'none', fields: [] };
  const action = lock.lookupMaybe(N('Action'), PDFName)?.decodeText();
  const fields = lock.lookupMaybe(N('Fields'), PDFArray)?.asArray().map((v) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '')).filter(Boolean) ?? [];
  return { action: action === 'Include' ? 'include' : action === 'Exclude' ? 'exclude' : 'all', fields };
}
export function choiceOptions(pdf: PDFDocument, field: PDFField): ChoiceOption[] {
  if (field instanceof PDFRadioGroup) {
    // Export values come from /Opt when present (pdf-lib names the on-states by index).
    const values = field.getOptions();
    return widgetRefs(field).map((ref, index) => {
      const value = values[index] ?? '';
      return { value, label: pdf.context.lookup(ref, PDFDict).lookupMaybe(N('MALENJO_Label'), PDFString, PDFHexString)?.decodeText() ?? value };
    });
  }
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    return field.acroField.getOptions().map(({ value, display }) => ({ value: value.decodeText(), label: (display ?? value).decodeText() }));
  }
  return [];
}

export async function listFormDesign(bytes: Uint8Array, viewRotation = 0): Promise<DesignField[]> {
  const pdf = await loadForm(bytes);
  const pages = pageIndexOfAnnots(pdf);
  const frames = new Map<number, ReturnType<typeof frameOf>>();
  const frame = (n: number) => { if (!frames.has(n)) frames.set(n, frameOf(pdf, n, viewRotation)); return frames.get(n)!; };
  return pdf.getForm().getFields().map((field): DesignField => {
    const dict = field.acroField.dict;
    const logic = parseLogic(readScripts(pdf, dict));
    const widgets = widgetRefs(field).flatMap((ref) => {
      const pageNumber = pages.get(ref.toString());
      const rect = pdf.context.lookup(ref, PDFDict).lookupMaybe(N('Rect'), PDFArray)?.asArray().map((v) => (v as PDFNumber).asNumber());
      if (!pageNumber || !rect || rect.length !== 4) return [];
      return [{ ref: ref.toString(), pageNumber, shown: frame(pageNumber).toShown([Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])]) }];
    });
    return {
      name: field.getName(), kind: kindOf(field, logic), widgets,
      tooltip: dict.lookupMaybe(N('TU'), PDFString, PDFHexString)?.decodeText() ?? '',
      required: field.isRequired(), readOnly: field.isReadOnly(),
      maxLength: field instanceof PDFTextField ? field.getMaxLength() ?? null : null,
      comb: field instanceof PDFTextField && field.isCombed(), multiline: field instanceof PDFTextField && field.isMultiline(),
      options: choiceOptions(pdf, field),
      multiselect: (field instanceof PDFDropdown || field instanceof PDFOptionList) && field.isMultiselect(),
      lock: field instanceof PDFSignature ? readLock(dict) : null,
      logic, signed: field instanceof PDFSignature && dict.has(N('V')),
      onValue: field instanceof PDFCheckBox ? (field.acroField.getOnValue()?.decodeText() ?? 'Yes') : null,
    };
  });
}

// ---- Edit ---------------------------------------------------------------------------------------

function fieldNamed(pdf: PDFDocument, name: string): PDFField {
  const field = pdf.getForm().getFieldMaybe(name);
  if (!field) throw new Error(`The field “${name}” no longer exists.`);
  return field;
}

/** Moves or resizes one widget to a box drawn on the page as shown, and redraws it. */
export async function moveFormWidget(bytes: Uint8Array, name: string, widgetRef: string, pageNumber: number, viewRotation: number, rect: ShownRect): Promise<Uint8Array> {
  const pdf = await loadForm(bytes);
  refuseSigned(pdf);
  const field = fieldNamed(pdf, name);
  const ref = widgetRefs(field).find((r) => r.toString() === widgetRef);
  if (!ref) throw new Error('That part of the field no longer exists.');
  const box = pageRect(pdf, pageNumber, viewRotation, rect);
  const widget = pdf.context.lookup(ref, PDFDict);
  const square = field instanceof PDFCheckBox ? Math.min(box.width, box.height) : null;
  widget.set(N('Rect'), pdf.context.obj(square === null ? [box.x, box.y, box.x + box.width, box.y + box.height] : [box.x, box.y + box.height - square, box.x + square, box.y + box.height]));
  await refreshAppearances(pdf, field);
  return saveForm(pdf);
}

export async function renameFormField(bytes: Uint8Array, from: string, to: string): Promise<Uint8Array> {
  const pdf = await loadForm(bytes);
  refuseSigned(pdf);
  const form = pdf.getForm();
  const field = fieldNamed(pdf, from);
  if (field.acroField.getParent()) throw new Error('Fields inside a field group cannot be renamed here.');
  const name = checkName(form, to, from);
  field.acroField.dict.set(N('T'), PDFHexString.fromText(name));
  // Other fields' calculations, visibility rules and signature locks follow the new name.
  for (const other of form.getFields()) {
    const logic = parseLogic(readScripts(pdf, other.acroField.dict));
    if (logicDependencies(logic).includes(from)) writeLogic(pdf, other.acroField.dict, renameInLogic(logic, from, name));
    if (other instanceof PDFSignature) {
      const lock = readLock(other.acroField.dict);
      if (lock && lock.fields.includes(from)) setCommon(pdf, other, { lock: { ...lock, fields: lock.fields.map((f) => (f === from ? name : f)) } });
    }
  }
  return saveForm(pdf);
}

export async function updateFormField(bytes: Uint8Array, name: string, change: FieldPropertyChange): Promise<Uint8Array> {
  const pdf = await loadForm(bytes);
  refuseSigned(pdf);
  const form = pdf.getForm();
  const field = fieldNamed(pdf, name);
  setCommon(pdf, field, change);
  if (field instanceof PDFTextField) {
    if (change.maxLength !== undefined) {
      if (change.maxLength === null) { field.disableCombing(); field.setMaxLength(undefined); }
      else if (!Number.isInteger(change.maxLength) || change.maxLength < 1 || change.maxLength > 2000) throw new Error('Maximum length must be 1 to 2000.');
      else if ((field.getText() ?? '').length > change.maxLength) throw new Error('The field already holds a longer value.');
      else field.setMaxLength(change.maxLength);
    }
    if (change.comb !== undefined) { if (change.comb) { if (!field.getMaxLength()) throw new Error('A comb field needs a maximum length.'); field.enableCombing(); } else field.disableCombing(); }
    if (change.multiline !== undefined) { if (change.multiline) field.enableMultiline(); else field.disableMultiline(); }
  }
  if (change.logic) {
    if (change.logic.format && !(field instanceof PDFTextField)) throw new Error('Only text fields have a number or date format.');
    for (const dep of logicDependencies({ ...change.logic, unsupported: [] })) {
      if (dep === name) throw new Error('A field cannot depend on itself.');
      if (!form.getFieldMaybe(dep)) throw new Error(`There is no field named “${dep}”.`);
    }
    const before = parseLogic(readScripts(pdf, field.acroField.dict));
    writeLogic(pdf, field.acroField.dict, { ...change.logic, unsupported: before.unsupported });
    writeCalculationOrder(pdf); // also refuses calculation cycles
    if (field instanceof PDFTextField) field.setAlignment(change.logic.format ? TextAlignment.Right : TextAlignment.Left);
  }
  await refreshAppearances(pdf, field);
  return saveForm(pdf);
}

export async function deleteFormField(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const pdf = await loadForm(bytes);
  refuseSigned(pdf);
  const form = pdf.getForm();
  const field = fieldNamed(pdf, name);
  const users = form.getFields().filter((other) => other !== field && (logicDependencies(parseLogic(readScripts(pdf, other.acroField.dict))).includes(name)
    || (other instanceof PDFSignature && readLock(other.acroField.dict)?.fields.includes(name))));
  if (users.length) throw new Error(`${users.map((u) => u.getName()).join(', ')} ${users.length > 1 ? 'use' : 'uses'} this field; change ${users.length > 1 ? 'them' : 'it'} first.`);
  // Some imported documents keep widget refs in /Annots that pdf-lib does not track: remove them by identity.
  const refs = new Set([field.ref.toString(), ...widgetRefs(field).map((r) => r.toString())]);
  for (const page of pdf.getPages()) {
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) { const entry = annots.get(i); if (entry instanceof PDFRef && refs.has(entry.toString())) annots.remove(i); }
  }
  form.removeField(field);
  writeCalculationOrder(pdf);
  return saveForm(pdf);
}
