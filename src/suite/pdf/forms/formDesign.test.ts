import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addFormField, deleteFormField, listFormDesign, moveFormWidget, renameFormField, updateFormField, type DesignFieldSpec } from './formDesign';
import { evaluateFill, fillFormWithLogic, flattenFormFields, readFillForm } from './formFill';
import { exportFormData, importFormData } from './formData';

async function blank(rotate = 0) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  page.drawText('Order form', { x: 50, y: 760, size: 18, font: await pdf.embedFont(StandardFonts.Helvetica) });
  if (rotate) page.setRotation(degrees(rotate));
  return pdf.save();
}
const at = (x: number, y: number, width = 0.3, height = 0.04) => ({ x, y, width, height });
const field = (kind: DesignFieldSpec['kind'], name: string, rect = at(0.1, 0.1), extra: Partial<DesignFieldSpec> = {}): DesignFieldSpec => ({ kind, name, pageNumber: 1, viewRotation: 0, rect, ...extra });

async function pdfjs(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice() });
  const doc = await loading.promise;
  try {
    const page = await doc.getPage(1);
    const found: unknown = await doc.getFieldObjects();
    const fieldObjects = (found instanceof Map ? Object.fromEntries(found) : found ?? {}) as Record<string, Record<string, any>[]>;
    return {
      annotations: (await page.getAnnotations()) as Record<string, any>[],
      objects: fieldObjects,
      order: (await doc.getCalculationOrderIds()) as string[] | null,
      text: ((await page.getTextContent()).items as { str: string }[]).map((i) => i.str).join(' '),
    };
  } finally { await loading.destroy(); }
}

async function orderForm() {
  let bytes = await blank();
  bytes = await addFormField(bytes, field('text', 'Customer', at(0.1, 0.1), { tooltip: 'Full name', required: true, maxLength: 40 }));
  bytes = await addFormField(bytes, field('number', 'Subtotal', at(0.1, 0.2), { format: { kind: 'number', decimals: 2, separator: 0, currency: '$' } }));
  bytes = await addFormField(bytes, field('number', 'Tax', at(0.1, 0.25)));
  bytes = await addFormField(bytes, field('number', 'Total', at(0.1, 0.3), { readOnly: true }));
  bytes = await addFormField(bytes, field('date', 'Delivery', at(0.1, 0.35), { format: { kind: 'date', pattern: 'dd/mm/yyyy' } }));
  bytes = await addFormField(bytes, field('text', 'Code', at(0.5, 0.1, 0.2, 0.04), { maxLength: 5, comb: true }));
  bytes = await addFormField(bytes, field('checkbox', 'Company', at(0.5, 0.2, 0.03, 0.03)));
  bytes = await addFormField(bytes, field('text', 'VAT number', at(0.5, 0.25)));
  bytes = await addFormField(bytes, field('radio', 'Shipping', at(0.5, 0.4, 0.3, 0.12), { options: [{ value: 'std', label: 'Standard' }, { value: 'exp', label: 'Express' }, { value: 'pick', label: 'Pick up' }], selected: ['std'] }));
  bytes = await addFormField(bytes, field('dropdown', 'Country', at(0.1, 0.5), { options: [{ value: 'DE', label: 'Germany' }, { value: 'FR', label: 'France' }], selected: ['FR'] }));
  bytes = await addFormField(bytes, field('list', 'Extras', at(0.1, 0.6, 0.3, 0.1), { multiselect: true, options: [{ value: 'gift', label: 'Gift wrap' }, { value: 'ins', label: 'Insurance' }, { value: 'sig', label: 'Signature on delivery' }] }));
  bytes = await addFormField(bytes, field('signature', 'Approval', at(0.5, 0.8, 0.35, 0.08), { tooltip: 'Manager signature', required: true, lock: { action: 'include', fields: ['Total', 'Customer'] } }));
  bytes = await addFormField(bytes, field('number', 'Rate', at(0.1, 0.4), { defaultValue: '0.2' }));
  bytes = await updateFormField(bytes, 'Rate', { logic: { format: { kind: 'number', decimals: 2, separator: 0, currency: '' }, range: { min: 0, max: 1 } } });
  bytes = await updateFormField(bytes, 'Tax', { logic: { format: { kind: 'number', decimals: 2, separator: 0, currency: '$' }, calculate: { op: 'PRD', fields: ['Subtotal', 'Rate'] } } });
  bytes = await updateFormField(bytes, 'Total', { logic: { format: { kind: 'number', decimals: 2, separator: 0, currency: '$' }, calculate: { op: 'SUM', fields: ['Subtotal', 'Tax'] } } });
  bytes = await updateFormField(bytes, 'VAT number', { required: true, logic: { showWhen: { field: 'Company', value: 'Yes' }, pattern: { regex: '^[A-Z]{2}\\d{6,10}$', message: 'Use a VAT number like DE123456789.' } } });
  return bytes;
}

