/* Phase 3 "to PDF" acceptance (MAL-030 images, MAL-031 Word, MAL-032 PowerPoint, MAL-033 Excel,
 * MAL-034 HTML) in real Chromium: files are added through the Create PDF dialog, the created PDFs
 * are downloaded and reopened independently with PDF.js (page sizes, text positions, and image
 * placement replayed from the operator list), and each also opens as a MALENJO tab.
 * Run: node scripts/pdf-phase3-topdf-acceptance.mjs   (needs `playwright`)
 */
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { root, startHarness } from './lib/pdf-harness.mjs';

const h = await startHarness('PHASE3-TOPDF');
const { page, expect, check, action, notice, openPdf, download } = h;
const near = (a, b, t = 2) => Math.abs(a - b) <= t;

function crc(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; }
function png(w, hgt, rgb) {
  const raw = Buffer.alloc(hgt * (w * 3 + 1));
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) rgb.forEach((v, c) => { raw[y * (w * 3 + 1) + 1 + x * 3 + c] = v; });
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** Uncompressed RGB baseline TIFF, written independently of MALENJO's encoder. */
function tiff(w, hgt, rgb) {
  const data = Buffer.alloc(w * hgt * 3); for (let i = 0; i < w * hgt; i++) rgb.forEach((v, c) => { data[i * 3 + c] = v; });
  const tags = [[256, 3, w], [257, 3, hgt], [258, 3, 8], [259, 3, 1], [262, 3, 2], [273, 4, 8], [277, 3, 3], [278, 3, hgt], [279, 4, data.length]];
  const ifdAt = 8 + data.length; const ifd = Buffer.alloc(2 + tags.length * 12 + 4);
  ifd.writeUInt16LE(tags.length, 0);
  tags.forEach(([tag, type, value], i) => { const e = 2 + i * 12; ifd.writeUInt16LE(tag, e); ifd.writeUInt16LE(type, e + 2); ifd.writeUInt32LE(1, e + 4); if (type === 3) ifd.writeUInt16LE(value, e + 8); else ifd.writeUInt32LE(value, e + 8); });
  const head = Buffer.from([0x49, 0x49, 42, 0, 0, 0, 0, 0]); head.writeUInt32LE(ifdAt, 4);
  return Buffer.concat([head, data, ifd]);
}
const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
/** Page sizes, text (positions from the top-left) and image boxes, independently via PDF.js. */
async function inspect(bytes) {
  const loading = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: resolve(root, 'node_modules/pdfjs-dist/standard_fonts') + '/' });
  const doc = await loading.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n); const view = p.getViewport({ scale: 1 });
      const items = (await p.getTextContent()).items.filter((i) => i.str.trim()).map((i) => ({ str: i.str, x: i.transform[4], top: view.height - i.transform[5], size: Math.hypot(i.transform[2], i.transform[3]) }));
      const list = await p.getOperatorList(); let ctm = [1, 0, 0, 1, 0, 0]; const stack = []; const images = [];
      for (let i = 0; i < list.fnArray.length; i++) {
        const fn = list.fnArray[i], args = list.argsArray[i];
        if (fn === OPS.save) stack.push(ctm); else if (fn === OPS.restore) ctm = stack.pop() ?? ctm; else if (fn === OPS.transform) ctm = mul(args, ctm);
        else if (fn === OPS.paintImageXObject) images.push({ x: ctm[4], y: ctm[5], width: ctm[0], height: ctm[3] });
      }
      pages.push({ width: view.width, height: view.height, items, images, text: items.map((i) => i.str).join(' ') });
    }
    return pages;
  } finally { await loading.destroy(); }
}

