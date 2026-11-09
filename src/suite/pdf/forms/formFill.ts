/* MAL-050 / MAL-052: fill a form with its logic applied, save, and flatten all or chosen fields.
 *
 * Values are checked and calculated by formLogic (no document JavaScript runs). The saved file keeps
 * raw values in /V and shows formatted text in the appearances, as form readers do; fields hidden by
 * a visibility rule get the Hidden widget flag.
 */
import { PDFArray, PDFBool, PDFCheckBox, PDFDict, PDFDropdown, PDFName, PDFNumber, PDFOptionList, PDFRadioGroup, PDFRef, PDFSignature, PDFStream, PDFTextField, type PDFDocument, type PDFField, type PDFForm, type PDFPage } from 'pdf-lib';
import { fillPdfFormFields, type PdfFormFieldUpdate } from '../editor';
import { choiceOptions, loadForm, readScripts, refreshFieldAppearances, refuseSigned, saveForm } from './formDesign';
import { cyclicCalculations, evaluateForm, logicDependencies, parseLogic, type FieldLogic, type FormEvaluation, type LogicField } from './formLogic';

const N = PDFName.of;
const HIDDEN = 2;

export interface FillField {
  name: string; kind: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'signature' | 'button';
  value: string; onValue: string | null; options: { value: string; label: string }[]; multiselect: boolean;
  required: boolean; readOnly: boolean; maxLength: number | null; logic: FieldLogic; calculated: boolean;
  /** A password text field: its value is masked on screen. */
  password: boolean;
  /** A multiline text field: edited in a multiline box so its line breaks survive. */
  multiline: boolean;
  /** The field's existing value is not shown (password or rich text) but it is not empty. */
  concealedValue: boolean;
  /** The concealed value itself, used only to evaluate calculations and rules while the user leaves it untouched. */
  storedValue?: string;
  /** An editable dropdown: besides its options, any typed value is allowed. */
  editable: boolean;
}

function kindOf(field: PDFField): FillField['kind'] {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'list';
  return field instanceof PDFSignature ? 'signature' : 'button';
}
function valueOf(field: PDFField): string {
  if (field instanceof PDFTextField) return field.isPassword() || field.isRichFormatted() ? '' : field.getText() ?? '';
  if (field instanceof PDFCheckBox) return field.isChecked() ? field.acroField.getOnValue()?.decodeText() ?? 'Yes' : 'Off';
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? '';
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const v = field.acroField.dict.get(N('V'));
    const list = v instanceof PDFArray ? v.asArray() : v ? [v] : [];
    return list.map((x) => ('decodeText' in x ? (x as { decodeText(): string }).decodeText() : '')).filter(Boolean).join('\n');
  }
  return '';
}

function fieldsOf(pdf: PDFDocument): FillField[] {
  const fields: FillField[] = pdf.getForm().getFields().map((field) => {
    const logic = parseLogic(readScripts(pdf, field.acroField.dict));
    return {
      name: field.getName(), kind: kindOf(field), value: valueOf(field),
      onValue: field instanceof PDFCheckBox ? field.acroField.getOnValue()?.decodeText() ?? 'Yes' : null,
      options: choiceOptions(pdf, field), multiselect: (field instanceof PDFDropdown || field instanceof PDFOptionList) && field.isMultiselect(),
      required: field.isRequired(), readOnly: field.isReadOnly(), password: field instanceof PDFTextField && field.isPassword(), multiline: field instanceof PDFTextField && field.isMultiline(),
      concealedValue: field instanceof PDFTextField && (field.isPassword() || field.isRichFormatted()) && Boolean(field.getText()), maxLength: field instanceof PDFTextField ? field.getMaxLength() ?? null : null,
      ...(field instanceof PDFTextField && (field.isPassword() || field.isRichFormatted()) && field.getText() ? { storedValue: field.getText() } : {}),
      logic, calculated: Boolean(logic.calculate), editable: field instanceof PDFDropdown && field.isEditable(),
    };
  });
  // A calculation that depends on itself cannot be evaluated: it is kept in the file, listed as unsupported,
  // and the field is filled like any other, so the rest of the form still works.
  const cyclic = cyclicCalculations(fields);
  return fields.map((f) => !cyclic.has(f.name) ? f : {
    ...f, calculated: false,
    logic: { ...f.logic, calculate: undefined, unsupported: [...f.logic.unsupported, `${f.name}: its calculation depends on itself, so MALENJO does not run it`] },
  });
}