describe('form designer (MAL-046 – MAL-049)', () => {
  it('creates every field type with its properties, readable by PDF.js', async () => {
    const bytes = await orderForm();
    const { annotations, objects, order } = await pdfjs(bytes);
    const byName = (n: string) => annotations.filter((a) => a.fieldName === n);
    expect(byName('Customer')[0]).toMatchObject({ fieldType: 'Tx', alternativeText: 'Full name', maxLen: 40 });
    expect(byName('Customer')[0].fieldFlags & 2).toBe(2); // required
    expect(byName('Code')[0]).toMatchObject({ comb: true, maxLen: 5 });
    expect(byName('Shipping').map((a) => a.buttonValue)).toEqual(['std', 'exp', 'pick']);
    expect(byName('Shipping')[0].fieldValue).toBe('std');
    expect(byName('Country')[0].options).toEqual([{ exportValue: 'DE', displayValue: 'Germany' }, { exportValue: 'FR', displayValue: 'France' }]);
    expect(byName('Country')[0].fieldValue).toEqual(['FR']);
    expect(byName('Extras')[0]).toMatchObject({ multiSelect: true });
    expect(byName('Approval')[0]).toMatchObject({ fieldType: 'Sig', alternativeText: 'Manager signature' });
    const actions = (name: string) => Object.assign({}, ...objects[name].map((o) => (o.actions instanceof Map ? Object.fromEntries(o.actions) : o.actions ?? {})));
    expect(actions('Subtotal').Format[0]).toBe('AFNumber_Format(2, 0, 0, 0, "$", true);');
    expect(actions('Delivery').Keystroke[0]).toBe('AFDate_KeystrokeEx("dd/mm/yyyy");');
    expect(actions('Total').Calculate[0]).toBe('AFSimple_Calculate("SUM", new Array("Subtotal", "Tax"));');
    // Calculation order: the visibility rule, then Tax before Total.
    const ids = Object.fromEntries(Object.entries(objects).map(([name, list]) => [list[0].id, name]));
    expect(order!.map((id) => ids[id])).toEqual(['VAT number', 'Tax', 'Total']);
    // The signature lock is stored as a SigFieldLock.
    const pdf = await PDFDocument.load(bytes);
    const sig = pdf.getForm().getField('Approval').acroField.dict;
    expect(String(sig.lookup(PDFName.of('Lock')))).toMatch(/\/Action \/Include[\s\S]*Fields/);
    const design = await listFormDesign(bytes);
    expect(design.find((f) => f.name === 'Approval')!.lock).toEqual({ action: 'include', fields: ['Total', 'Customer'] });
    expect(design.find((f) => f.name === 'Delivery')!.kind).toBe('date');
    expect(design.find((f) => f.name === 'Shipping')!.options.map((o) => o.label)).toEqual(['Standard', 'Express', 'Pick up']);
  });

  it('places fields from the shown rectangle on rotated pages, then moves, renames and deletes them', async () => {
    let bytes = await addFormField(await blank(90), { ...field('text', 'Name', at(0.1, 0.1, 0.4, 0.05)), viewRotation: 0 });
    let [name] = await listFormDesign(bytes);
    expect(name.widgets[0].shown.x).toBeCloseTo(0.1, 2);
    expect(name.widgets[0].shown.width).toBeCloseTo(0.4, 2);
    bytes = await moveFormWidget(bytes, 'Name', name.widgets[0].ref, 1, 0, at(0.5, 0.6, 0.2, 0.05));
    [name] = await listFormDesign(bytes);
    expect(name.widgets[0].shown).toMatchObject({ x: expect.closeTo(0.5, 2), y: expect.closeTo(0.6, 2), width: expect.closeTo(0.2, 2) });
    bytes = await addFormField(bytes, field('number', 'Sum', at(0.1, 0.8)));
    bytes = await updateFormField(bytes, 'Sum', { logic: { calculate: { op: 'SUM', fields: ['Name'] } } });
    await expect(deleteFormField(bytes, 'Name')).rejects.toThrow(/Sum uses this field/);
    bytes = await renameFormField(bytes, 'Name', 'Amount');
    const design = await listFormDesign(bytes);
    expect(design.find((f) => f.name === 'Sum')!.logic.calculate!.fields).toEqual(['Amount']);
    await expect(renameFormField(bytes, 'Amount', 'Sum')).rejects.toThrow(/already exists/);
    bytes = await updateFormField(bytes, 'Sum', { logic: {} });
    bytes = await deleteFormField(bytes, 'Amount');
    const { annotations } = await pdfjs(bytes);
    expect(annotations.map((a) => a.fieldName)).toEqual(['Sum']);
  });

  it('keeps unsupported scripts, refuses cycles and signed documents', async () => {
    let bytes = await orderForm();
    await expect(updateFormField(bytes, 'Subtotal', { logic: { calculate: { op: 'SUM', fields: ['Total'] } } })).rejects.toThrow(/depends on itself/);
    const pdf = await PDFDocument.load(bytes);
    pdf.getForm().getField('Approval').acroField.dict.set(PDFName.of('V'), pdf.context.obj({ Type: 'Sig' }));
    bytes = await pdf.save();
    await expect(addFormField(bytes, field('text', 'Late'))).rejects.toThrow(/signed/);
  });
});

