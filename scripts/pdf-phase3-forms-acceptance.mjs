/* Phase 3 forms acceptance (MAL-046 designer, MAL-047 text/number/date, MAL-048 choices,
 * MAL-049 signature placeholders, MAL-050 logic, MAL-052 fill/save/flatten, MAL-053 data
 * exchange) in real Chromium: fields are placed and moved with real mouse drags, filled in
 * the panel, and every saved file is reopened independently with PDF.js and pdf-lib.
 * Run: node scripts/pdf-phase3-forms-acceptance.mjs   (needs `playwright`)
 */
import { resolve } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { root, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE3-FORMS');
const { page, panel, expect, check, action, notice, openPdf, save, download } = h;
const near = (a, b, t = 4) => Math.abs(a - b) <= t;

async function source() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText('Order form', { x: 50, y: 770, size: 14, font: await pdf.embedFont(StandardFonts.Helvetica) });
  return pdf.save();
}
/** Fields (PDF.js annotations and field objects with their actions), calculation order and page text. */
async function inspect(bytes) {
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' });
  const doc = await loading.promise;
  try {
    const p = await doc.getPage(1);
    const annotations = (await p.getAnnotations()).filter((a) => a.fieldName);
    const found = await doc.getFieldObjects();
    const objects = found instanceof Map ? Object.fromEntries(found) : found ?? {};
    const ids = Object.fromEntries(Object.entries(objects).map(([name, list]) => [list[0].id, name]));
    const actions = (name) => Object.assign({}, ...(objects[name] ?? []).map((o) => (o.actions instanceof Map ? Object.fromEntries(o.actions) : o.actions ?? {})));
    const text = (await p.getTextContent()).items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
    return { annotations, actions, order: ((await doc.getCalculationOrderIds()) ?? []).map((id) => ids[id]), text, field: (name) => annotations.filter((a) => a.fieldName === name) };
  } finally { await loading.destroy(); }
}
const canvasBox = () => panel().locator('[id$="-page-1"] canvas').first().boundingBox();
async function drag(from, to) {
  // The page is taller than the window: scroll the dragged span to the middle of the view first.
  await page.evaluate((fy) => {
    const canvas = document.querySelector('.document-session-panel.active [id$="-page-1"] canvas');
    const rect = canvas.getBoundingClientRect();
    let scroller = canvas.parentElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) scroller = scroller.parentElement;
    if (scroller) scroller.scrollTo({ top: scroller.scrollTop + rect.top + fy * rect.height - window.innerHeight / 2, behavior: 'instant' });
  }, (from[1] + to[1]) / 2);
  await page.waitForTimeout(150);
  const box = await canvasBox();
  await page.mouse.move(box.x + from[0] * box.width, box.y + from[1] * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0] * box.width, box.y + to[1] * box.height, { steps: 8 });
  await page.mouse.up();
}
const designer = () => page.getByRole('dialog', { name: 'Form designer' });
const filler = () => page.getByRole('dialog', { name: 'Fill form' });
/** The fill panel's input for a field (its row label starts with the field name). */
const input = (name) => filler().locator('.pdf-form-fill-row').filter({ has: page.locator('label', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}(?: \\(|$)`) }) }).locator('input,select').first();
const listed = (name) => designer().getByLabel('Selected form field').locator(`option[value="${name}"]`).waitFor({ state: 'attached', timeout: 30000 });
async function place(kind, name, from, to, extra = async () => {}) {
  const tools = designer();
  await tools.getByLabel('New field type').selectOption(kind);
  await tools.getByLabel('New field name').fill(name);
  await extra(tools);
  await tools.getByRole('button', { name: 'Place on the page' }).click();
  await drag(from, to);
  await notice(new RegExp(`Added the ${kind} field ${name}`));
  await listed(name);
}
async function select(name) {
  await designer().getByLabel('Selected form field').selectOption(name);
  await designer().locator('fieldset legend').filter({ hasText: new RegExp(`^${name}$`) }).waitFor();
}
async function applyField(name) {
  await designer().getByRole('button', { name: 'Apply to field' }).click();
  await notice(new RegExp(`Updated the field ${name}`));
}
const W = 612, H = 792;
const rectOf = (a) => a.rect.map((v) => Math.round(v * 10) / 10);
/** The signature lock as pdf-lib reads it: action and field names. */
async function lockOf(bytes) {
  const lock = (await PDFDocument.load(bytes)).getForm().getField('Approval').acroField.dict.lookup(PDFName.of('Lock'), PDFDict);
  return { action: lock.lookup(PDFName.of('Action'), PDFName).decodeText(), fields: lock.lookup(PDFName.of('Fields'), PDFArray).asArray().map((v) => v.decodeText()) };
}
let blankForm = null;

try {
  await check('MAL-046 design by dragging fields onto the page, select on the page, move, rename and delete', async () => {
    await openPdf(await source(), 'forms-design.pdf');
    await action('Forms', 'Design form…');
    await designer().waitFor();
    await place('text', 'Customer', [0.08, 0.10], [0.40, 0.14], async (t) => {
      await t.getByLabel('New field tooltip').fill('Full name');
      await t.getByText('Required', { exact: true }).first().click();
      await t.getByLabel('New field maximum length').fill('40');
    });
    await place('text', 'Temp', [0.36, 0.50], [0.55, 0.53]);
    // Select the field by clicking its outline on the page, then drag it to a new place.
    await panel().getByRole('button', { name: 'Select field: Customer' }).click();
    expect(await designer().getByLabel('Selected form field').inputValue() === 'Customer', 'page selection did not select Customer');
    await designer().getByRole('button', { name: 'Move or resize by dragging' }).click();
    await drag([0.08, 0.04], [0.45, 0.08]);
    await notice(/Moved the field Customer/);
    await listed('Customer');
    await select('Temp');
    await designer().getByRole('button', { name: 'Delete field' }).click();
    await notice(/Deleted the field Temp/);
    const out = await inspect(await save());
    const [customer] = out.field('Customer');
    expect(customer && near(customer.rect[0], 0.08 * W) && near(customer.rect[2], 0.45 * W) && near(customer.rect[3], (1 - 0.04) * H) && near(customer.rect[1], (1 - 0.08) * H), 'moved rect ' + rectOf(customer ?? { rect: [] }));
    expect(!out.field('Temp').length, 'Temp not deleted');
  });

  await check('MAL-047 text, number and date fields with required, length, comb and format rules', async () => {
    await place('text', 'Code', [0.36, 0.10], [0.55, 0.14], async (t) => { await t.getByLabel('New field maximum length').fill('5'); await t.getByText('Comb (one box per character)').click(); });
    await place('number', 'Subtotal', [0.08, 0.18], [0.30, 0.22], async (t) => { await t.getByLabel('New field currency').fill('$'); });
    await place('number', 'Rate', [0.08, 0.24], [0.30, 0.28], async (t) => { await t.getByLabel('New field currency').fill(''); });
    await place('number', 'Tax', [0.08, 0.30], [0.30, 0.34], async (t) => { await t.getByLabel('New field currency').fill('$'); });
    await place('number', 'Total', [0.08, 0.36], [0.30, 0.40], async (t) => { await t.getByLabel('New field currency').fill('$'); });
    await place('date', 'Delivery', [0.08, 0.42], [0.30, 0.46], async (t) => { await t.getByLabel('New field date format').selectOption('dd/mm/yyyy'); });
    await select('Rate');
    await designer().getByLabel('Field minimum', { exact: true }).fill('0');
    await designer().getByLabel('Field maximum', { exact: true }).fill('1');
    await applyField('Rate');
    const out = await inspect(await save());
    const [customer] = out.field('Customer'), [code] = out.field('Code');
    expect(customer.fieldType === 'Tx' && customer.alternativeText === 'Full name' && customer.maxLen === 40 && (customer.fieldFlags & 2) === 2, 'Customer properties ' + JSON.stringify({ t: customer.alternativeText, m: customer.maxLen, f: customer.fieldFlags }));
    expect(code.comb === true && code.maxLen === 5, 'Code comb');
    expect(out.actions('Subtotal').Format?.[0] === 'AFNumber_Format(2, 0, 0, 0, "$", true);' && out.actions('Subtotal').Keystroke?.[0] === 'AFNumber_Keystroke(2, 0, 0, 0, "$", true);', 'number format ' + JSON.stringify(out.actions('Subtotal')));
    expect(out.actions('Delivery').Format?.[0] === 'AFDate_FormatEx("dd/mm/yyyy");', 'date format');
    expect(out.actions('Rate').Validate?.[0] === 'AFRange_Validate(true, 0, true, 1);', 'range ' + JSON.stringify(out.actions('Rate')));
  });

  await check('MAL-048 check box, radio group, dropdown and list box with export values and labels', async () => {
    await place('checkbox', 'Company', [0.36, 0.18], [0.40, 0.21]);
    await place('text', 'VAT number', [0.36, 0.24], [0.55, 0.28]);
    await place('radio', 'Shipping', [0.36, 0.30], [0.55, 0.42], async (t) => { await t.getByLabel('New field options').fill('std | Standard\nexp | Express\npick | Pick up'); await t.getByLabel('New field default selection').fill('std'); });
    await place('dropdown', 'Country', [0.08, 0.50], [0.30, 0.54], async (t) => { await t.getByLabel('New field options').fill('DE | Germany\nFR | France'); await t.getByLabel('New field default selection').fill('FR'); });
    await place('list', 'Extras', [0.08, 0.56], [0.30, 0.66], async (t) => {
      await t.getByLabel('New field options').fill('gift | Gift wrap\nins | Insurance\nsig | Signature on delivery'); await t.getByLabel('New field default selection').fill('');
      await t.getByText('Allow several selections').click();
    });
    const out = await inspect(await save());
    expect(out.field('Company')[0]?.checkBox === true, 'check box');
    expect(JSON.stringify(out.field('Shipping').map((a) => a.buttonValue)) === '["std","exp","pick"]' && out.field('Shipping')[0].fieldValue === 'std', 'radio ' + JSON.stringify(out.field('Shipping').map((a) => [a.buttonValue, a.fieldValue])));
    const [country] = out.field('Country'), [extras] = out.field('Extras');
    expect(JSON.stringify(country.options) === JSON.stringify([{ exportValue: 'DE', displayValue: 'Germany' }, { exportValue: 'FR', displayValue: 'France' }]) && JSON.stringify(country.fieldValue) === '["FR"]', 'dropdown ' + JSON.stringify([country.options, country.fieldValue]));
    expect(extras.multiSelect === true && extras.options.length === 3 && extras.combo === false, 'list box');
  });

  await check('MAL-049 signature placeholder with tooltip, required flag and locked fields', async () => {
    await place('signature', 'Approval', [0.30, 0.75], [0.55, 0.82], async (t) => {
      await t.getByLabel('New field tooltip').fill('Manager signature');
      await t.getByLabel('New signature locks').selectOption('include');
      const group = t.getByRole('group', { name: 'Fields the new signature locks' });
      await group.getByLabel('Total', { exact: true }).check(); await group.getByLabel('Customer', { exact: true }).check();
    });
    const bytes = await save();
    const [sig] = (await inspect(bytes)).field('Approval');
    expect(sig?.fieldType === 'Sig' && sig.alternativeText === 'Manager signature' && near(sig.rect[0], 0.30 * W) && near(sig.rect[1], 0.18 * H), 'signature ' + JSON.stringify(sig && [sig.fieldType, sig.alternativeText, sig.rect]));
    const lock = await lockOf(bytes);
    expect(lock.action === 'Include' && JSON.stringify(lock.fields) === '["Total","Customer"]', 'lock ' + JSON.stringify(lock));
  });

  await check('MAL-050 calculations, dependencies, visibility and validation, evaluated without running document scripts', async () => {
    await select('Tax');
    await designer().getByLabel('Field calculation').selectOption('PRD');
    const uses = designer().getByRole('group', { name: 'Fields the calculation uses' });
    await uses.getByLabel('Subtotal', { exact: true }).check(); await uses.getByLabel('Rate', { exact: true }).check();
    await applyField('Tax');
    await select('Total');
    await designer().getByLabel('Field calculation').selectOption('SUM');
    await uses.getByLabel('Subtotal', { exact: true }).check(); await uses.getByLabel('Tax', { exact: true }).check();
    await designer().getByText('Read-only', { exact: true }).last().click();
    await applyField('Total');
    await select('VAT number');
    await designer().getByLabel('Field shown when').selectOption('Company');
    await designer().getByLabel('Field shown when value').fill('Yes');
    await designer().getByLabel('Field pattern', { exact: true }).fill('^[A-Z]{2}\\d{6,10}$');
    await designer().getByLabel('Field pattern message').fill('Use a VAT number like DE123456789.');
    await applyField('VAT number');
    // Renaming a field others depend on updates their calculations and the signature lock.
    await select('Subtotal');
    await designer().getByLabel('Field name', { exact: true }).fill('Net amount');
    await designer().getByRole('button', { name: 'Rename' }).click();
    await notice(/Renamed Subtotal to Net amount/);
    await listed('Net amount');
    await select('Customer');
    await designer().getByLabel('Field name', { exact: true }).fill('Client');
    await designer().getByRole('button', { name: 'Rename' }).click();
    await notice(/Renamed Customer to Client/);
    await listed('Client');
    blankForm = await save();
    const out = await inspect(blankForm);
    expect(out.actions('Total').Calculate?.[0] === 'AFSimple_Calculate("SUM", new Array("Net amount", "Tax"));', 'Total calc ' + JSON.stringify(out.actions('Total')));
    expect(out.actions('Tax').Calculate?.[0] === 'AFSimple_Calculate("PRD", new Array("Net amount", "Rate"));', 'Tax calc');
    expect(/display\.hidden/.test(out.actions('VAT number').Calculate?.[0] ?? '') && /new RegExp/.test(out.actions('VAT number').Validate?.[0] ?? ''), 'visibility/pattern');
    expect(JSON.stringify(out.order) === '["Tax","Total","VAT number"]', 'calculation order ' + JSON.stringify(out.order));
    const lock = await lockOf(blankForm);
    expect(JSON.stringify(lock.fields) === '["Total","Client"]', 'lock not renamed ' + JSON.stringify(lock));
    await designer().getByRole('button', { name: 'Close form designer' }).click();

    // Fill: live calculation, hidden field, validation messages block saving.
    await action('Forms', 'Fill form…');
    const f = filler();
    await f.waitFor();
    await input('Client').fill('Ada Lovelace');
    await input('Net amount').fill('1250.5');
    await input('Rate').fill('1.5');
    await f.getByText('Rate must be between 0 and 1.').waitFor();
    expect(await f.getByRole('button', { name: 'Save values' }).isDisabled(), 'save allowed with errors');
    await input('Rate').fill('0.2');
    expect(await input('Total').inputValue() === '$1,500.60', 'live total ' + await input('Total').inputValue());
    await filler().locator('label', { hasText: 'VAT number (hidden by a rule)' }).waitFor();
    await input('Company').check();
    await input('VAT number').fill('nope');
    await f.getByText('Use a VAT number like DE123456789.').waitFor();
    await input('VAT number').fill('DE123456789');
    await input('Delivery').fill('31/02/2026');
    await f.getByText('Delivery must be a date in the form dd/mm/yyyy.').waitFor();
    await input('Delivery').fill('03/11/2026');
    expect(await f.getByRole('button', { name: 'Save values' }).isEnabled(), 'save still blocked');
  });

  await check('MAL-052 fill and save values, then flatten selected fields and all fields', async () => {
    const f = filler();
    await input('Shipping').selectOption('exp');
    await input('Country').selectOption('DE');
    await input('Extras').selectOption(['gift', 'ins']);
    await f.getByRole('button', { name: 'Save values' }).click();
    await notice(/Saved the form values/);
    let out = await inspect(await save());
    const value = (n) => out.field(n)[0]?.fieldValue;
    expect(value('Client') === 'Ada Lovelace' && value('Net amount') === '1250.5' && value('Tax') === '250.1' && value('Total') === '1500.6', 'values ' + JSON.stringify(['Client', 'Net amount', 'Tax', 'Total'].map(value)));
    expect(value('Company') === 'Yes' && out.field('VAT number')[0].hidden === false && value('Delivery') === '03/11/2026', 'company/vat/date');
    expect(out.field('Shipping').every((a) => a.fieldValue === 'exp') && JSON.stringify(value('Country')) === '["DE"]' && JSON.stringify(value('Extras')) === '["gift","ins"]', 'choices ' + JSON.stringify([value('Shipping'), value('Country'), value('Extras')]));
    // Unticking Company hides the VAT number field in the saved file.
    await input('Company').uncheck();
    await f.getByRole('button', { name: 'Save values' }).click();
    await notice(/Hidden by rules: VAT number/);
    out = await inspect(await save());
    expect(out.field('VAT number')[0].hidden === true, 'VAT not hidden');
    // Flatten two chosen fields, then everything.
    const group = f.getByRole('group', { name: 'Fields to flatten' });
    await group.getByLabel('Client', { exact: true }).check(); await group.getByLabel('Delivery', { exact: true }).check();
    await f.getByRole('button', { name: 'Flatten selected' }).click();
    await notice(/Flattened Client, Delivery into the page/);
    out = await inspect(await save());
    expect(!out.field('Client').length && !out.field('Delivery').length && out.field('Total').length === 1, 'selected flatten');
    expect(out.text.includes('Ada Lovelace') && out.text.includes('03/11/2026'), 'flattened text missing: ' + out.text);
    await f.getByRole('button', { name: 'Flatten all fields' }).click();
    await notice(/Flattened all \d+ field\(s\) into the page/);
    out = await inspect(await save());
    expect(!out.annotations.length, 'fields left after flatten');
    expect(['$1,250.50', '$250.10', '$1,500.60', 'Express', 'Germany'].every((t) => out.text.includes(t)), 'flattened values: ' + out.text);
    await f.getByRole('button', { name: 'Close fill form' }).click();
  });

  await check('MAL-053 export and import CSV, JSON, FDF and XFDF', async () => {
    expect(blankForm, 'no designed form');
    // Fill a copy and export each format from the panel.
    await openPdf(blankForm, 'forms-data.pdf');
    await action('Forms', 'Fill form…');
    let f = filler();
    await input('Client').fill('Zoë "Z", Ltd');
    await input('Net amount').fill('10');
    await input('Rate').fill('0.5');
    await input('Company').check();
    await input('VAT number').fill('FR12345678');
    await input('Shipping').selectOption('pick');
    await input('Extras').selectOption(['gift', 'sig']);
    const files = {};
    for (const format of ['csv', 'json', 'fdf', 'xfdf']) {
      await f.getByLabel('Form data format').selectOption(format);
      files[format] = await download(() => f.getByRole('button', { name: 'Export data' }).click());
    }
    const json = JSON.parse(files.json.toString('utf8'));
    expect(json.Client === 'Zoë "Z", Ltd' && json.Total === '15' && json.Company === 'Yes' && JSON.stringify(json.Extras) === '["gift","sig"]' && json.Shipping === 'pick', 'json ' + files.json);
    expect(files.csv.toString('utf8').startsWith('name,value\r\n') && files.csv.toString('utf8').includes('Client,"Zoë ""Z"", Ltd"') && /Extras,gift\r\nExtras,sig/.test(files.csv.toString('utf8')), 'csv ' + files.csv);
    expect(files.fdf.subarray(0, 8).toString('latin1') === '%FDF-1.2' && files.fdf.toString('latin1').includes('/T (Company) /V /Yes') && files.fdf.toString('latin1').includes('/T (Extras) /V [(gift) (sig)]'), 'fdf ' + files.fdf.toString('latin1').slice(0, 400));
    expect(/<field name="Client"><value>Zoë &quot;Z&quot;, Ltd<\/value><\/field>/.test(files.xfdf.toString('utf8')) && files.xfdf.toString('utf8').includes('xmlns="http://ns.adobe.com/xfdf/"'), 'xfdf');
    // Import each file into a fresh copy of the empty form and save.
    for (const format of ['csv', 'json', 'fdf', 'xfdf']) {
      await openPdf(blankForm, `forms-import-${format}.pdf`);
      await action('Forms', 'Fill form…');
      f = filler();
      await f.getByLabel('Form data file').setInputFiles({ name: `order-data.${format}`, mimeType: 'application/octet-stream', buffer: files[format] });
      await f.getByText(/Imported \d+ value\(s\) from order-data/).waitFor();
      await f.getByRole('button', { name: 'Save values' }).click();
      await notice(/Saved the form values/);
      const out = await inspect(await save());
      const value = (n) => out.field(n)[0]?.fieldValue;
      expect(value('Client') === 'Zoë "Z", Ltd' && value('Net amount') === '10' && value('Total') === '15' && value('VAT number') === 'FR12345678' && value('Company') === 'Yes'
        && out.field('Shipping').every((a) => a.fieldValue === 'pick') && JSON.stringify(value('Extras')) === '["gift","sig"]', `${format} import ` + JSON.stringify(['Client', 'Net amount', 'Total', 'VAT number', 'Company', 'Extras'].map(value)));
      await f.getByRole('button', { name: 'Close fill form' }).click();
    }
  });
} finally {
  await h.finish();
}