/** The form's fields with their current values and logic. */
export async function readFillForm(bytes: Uint8Array): Promise<FillField[]> {
  return fieldsOf(await loadForm(bytes));
}

/** Calculations, visibility and validation for proposed values (field name → value). */
export function evaluateFill(fields: FillField[], values: Record<string, string>): FormEvaluation {
  // A concealed value the user leaves untouched is still in the file: calculations and rules read it, and it
  // satisfies "required", but it is never shown and never written back.
  const untouched = (f: FillField) => f.concealedValue && !(values[f.name] ?? '');
  const evaluation = evaluateForm(fields.filter((f) => f.kind !== 'button' && f.kind !== 'signature').map((f): LogicField => ({
    name: f.name, kind: f.kind, value: untouched(f) ? f.storedValue ?? '' : values[f.name] ?? f.value, logic: f.logic, maxLength: f.maxLength ?? undefined,
    required: f.required && !untouched(f),
  })));
  for (const f of fields) if (untouched(f) && f.name in evaluation.values) { evaluation.values[f.name] = ''; delete evaluation.errors[f.name]; }
  return evaluation;
}

function widgets(field: PDFField): PDFDict[] { return field.acroField.getWidgets().map((w) => w.dict); }
function setHidden(dict: PDFDict, hidden: boolean): void {
  const flags = dict.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0;
  const next = hidden ? flags | HIDDEN : flags & ~HIDDEN;
  if (next !== flags) dict.set(N('F'), PDFNumber.of(next));
}

/**
 * Fills the form: refuses values that fail validation (listing every problem), writes calculated
 * values, formats number and date appearances, and hides fields whose visibility rule is not met.
 */
export async function fillFormWithLogic(bytes: Uint8Array, values: Record<string, string>): Promise<{ bytes: Uint8Array; evaluation: FormEvaluation }> {
  const before = await loadForm(bytes);
  refuseSigned(before);
  const fields = fieldsOf(before);
  const evaluation = evaluateFill(fields, values);
  const problems = Object.values(evaluation.errors);
  if (problems.length) throw new Error(`Check the form: ${problems.join(' ')}`);
  const updates: PdfFormFieldUpdate[] = [];
  for (const field of fields) {
    const next = evaluation.values[field.name];
    if (next === undefined || next === field.value || field.calculated || field.readOnly) continue;
    if (field.kind === 'text') updates.push({ name: field.name, value: next });
    else if (field.kind === 'checkbox') updates.push({ name: field.name, checked: next !== 'Off' && next !== '' });
    else if (field.kind === 'radio' || field.kind === 'dropdown' || field.kind === 'list') updates.push({ name: field.name, selected: next ? next.split('\n') : [] });
  }
  const filled = updates.length ? await fillPdfFormFields(bytes, updates) : bytes;
  const pdf = await loadForm(filled);
  const form = pdf.getForm();
  for (const field of fields) {
    const target = form.getFieldMaybe(field.name);
    if (!target) continue;
    if (field.calculated && target instanceof PDFTextField) target.setText(evaluation.values[field.name]);
    // Only a supported visibility rule decides the Hidden flag; other fields keep the document's own flags.
    if (field.logic.showWhen) for (const widget of widgets(target)) setHidden(widget, evaluation.hidden.includes(field.name));
    // Formatted text appearances, and labelled radio buttons, are redrawn after the values change. A label the
    // standard font cannot draw (non-Latin text) is left for the reader, as fillPdfFormFields does.
    if ((target instanceof PDFTextField && (field.logic.format || field.calculated)) || target instanceof PDFRadioGroup
      || target instanceof PDFDropdown || target instanceof PDFOptionList) {
      try { await refreshFieldAppearances(pdf, target); } catch { form.acroForm.dict.set(N('NeedAppearances'), PDFBool.True); }
    }
  }
  // Filling may have left appearances for the reader (choice labels, characters outside the standard font).
  // Draw what can be drawn here; keep the reader flag only for what cannot.
  if (form.acroForm.dict.lookupMaybe(N('NeedAppearances'), PDFBool)?.asBoolean()) {
    let deferred = false;
    for (const target of form.getFields()) {
      if (target instanceof PDFSignature || !(target instanceof PDFTextField || target instanceof PDFCheckBox || target instanceof PDFRadioGroup || target instanceof PDFDropdown || target instanceof PDFOptionList)) continue;
      if (target instanceof PDFTextField && (target.isPassword() || target.isRichFormatted())) { deferred = true; continue; }
      try { await refreshFieldAppearances(pdf, target); } catch { deferred = true; }
    }
    if (!deferred) form.acroForm.dict.delete(N('NeedAppearances'));
  }
  return { bytes: await saveForm(pdf), evaluation };
}