describe('fill, flatten and data exchange (MAL-050, MAL-052, MAL-053)', () => {
  it('fills with validation, calculation, formatting and visibility', async () => {
    const bytes = await orderForm();
    const fields = await readFillForm(bytes);
    const bad = evaluateFill(fields, { Customer: 'Ada', Subtotal: '100', Company: 'Yes', 'VAT number': 'nope', Delivery: '31/02/2026' });
    expect(bad.errors).toEqual({ 'VAT number': 'Use a VAT number like DE123456789.', Delivery: 'Delivery must be a date in the form dd/mm/yyyy.' });
    await expect(fillFormWithLogic(bytes, { Customer: 'Ada', Subtotal: '100', Company: 'Yes', 'VAT number': 'nope' })).rejects.toThrow(/VAT number like/);
    const { bytes: filled, evaluation } = await fillFormWithLogic(bytes, { Customer: 'Ada', Subtotal: '1250.5', Delivery: '03/11/2026', Shipping: 'exp', Country: 'DE', Extras: 'gift\nins', Code: 'AB12' });
    expect(evaluation.hidden).toEqual(['VAT number']);
    const { annotations } = await pdfjs(filled);
    const get = (n: string) => annotations.find((a) => a.fieldName === n)!;
    expect(get('Tax').fieldValue).toBe('250.1');
    expect(get('Total').fieldValue).toBe('1500.6');
    expect(get('Subtotal').fieldValue).toBe('1250.5');
    expect(get('VAT number').hidden).toBe(true);
    expect(get('Country').fieldValue).toEqual(['DE']);
    expect(annotations.filter((a) => a.fieldName === 'Shipping').map((a) => a.fieldValue)).toEqual(['exp', 'exp', 'exp']);
    // The formatted value is what the page shows once flattened.
    const flat = await flattenFormFields(filled, ['Subtotal', 'Rate', 'Tax', 'Total', 'Customer']);
    const after = await pdfjs(flat.bytes);
    expect(after.text).toContain('$1,250.50');
    expect(after.text).toContain('Ada');
    expect(after.text).toContain('$1,500.60');
    expect(after.annotations.some((a) => a.fieldName === 'Country')).toBe(true);
    expect(after.annotations.some((a) => a.fieldName === 'Subtotal')).toBe(false);
    expect(after.annotations.some((a) => a.fieldName === 'Customer')).toBe(false);
    await expect(flattenFormFields(filled, ['Tax'])).rejects.toThrow(/Total uses Tax/);
    const everything = await pdfjs((await flattenFormFields(filled, null)).bytes);
    expect(everything.annotations.filter((a) => a.fieldName)).toEqual([]);
    expect(everything.text).toContain('Express');
  });

  it('exports and imports CSV, JSON, FDF and XFDF', async () => {
    const { bytes: filled } = await fillFormWithLogic(await orderForm(), { Customer: 'Zoë "Z", Ltd', Subtotal: '10', Company: 'Yes', 'VAT number': 'DE123456789', Extras: 'gift\nsig', Shipping: 'pick', Country: 'DE' });
    const fields = await readFillForm(filled);
    const blankFields = await readFillForm(await orderForm());
    for (const format of ['csv', 'json', 'fdf', 'xfdf'] as const) {
      const text = exportFormData(fields, format, 'order.pdf');
      const imported = importFormData(blankFields, text, format);
      expect(imported.values, format).toMatchObject({ Customer: 'Zoë "Z", Ltd', Subtotal: '10', Company: 'Yes', 'VAT number': 'DE123456789', Extras: 'gift\nsig', Shipping: 'pick', Country: 'DE' });
      expect(imported.skipped, format).toEqual(expect.arrayContaining(['Tax', 'Total']));
      const { bytes } = await fillFormWithLogic(await orderForm(), imported.values);
      const again = await readFillForm(bytes);
      expect(again.find((f) => f.name === 'Customer')!.value, format).toBe('Zoë "Z", Ltd');
    }
    expect(exportFormData(fields, 'fdf')).toMatch(/\/T \(Company\) \/V \/Yes/);
    expect(importFormData(blankFields, 'name,value\nNope,1\nCountry,Germany\n', 'csv')).toEqual({ values: { Country: 'DE' }, unknown: ['Nope'], skipped: [] });
    expect(() => importFormData(blankFields, '{"Country":"Spain"}', 'json')).not.toThrow(); // a dropdown may hold a typed value
    expect(() => importFormData(blankFields, '{"Extras":["boat"]}', 'json')).toThrow(/not an option of Extras/);
    expect(() => importFormData(blankFields, '<!DOCTYPE x><xfdf><fields></fields></xfdf>', 'xfdf')).toThrow(/document type/);
  });
});