const dialog = () => page.getByRole('dialog', { name: 'Create PDF from files' });
async function createFrom(mode, files, setup = async () => {}) {
  await action('Convert', 'Create PDF from files…');
  const d = dialog();
  await d.waitFor();
  await d.getByLabel('Convert from').selectOption(mode);
  await d.getByLabel('Files to convert').setInputFiles(files.map(([name, buffer]) => ({ name, mimeType: 'application/octet-stream', buffer })));
  await setup(d);
  // The created PDF opens in a new tab; the dialog and its report stay on the source tab.
  const source = (await page.locator('.document-tab-main[aria-selected="true"]').innerText()).trim().split('\n')[0];
  const before = await page.locator('.document-tab-main').count();
  await d.getByRole('button', { name: 'Create PDF', exact: true }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.document-tab-main').length > n, before, { timeout: 60000 });
  await page.locator('.document-tab-main').filter({ hasText: source }).first().click();
  await d.getByRole('region', { name: 'Creation report' }).waitFor({ timeout: 60000 });
  return d;
}
const tabFor = (name) => page.locator('.document-tab-main').filter({ hasText: name });

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

try {
  await check('MAL-030 images to PDF: several images, page size, orientation, margins and order', async () => {
    await openPdf(await (await import('pdf-lib')).PDFDocument.create().then(async (d) => { d.addPage(); return d.save(); }), 'start.pdf');
    const d = await createFrom('images', [['red.png', png(400, 200, [255, 0, 0])], ['blue.tif', tiff(100, 300, [0, 0, 255])]], async (dlg) => {
      await dlg.getByRole('button', { name: 'Move blue.tif up' }).click();
      await dlg.getByLabel('Page size').selectOption('a4');
      await dlg.getByLabel('Orientation').selectOption('auto');
      await dlg.getByLabel('Margin').fill('36');
    });
    await tabFor('blue-images.pdf').waitFor({ timeout: 30000 });
    const pages = await inspect(await download(() => d.getByRole('button', { name: 'Download' }).click()));
    expect(pages.length === 2, 'pages ' + pages.length);
    // TIFF first (portrait A4), then the wide PNG on a landscape page; each image fits inside 36 pt margins, centred.
    expect(near(pages[0].width, 595.3) && near(pages[0].height, 841.9) && near(pages[1].width, 841.9) && near(pages[1].height, 595.3), 'sizes ' + pages.map((p) => [p.width, p.height]));
    const [a, b] = [pages[0].images[0], pages[1].images[0]];
    expect(near(a.height, 841.9 - 72) && near(a.width, (841.9 - 72) / 3) && near(a.y, 36), 'tiff box ' + JSON.stringify(a));
    expect(near(b.width, 841.9 - 72) && near(b.height, (841.9 - 72) / 2) && near(b.x, 36), 'png box ' + JSON.stringify(b));
    await d.getByRole('button', { name: 'Close create PDF' }).click();
  });

  await check('MAL-031 Word to PDF: styles, lists, table and picture at the document page size', async () => {
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(`<w:document ${W}><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Annual Report</w:t></w:r></w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>Centred summary</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First step</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Second step</w:t></w:r></w:p>
        <w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>
          <w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Total</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        <w:p><w:r><w:drawing><wp:inline xmlns:wp="wp"><wp:extent cx="1270000" cy="635000"/><a:graphic xmlns:a="a"><a:graphicData><pic:pic xmlns:pic="pic"><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
        <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`),
      'word/styles.xml': strToU8(`<w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style></w:styles>`),
      'word/numbering.xml': strToU8(`<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`),
      'word/_rels/document.xml.rels': strToU8('<Relationships><Relationship Id="rId9" Type="image" Target="media/pic.png"/></Relationships>'),
      'word/media/pic.png': png(20, 10, [0, 128, 0]),
    });
    const d = await createFrom('word', [['report.docx', Buffer.from(docx)]]);
    await tabFor('report.pdf').waitFor({ timeout: 30000 });
    const [p] = await inspect(await download(() => d.getByRole('button', { name: 'Download' }).click()));
    const at = (s) => p.items.find((i) => i.str.includes(s));
    expect(near(p.width, 595.3) && near(p.height, 841.9), 'A4 from sectPr');
    expect(near(at('Annual Report').x, 72) && near(at('Annual Report').size, 20, 0.5), 'heading ' + JSON.stringify(at('Annual Report')));
    expect(at('Centred summary').x > 200 && near(at('Centred summary').size, 14, 0.5), 'centred');
    expect(/1\. First step 2\. Second step/.test(p.text) && near(at('Total').x - at('Region').x, 144), 'list/table ' + p.text);
    expect(p.images.length === 1 && near(p.images[0].width, 100) && near(p.images[0].height, 50) && near(p.images[0].x, 72), 'picture ' + JSON.stringify(p.images));
    await d.getByText(/Rendered \d+ block\(s\) on 1 page\(s\)/).waitFor();
    await d.getByRole('button', { name: 'Close create PDF' }).click();
  });

  await check('MAL-032 PowerPoint to PDF: a page per slide at the slide size with shapes, text and pictures', async () => {
    const A = 'xmlns:a="a" xmlns:p="p" xmlns:r="r"';
    const sp = (x, y, text) => `<p:sp><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="3048000" cy="762000"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FFCC00"/></a:solidFill></p:spPr><p:txBody><a:bodyPr lIns="0" tIns="0"/><a:p><a:r><a:rPr sz="2400" b="1"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
    const pptx = zipSync({
      'ppt/presentation.xml': strToU8(`<p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
      'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>'),
      'ppt/slides/slide1.xml': strToU8(`<p:sld ${A}><p:cSld><p:spTree>${sp(914400, 457200, 'Welcome')}<p:pic><p:blipFill><a:blip r:embed="rId5"/></p:blipFill><p:spPr><a:xfrm><a:off x="5486400" y="2286000"/><a:ext cx="1270000" cy="635000"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`),
      'ppt/slides/_rels/slide1.xml.rels': strToU8('<Relationships><Relationship Id="rId5" Target="../media/a.png"/></Relationships>'),
      'ppt/slides/slide2.xml': strToU8(`<p:sld ${A}><p:cSld><p:spTree>${sp(0, 0, 'Thank you')}</p:spTree></p:cSld></p:sld>`),
      'ppt/media/a.png': png(4, 2, [0, 0, 255]),
    });
    const d = await createFrom('powerpoint', [['deck.pptx', Buffer.from(pptx)]]);
    await tabFor('deck.pdf').waitFor({ timeout: 30000 });
    const pages = await inspect(await download(() => d.getByRole('button', { name: 'Download' }).click()));
    expect(pages.length === 2 && pages.every((p) => near(p.width, 720) && near(p.height, 405)), 'slide size');
    const welcome = pages[0].items.find((i) => i.str === 'Welcome');
    expect(welcome && near(welcome.x, 72) && near(welcome.size, 24, 0.5) && welcome.top > 36 && welcome.top < 70, 'text box ' + JSON.stringify(welcome));
    expect(pages[0].images.length === 1 && near(pages[0].images[0].x, 432) && near(pages[0].images[0].y, 405 - 180 - 50), 'picture ' + JSON.stringify(pages[0].images));
    expect(pages[1].text === 'Thank you', 'slide 2');
    await d.getByRole('button', { name: 'Close create PDF' }).click();
  });

  await check('MAL-033 Excel to PDF: the print area with formats, widths, merges, gridlines and orientation', async () => {
    const S = 'xmlns="m" xmlns:r="r"';
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Sales!$A$1:$B$3</definedName></definedNames></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>Region</t></si><si><t>Amount</t></si><si><t>North</t></si><si><t>Outside print area</t></si></sst>'),
      'xl/styles.xml': strToU8('<styleSheet><numFmts><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts><font><sz val="11"/></font><font><b/><sz val="11"/></font></fonts><fills><fill/><fill/></fills><cellXfs><xf numFmtId="0" fontId="0"/><xf numFmtId="0" fontId="1"/><xf numFmtId="164" fontId="0"/></cellXfs></styleSheet>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><cols><col min="1" max="1" width="20"/><col min="2" max="2" width="12"/></cols><sheetData>
        <row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="B1" t="s" s="1"><v>1</v></c><c r="C1" t="s"><v>3</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="2"><v>1234.5</v></c></row>
        <row r="3"><c r="A3" t="inlineStr"><is><t>Total merged</t></is></c></row></sheetData>
        <mergeCells><mergeCell ref="A3:B3"/></mergeCells><printOptions gridLines="1"/><pageSetup orientation="landscape"/></worksheet>`),
    });
    const d = await createFrom('excel', [['sales.xlsx', Buffer.from(xlsx)]], async (dlg) => { await dlg.getByLabel('Page size').selectOption('letter'); });
    await tabFor('sales.pdf').waitFor({ timeout: 30000 });
    const [p] = await inspect(await download(() => d.getByRole('button', { name: 'Download' }).click()));
    expect(near(p.width, 792) && near(p.height, 612), 'landscape from the sheet');
    expect(p.text === 'Region Amount North $1,234.50 Total merged', 'print area/format ' + p.text);
    const amount = p.items.find((i) => i.str === '$1,234.50'), region = p.items.find((i) => i.str === 'Region');
    expect(near(region.x, 38) && amount.x > 36 + 105, 'column widths / right-aligned numbers');
    await d.getByText(/Print areas used: Sales/).waitFor();
    await d.getByRole('button', { name: 'Close create PDF' }).click();
  });

  await check('MAL-034 HTML to PDF through the controlled renderer: supported CSS applied, scripts and remote content blocked', async () => {
    const img = `data:image/png;base64,${png(8, 4, [255, 0, 0]).toString('base64')}`;
    const html = `<!doctype html><html><head><style>.lead{color:#0000ff;font-size:18px} h1{text-align:center} .box{float:left}</style>
      <script>document.write('INJECTED')</script></head><body>
      <h1>Report Title</h1><p class="lead">Lead paragraph</p><p style="text-align:right">Right side</p>
      <ul><li>Alpha</li><li>Beta</li></ul><table border="1"><tr><th>Name</th><th>Qty</th></tr><tr><td>Pens</td><td>12</td></tr></table>
      <img src="${img}" width="80"><img src="https://example.invalid/tracker.png"><iframe src="https://example.invalid"></iframe>
      <p style="page-break-before:always">Next page</p></body></html>`;
    let requested = false;
    page.on('request', (r) => { if (r.url().includes('example.invalid')) requested = true; });
    const d = await createFrom('html', [['page.html', Buffer.from(html)]], async (dlg) => { await dlg.getByLabel('Page size').selectOption('a4'); await dlg.getByLabel('Margin').fill('36'); });
    await tabFor('page.pdf').waitFor({ timeout: 30000 });
    const pages = await inspect(await download(() => d.getByRole('button', { name: 'Download' }).click()));
    const [p] = pages; const at = (s) => p.items.find((i) => i.str === s);
    expect(pages.length === 2 && pages[1].text === 'Next page', 'page break');
    expect(!p.text.includes('INJECTED') && !requested, 'script ran or remote content fetched');
    expect(near(at('Report Title').size, 24, 0.5) && at('Report Title').x > 200, 'centred heading');
    expect(near(at('Lead paragraph').size, 13.5, 0.6) && at('Right side').x > 450, 'css classes/inline style');
    expect(/• Alpha • Beta Name Qty Pens 12/.test(p.text) && p.images.length === 1 && near(p.images[0].width, 60), 'list/table/image ' + p.text);
    const report = await d.getByRole('region', { name: 'Creation report' }).innerText();
    expect(/CSS not applied: float/.test(report) && /web addresses were not downloaded/.test(report) && /<iframe>/.test(report) && /<script>/.test(report), 'report ' + JSON.stringify(report));
  });
} finally {
  await h.finish();
}