/** Pages that hold each widget, for flattening. */
function widgetPage(pdf: PDFDocument, widget: PDFDict, ref: PDFRef | null): PDFPage | undefined {
  const p = widget.get(N('P'));
  const byP = p instanceof PDFRef ? pdf.getPages().find((page) => page.ref.toString() === p.toString()) : undefined;
  return byP ?? pdf.getPages().find((page) => page.node.lookupMaybe(N('Annots'), PDFArray)?.asArray().some((a) => ref !== null && a instanceof PDFRef && a.toString() === ref.toString()));
}

/**
 * Flattens the named fields (or every field) into page content: their current appearances become
 * part of the page and the fields are removed. Hidden widgets are dropped without drawing.
 */
export async function flattenFormFields(bytes: Uint8Array, names: string[] | null): Promise<{ bytes: Uint8Array; flattened: string[] }> {
  const pdf = await loadForm(bytes);
  refuseSigned(pdf);
  const form: PDFForm = pdf.getForm();
  if (form.acroForm.dict.lookupMaybe(N('NeedAppearances'), PDFBool)?.asBoolean()) {
    throw new Error('Some field appearances are left for the reader to draw; save the form in a PDF reader that redraws them before flattening.');
  }
  const all = form.getFields();
  const chosen = names === null ? all : names.map((name) => { const f = form.getFieldMaybe(name); if (!f) throw new Error(`The field “${name}” no longer exists.`); return f; });
  if (!chosen.length) throw new Error(names === null ? 'This PDF has no form fields to flatten.' : 'Choose the fields to flatten.');
  const chosenNames = new Set(chosen.map((f) => f.getName()));
  for (const other of all.filter((f) => !chosenNames.has(f.getName()))) {
    const dep = logicDependencies(parseLogic(readScripts(pdf, other.acroField.dict))).find((d) => chosenNames.has(d));
    if (dep) throw new Error(`${other.getName()} uses ${dep}; flatten them together or change ${other.getName()} first.`);
  }
  const wrapped = new Set<string>();
  for (const field of chosen) {
    if (field instanceof PDFSignature && field.acroField.dict.has(N('V'))) throw new Error(`${field.getName()} is signed and cannot be flattened.`);
    const kids = field.acroField.dict.lookupMaybe(N('Kids'), PDFArray)?.asArray() ?? [];
    const refs: (PDFRef | null)[] = kids.length ? kids.map((k) => (k instanceof PDFRef ? k : null)) : [field.ref];
    // A field with a value must show it once flattened: draw any missing appearance first, and refuse if one
    // still cannot be drawn rather than removing the field and its value.
    const hasValue = (() => { const v = valueOf(field); return Boolean(v) && !(v === 'Off' && (field instanceof PDFCheckBox || field instanceof PDFRadioGroup)); })()
      || (field instanceof PDFTextField && (field.isPassword() || field.isRichFormatted()) && Boolean(field.getText()));
    const drawable = (widget: (typeof widgets)[number]) => {
      const ap = widget.getAppearances()?.normal;
      if (!ap) return false;
      if (ap instanceof PDFDict) return ap.get(N(widget.getAppearanceState()?.decodeText() ?? 'Off')) instanceof PDFRef;
      return true;
    };
    const widgets = field.acroField.getWidgets();
    const visible = (widget: (typeof widgets)[number]) => !((widget.dict.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0) & HIDDEN);
    if (hasValue && widgets.some((w) => visible(w) && !drawable(w))) {
      try { await refreshFieldAppearances(pdf, field); } catch { /* checked below */ }
      if (widgets.some((w) => visible(w) && !drawable(w))) throw new Error(`${field.getName()} has a value but no appearance MALENJO can draw, so flattening it would lose the value.`);
    }
    widgets.forEach((widget, index) => {
      const flags = widget.dict.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0;
      if (flags & HIDDEN) return;
      const page = widgetPage(pdf, widget.dict, refs[index] ?? null);
      const ap = widget.getAppearances()?.normal;
      if (!page || !ap) return;
      let stream: PDFRef | undefined;
      if (ap instanceof PDFDict) {
        const state = widget.getAppearanceState()?.decodeText() ?? 'Off';
        const chosenAp = ap.get(N(state));
        stream = chosenAp instanceof PDFRef ? chosenAp : undefined;
      } else stream = pdf.context.getObjectRef(ap);
      if (!stream) return;
      const name = page.node.newXObject('FlatWidget', stream);
      const { x, y, width, height } = widget.getRectangle();
      // The appearance's BBox (after its /Matrix) is fitted into the widget rectangle.
      const found = pdf.context.lookup(stream);
      const xobject = found instanceof PDFStream ? found.dict : found instanceof PDFDict ? found : pdf.context.obj({});
      const bbox = xobject.lookupMaybe(N('BBox'), PDFArray)?.asArray().map((v) => (v as PDFNumber).asNumber()) ?? [0, 0, width, height];
      const m = xobject.lookupMaybe(N('Matrix'), PDFArray)?.asArray().map((v) => (v as PDFNumber).asNumber()) ?? [1, 0, 0, 1, 0, 0];
      const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[2], bbox[1]]].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]);
      const [tx1, ty1] = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))];
      const [tw, th] = [Math.max(...pts.map((p) => p[0])) - tx1, Math.max(...pts.map((p) => p[1])) - ty1];
      const sx = tw ? width / tw : 1, sy = th ? height / th : 1;
      if (!wrapped.has(page.ref.toString())) {
        // Isolate the page's own graphics state from the drawn fields.
        page.node.normalize();
        page.node.wrapContentStreams(pdf.context.register(pdf.context.stream('q\n')), pdf.context.register(pdf.context.stream('\nQ\n')));
        wrapped.add(page.ref.toString());
      }
      page.node.addContentStream(pdf.context.register(pdf.context.stream(`q ${sx} 0 0 ${sy} ${x - tx1 * sx} ${y - ty1 * sy} cm /${name.decodeText()} Do Q\n`)));
    });
    form.removeField(field);
  }
  // Calculation order entries for removed fields would dangle.
  const co = form.acroForm.dict.lookupMaybe(N('CO'), PDFArray);
  if (co) {
    const live = new Set(form.getFields().map((f) => f.ref.toString()));
    const kept = co.asArray().filter((r) => r instanceof PDFRef && live.has(r.toString()));
    if (kept.length) form.acroForm.dict.set(N('CO'), pdf.context.obj(kept)); else form.acroForm.dict.delete(N('CO'));
  }
  return { bytes: await saveForm(pdf), flattened: chosen.map((f) => f.getName()) };
}
