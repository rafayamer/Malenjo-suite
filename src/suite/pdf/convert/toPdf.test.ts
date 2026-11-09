import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { encodePng, encodeTiff } from './imageCodecs';
import { imagesToPdf } from './imagesToPdf';
import { decodeTiff } from './tiffDecode';
import { docxToPdf } from './docxToPdf';
import { pptxToPdf } from './pptxToPdf';
import { xlsxToPdf } from './xlsxToPdf';
import { htmlToPdf } from './htmlToPdf';

/** Page sizes and text items (with positions from the top-left) via PDF.js. */
async function read(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice() });
  const doc = await loading.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n); const view = page.getViewport({ scale: 1 });
      const items = ((await page.getTextContent()).items as { str: string; transform: number[]; fontName: string }[]).filter((i) => i.str.trim())
        .map((i) => ({ str: i.str, x: Math.round(i.transform[4]), top: Math.round(view.height - i.transform[5]), size: Math.round(Math.hypot(i.transform[2], i.transform[3])) }));
      pages.push({ width: Math.round(view.width), height: Math.round(view.height), items, text: items.map((i) => i.str).join(' ') });
    }
    return pages;
  } finally { await loading.destroy(); }
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const rgba = (w: number, h: number, c: number[]) => ({ width: w, height: h, data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => c[i % 4]) });

describe('images to PDF (MAL-030)', () => {
  it('places PNG and every TIFF page in order with page size, orientation, margins and fit', async () => {
    const png = encodePng(rgba(400, 200, [255, 0, 0, 255]));
    const tiff = encodeTiff([rgba(100, 300, [0, 0, 255, 255]), rgba(50, 50, [0, 255, 0, 255])], { dpi: 96, compression: 'deflate' });
    expect(decodeTiff(tiff).map((p) => [p.width, p.height, ...p.data.slice(0, 3)])).toEqual([[100, 300, 0, 0, 255], [50, 50, 0, 255, 0]]);
    const result = await imagesToPdf([{ name: 'b.tif', bytes: tiff }, { name: 'a.png', bytes: png }], { pageSize: 'a4', orientation: 'auto', margin: 36, fit: 'fit' });
    const pages = await read(result.bytes);
    expect(pages.map((p) => [p.width, p.height])).toEqual([[595, 842], [595, 842], [842, 595]]);
    expect(result.notes).toContain('b.tif: all 2 TIFF pages were added.');
    const actual = await imagesToPdf([{ name: 'a.png', bytes: png }], { pageSize: 'image', orientation: 'portrait', margin: 10, fit: 'actual' });
    expect((await read(actual.bytes)).map((p) => [p.width, p.height])).toEqual([[320, 170]]);
    await expect(imagesToPdf([{ name: 'x.gif', bytes: strToU8('GIF89a') }], { pageSize: 'a4', orientation: 'auto', margin: 0, fit: 'fit' })).rejects.toThrow(/not a JPG, PNG or TIFF/);
  });
});

describe('Word to PDF (MAL-031)', () => {
  it('renders styles, lists, tables and pictures at the section page size', async () => {
    const png = encodePng(rgba(20, 10, [0, 128, 0, 255]));
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(`<w:document ${W}><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Annual Report</w:t></w:r></w:p>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FF0000"/><w:sz w:val="28"/></w:rPr><w:t>Centred bold red</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First step</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Second step</w:t></w:r></w:p>
        <w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>
          <w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Total</w:t></w:r></w:p></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        <w:p><w:r><w:drawing><wp:inline xmlns:wp="wp"><wp:extent cx="1270000" cy="635000"/><a:graphic xmlns:a="a"><a:graphicData><pic:pic xmlns:pic="pic"><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
        <w:p><w:r><w:br w:type="page"/><w:t>Second page</w:t></w:r></w:p>
        <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`),
      'word/styles.xml': strToU8(`<w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style></w:styles>`),
      'word/numbering.xml': strToU8(`<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`),
      'word/_rels/document.xml.rels': strToU8('<Relationships><Relationship Id="rId9" Type="image" Target="media/pic.png"/></Relationships>'),
      'word/media/pic.png': png,
    });
    const result = await docxToPdf(docx);
    const pages = await read(result.bytes);
    expect(pages.map((p) => [p.width, p.height])).toEqual([[595, 842], [595, 842]]);
    const [p1] = pages;
    const at = (s: string) => p1.items.find((i) => i.str.includes(s))!;
    expect(at('Annual Report')).toMatchObject({ x: 72, size: 20 });
    // Centred between the 72 pt margins.
    const centred = at('Centred bold red');
    expect(centred.x).toBeGreaterThan(200); expect(centred.x).toBeLessThan(300);
    expect(p1.text).toMatch(/1\. First step 2\. Second step/);
    expect(at('Total').x - at('Name').x).toBe(144);
    expect(pages[1].text).toBe('Second page');
    expect(result.notes[0]).toMatch(/2 page\(s\)/);
  });
});

describe('PowerPoint to PDF (MAL-032)', () => {
  it('draws each slide with its shapes, text boxes and pictures at the slide size', async () => {
    const A = 'xmlns:a="a" xmlns:p="p" xmlns:r="r"';
    const sp = (x: number, y: number, text: string, extra = '') => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="3048000" cy="762000"/></a:xfrm><a:prstGeom prst="rect"/>${extra}</p:spPr><p:txBody><a:bodyPr lIns="0" tIns="0"/><a:p><a:r><a:rPr sz="2400" b="1"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
    const pptx = zipSync({
      'ppt/presentation.xml': strToU8(`<p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
      'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>'),
      'ppt/slides/slide1.xml': strToU8(`<p:sld ${A}><p:cSld><p:spTree>${sp(914400, 457200, 'Welcome', '<a:solidFill><a:srgbClr val="FFCC00"/></a:solidFill>')}<p:pic><p:blipFill><a:blip r:embed="rId5"/></p:blipFill><p:spPr><a:xfrm><a:off x="5486400" y="2286000"/><a:ext cx="1270000" cy="635000"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`),
      'ppt/slides/_rels/slide1.xml.rels': strToU8('<Relationships><Relationship Id="rId5" Target="../media/a.png"/></Relationships>'),
      'ppt/slides/slide2.xml': strToU8(`<p:sld ${A}><p:cSld><p:spTree>${sp(0, 0, 'Second slide')}</p:spTree></p:cSld></p:sld>`),
      'ppt/media/a.png': encodePng(rgba(4, 2, [0, 0, 255, 255])),
    });
    const result = await pptxToPdf(pptx);
    const pages = await read(result.bytes);
    expect(pages.map((p) => [p.width, p.height])).toEqual([[720, 405], [720, 405]]);
    expect(pages[0].items[0]).toMatchObject({ str: 'Welcome', x: 72, size: 24 });
    expect(pages[0].items[0].top).toBeGreaterThan(36); expect(pages[0].items[0].top).toBeLessThan(70);
    expect(pages[1].text).toBe('Second slide');
  });
});

describe('Excel to PDF (MAL-033)', () => {
  it('prints the print area with widths, formats, merges and gridlines', async () => {
    const S = 'xmlns="m" xmlns:r="r"';
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Sales!$A$1:$B$3</definedName></definedNames></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>Region</t></si><si><t>Amount</t></si><si><t>North</t></si><si><t>Hidden column</t></si></sst>'),
      'xl/styles.xml': strToU8('<styleSheet><numFmts><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts><font><sz val="11"/></font><font><b/><sz val="11"/></font></fonts><fills><fill/><fill/></fills><cellXfs><xf numFmtId="0" fontId="0"/><xf numFmtId="0" fontId="1"/><xf numFmtId="164" fontId="0"/></cellXfs></styleSheet>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><cols><col min="1" max="1" width="20"/><col min="2" max="2" width="12"/></cols><sheetData>
        <row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="B1" t="s" s="1"><v>1</v></c><c r="C1" t="s"><v>3</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="2"><v>1234.5</v></c></row>
        <row r="3"><c r="A3" t="inlineStr"><is><t>Total merged</t></is></c></row></sheetData>
        <mergeCells><mergeCell ref="A3:B3"/></mergeCells><printOptions gridLines="1"/><pageSetup orientation="landscape"/></worksheet>`),
    });
    const result = await xlsxToPdf(xlsx, { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' });
    const [page] = await read(result.bytes);
    expect([page.width, page.height]).toEqual([792, 612]);
    expect(page.text).toBe('Region Amount North $1,234.50 Total merged');
    const amount = page.items.find((i) => i.str === '$1,234.50')!, region = page.items.find((i) => i.str === 'Region')!;
    expect(region.x).toBe(38);
    expect(amount.x).toBeGreaterThan(36 + 105); // right-aligned in column B
    expect(result.notes).toContain('Print areas used: Sales ($A$1:$B$3).');
  });
});

describe('HTML to PDF (MAL-034)', () => {
  it('renders supported HTML and CSS, never running scripts or fetching, and reports the rest', async () => {
    const img = `data:image/png;base64,${btoa(String.fromCharCode(...encodePng(rgba(8, 4, [255, 0, 0, 255]))))}`;
    const html = `<!doctype html><html><head><style>.lead{color:#0000ff;font-size:18px} h1{text-align:center} div > p{color:red} .box{float:left}</style>
      <script>document.write('evil')</script></head><body>
      <h1>Report Title</h1><p class="lead">Lead paragraph</p><p style="text-align:right">Right side</p>
      <ul><li>Alpha</li><li>Beta</li></ul><ol start="3"><li>Third</li></ol>
      <table border="1"><tr><th>Name</th><th>Qty</th></tr><tr><td>Pens</td><td>12</td></tr></table>
      <img src="${img}" width="80"><img src="https://example.com/x.png"><iframe src="x"></iframe>
      <p style="page-break-before:always">Next page</p></body></html>`;
    const result = await htmlToPdf(html, { pageSize: 'a4', landscape: false, margin: 36 });
    const pages = await read(result.bytes);
    expect(pages).toHaveLength(2);
    const [p1] = pages; const at = (s: string) => p1.items.find((i) => i.str === s)!;
    expect(p1.text).not.toContain('evil');
    expect(at('Report Title').size).toBe(24);
    expect(at('Report Title').x).toBeGreaterThan(200);
    expect(at('Lead paragraph').size).toBe(14);
    expect(at('Right side').x).toBeGreaterThan(450);
    expect(p1.text).toMatch(/• Alpha • Beta 3\. Third Name Qty Pens 12/);
    expect(pages[1].text).toBe('Next page');
    expect(result.notes.join(' ')).toMatch(/CSS not applied: float/);
    expect(result.notes.join(' ')).toMatch(/1 CSS selector\(s\) beyond/);
    expect(result.notes.join(' ')).toMatch(/1 <script> element\(s\) were not run\..*Left out: 1 <iframe>/);
    expect(result.notes.join(' ')).toMatch(/1 image\(s\) from web addresses were not downloaded/);
  });

describe('conversion edge cases', () => {
  const S = 'xmlns="m" xmlns:r="r"';
  const book = (sheet: string) => zipSync({
    'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}>${sheet}</worksheet>`),
  });
  const options = { pageSize: 'letter' as const, orientation: 'sheet' as const, gridlines: 'sheet' as const, sheets: 'all' as const };

  it('finishes a number in a column too narrow for one #, and skips hidden rows without a height', async () => {
    const narrow = book('<cols><col min="1" max="1" width="0.5"/></cols><sheetData><row r="1"><c r="A1"><v>123456</v></c><c r="B1" t="inlineStr"><is><t>Next</t></is></c></row></sheetData>');
    const [page] = await read((await xlsxToPdf(narrow, options)).bytes);
    expect(page.text).toBe('Next');
    const hidden = book('<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Shown</t></is></c></row><row r="2" hidden="1"><c r="A2" t="inlineStr"><is><t>Secret</t></is></c></row></sheetData>');
    const [shown] = await read((await xlsxToPdf(hidden, options)).bytes);
    expect(shown.text).toBe('Shown');
  });

  it('ignores a > inside a quoted HTML attribute', async () => {
    const [page] = await read((await htmlToPdf('<p title="a > b">Hello world</p>', { pageSize: 'a4', landscape: false, margin: 36 })).bytes);
    expect(page.text).toBe('Hello world');
  });
});

describe('conversion edge cases, round 2', () => {
  const S = 'xmlns="m" xmlns:r="r"';
  const options = { pageSize: 'letter' as const, orientation: 'sheet' as const, gridlines: 'sheet' as const, sheets: 'all' as const };
  const book = (sheet: string, names = '', numFmts = '') => zipSync({
    'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets>${names}</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/styles.xml': strToU8(`<styleSheet>${numFmts}<fonts><font><sz val="11"/></font></fonts><fills><fill/></fills><cellXfs><xf numFmtId="0" fontId="0"/><xf numFmtId="20" fontId="0"/><xf numFmtId="164" fontId="0"/></cellXfs></styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><cols><col min="1" max="2" width="20"/></cols>${sheet}</worksheet>`),
  });

  it('keeps times in built-in and custom date-time formats', async () => {
    const xlsx = book('<sheetData><row r="1"><c r="A1" s="1"><v>0.5</v></c><c r="B1" s="2"><v>45000.75</v></c></row></sheetData>', '',
      '<numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>');
    const [page] = await read((await xlsxToPdf(xlsx, options)).bytes);
    expect(page.text).toBe('12:00 2023-03-15 18:00');
  });

  it('prints every row of a whole-column print area', async () => {
    const rows = [1, 2, 3].map((r) => `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>Row ${r}</t></is></c><c r="C${r}" t="inlineStr"><is><t>Outside ${r}</t></is></c></row>`).join('');
    const xlsx = book(`<sheetData>${rows}</sheetData>`, '<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">S!$A:$B</definedName></definedNames>');
    const [page] = await read((await xlsxToPdf(xlsx, options)).bytes);
    expect(page.text).toBe('Row 1 Row 2 Row 3');
  });

  it('flows a table row taller than a page across pages instead of cutting it off', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `<p>Line ${i + 1}</p>`).join('');
    const result = await htmlToPdf(`<table><tr><td>${lines}</td></tr></table>`, { pageSize: 'letter', landscape: false, margin: 72 });
    const pages = await read(result.bytes);
    const text = pages.map((p) => p.text).join(' ');
    expect(pages.length).toBeGreaterThan(1);
    expect(text).toContain('Line 1 ');
    expect(text).toContain('Line 100');
    expect(result.notes.join(' ')).toMatch(/1 table row\(s\) taller than a page/);
  });
});

describe('conversion edge cases, round 3', () => {
  it('leaves hidden HTML table rows and cells out', async () => {
    const html = '<table><tr><td>Shown</td><td style="display:none">Hidden cell</td></tr><tr hidden><td>Hidden row</td></tr><tbody style="display:none"><tr><td>Hidden group</td></tr></tbody></table>';
    const [page] = await read((await htmlToPdf(html, { pageSize: 'a4', landscape: false, margin: 36 })).bytes);
    expect(page.text).toBe('Shown');
  });

  it('reads dates in the 1904 date system', async () => {
    const S = 'xmlns="m" xmlns:r="r"';
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${S}><workbookPr date1904="1"/><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/styles.xml': strToU8('<styleSheet><fonts><font><sz val="11"/></font></fonts><fills><fill/></fills><cellXfs><xf numFmtId="0" fontId="0"/><xf numFmtId="14" fontId="0"/></cellXfs></styleSheet>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><cols><col min="1" max="1" width="20"/></cols><sheetData><row r="1"><c r="A1" s="1"><v>1</v></c></row></sheetData></worksheet>`),
    });
    const [page] = await read((await xlsxToPdf(xlsx, { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' })).bytes);
    expect(page.text).toBe('1904-01-02');
  });

  it('gives outputs with the same name distinct names', async () => {
    const { uniqueNames } = await import('./imagesToPdf');
    const name = uniqueNames();
    expect([name('report.pdf'), name('report.pdf'), name('Report.pdf'), name('other.pdf')]).toEqual(['report.pdf', 'report (2).pdf', 'Report (3).pdf', 'other.pdf']);
  });
});

describe('conversion edge cases, round 4', () => {
  it('draws a picture placed inside a Word table cell', async () => {
    const pic = '<w:p><w:r><w:drawing><wp:inline xmlns:wp="wp"><wp:extent cx="1270000" cy="635000"/><a:graphic xmlns:a="a"><a:graphicData><pic:pic xmlns:pic="pic"><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    const docx = zipSync({
      'word/document.xml': strToU8(`<w:document ${W}><w:body><w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${pic}</w:tc></w:tr></w:tbl></w:body></w:document>`),
      'word/_rels/document.xml.rels': strToU8('<Relationships><Relationship Id="rId9" Type="image" Target="media/pic.png"/></Relationships>'),
      'word/media/pic.png': encodePng(rgba(20, 10, [0, 128, 0, 255])),
    });
    const result = await docxToPdf(docx);
    const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
    const pdf = await PDFDocument.load(result.bytes);
    const xobjects = pdf.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    expect(xobjects?.keys().length ?? 0).toBe(1);
  });

  it('keeps every significant digit of General-format numbers', async () => {
    const S = 'xmlns="m" xmlns:r="r"';
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><cols><col min="1" max="2" width="30"/></cols><sheetData><row r="1"><c r="A1"><v>0.000000000001</v></c><c r="B1"><v>1.23456789012345</v></c></row></sheetData></worksheet>`),
    });
    const [page] = await read((await xlsxToPdf(xlsx, { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' })).bytes);
    expect(page.text).toBe('1E-12 1.23456789012345');
  });
});

describe('conversion edge cases, round 5', () => {
  it('keeps indentation and blank lines in preformatted HTML', async () => {
    const html = '<pre>def f():\n    return 1\n\nx = 2</pre>';
    const [page] = await read((await htmlToPdf(html, { pageSize: 'a4', landscape: false, margin: 36 })).bytes);
    const at = (s: string) => page.items.find((i) => i.str === s)!;
    const [def, ret, x] = [at('def'), at('return'), at('x')];
    expect(ret.x - def.x).toBeGreaterThan(20); // four spaces of indentation kept
    expect(x.x).toBe(def.x);
    const step = ret.top - def.top;
    expect(x.top - ret.top).toBeGreaterThan(1.5 * step); // the blank line is kept
  });

  it('reads 1900-system dates before March 1900 on the right day', async () => {
    const S = 'xmlns="m" xmlns:r="r"';
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/styles.xml': strToU8('<styleSheet><fonts><font><sz val="11"/></font></fonts><fills><fill/></fills><cellXfs><xf numFmtId="0" fontId="0"/><xf numFmtId="14" fontId="0"/></cellXfs></styleSheet>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><cols><col min="1" max="3" width="20"/></cols><sheetData><row r="1"><c r="A1" s="1"><v>1</v></c><c r="B1" s="1"><v>59</v></c><c r="C1" s="1"><v>61</v></c></row></sheetData></worksheet>`),
    });
    const [page] = await read((await xlsxToPdf(xlsx, { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' })).bytes);
    expect(page.text).toBe('1900-01-01 1900-02-28 1900-03-01');
  });
});

describe('conversion edge cases, round 6', () => {
  it('paints a block background behind its text', async () => {
    const result = await htmlToPdf('<p style="color:white;background-color:black">Visible on black</p>', { pageSize: 'a4', landscape: false, margin: 36 });
    const { PDFDocument } = await import('pdf-lib');
    const { pageContentBytes } = await import('../content/contentModel');
    const content = new TextDecoder('latin1').decode(pageContentBytes(await PDFDocument.load(result.bytes), 0));
    // The black fill is painted first, then the white text over it.
    expect(content).toMatch(/0 0 0 rg[\s\S]*?\nf\n[\s\S]*?BT\n1 1 1 rg/);
  });

  it('prints every range of a multi-range print area', async () => {
    const S = 'xmlns="m" xmlns:r="r"';
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">S!$A$1:$A$1,S!$C$1:$C$1</definedName></definedNames></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>First</t></is></c><c r="B1" t="inlineStr"><is><t>Between</t></is></c><c r="C1" t="inlineStr"><is><t>Last</t></is></c></row></sheetData></worksheet>`),
    });
    const result = await xlsxToPdf(xlsx, { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' });
    expect((await read(result.bytes)).map((p) => p.text)).toEqual(['First', 'Last']);
  });
});

describe('conversion edge cases, round 7', () => {
  it('draws a data image inside an HTML table cell', async () => {
    const img = `data:image/png;base64,${btoa(String.fromCharCode(...encodePng(rgba(8, 4, [255, 0, 0, 255]))))}`;
    const result = await htmlToPdf(`<table><tr><td><img src="${img}" width="40"></td></tr></table>`, { pageSize: 'a4', landscape: false, margin: 36 });
    const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length ?? 0).toBe(1);
  });

  it('prints a merged heading across its whole range', async () => {
    const S = 'xmlns="m" xmlns:r="r"';
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><cols><col min="1" max="3" width="6"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Quarterly heading</t></is></c></row></sheetData><mergeCells><mergeCell ref="A1:C1"/></mergeCells></worksheet>`),
    });
    const [page] = await read((await xlsxToPdf(xlsx, { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' })).bytes);
    expect(page.text).toBe('Quarterly heading');
  });

  it('refuses a TIFF with more pages than it decodes', () => {
    const tiny = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
    const many = encodeTiff(Array.from({ length: 501 }, () => tiny), { dpi: 72, compression: 'none' });
    expect(() => decodeTiff(many)).toThrow(/more than 500 pages/);
  });
});
});

describe('conversion edge cases, round 8', () => {
  it('closes both the cell and the row when an HTML row starts without closing tags', async () => {
    const [page] = await read((await htmlToPdf('<table><tr><td>Alpha<td>Beta<tr><td>Gamma<td>Delta</table>', { pageSize: 'a4', landscape: false, margin: 36 })).bytes);
    expect(page.text).toBe('Alpha Beta Gamma Delta');
    const alpha = page.items.find((i) => i.str === 'Alpha')!, gamma = page.items.find((i) => i.str === 'Gamma')!;
    expect(gamma.x).toBe(alpha.x); expect(gamma.top).toBeGreaterThan(alpha.top);
  });

  it('reports worksheet cells beyond the conversion limits', async () => {
    const S = 'xmlns="m" xmlns:r="r"';
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Kept</t></is></c></row><row r="20002"><c r="A20002"><v>7</v></c></row></sheetData></worksheet>`),
    });
    const result = await xlsxToPdf(xlsx, { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' });
    expect(result.notes.join(' ')).toMatch(/Not printed: 1 cell\(s\) beyond row 20000/);
  });

  it('applies a PowerPoint paragraph’s default run properties', async () => {
    const A = 'xmlns:a="a" xmlns:p="p" xmlns:r="r"';
    const pptx = zipSync({
      'ppt/presentation.xml': strToU8(`<p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
      'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>'),
      'ppt/slides/slide1.xml': strToU8(`<p:sld ${A}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="1524000"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr><a:defRPr sz="3000" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr><a:r><a:t>White on black</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`),
    });
    const result = await pptxToPdf(pptx);
    const [page] = await read(result.bytes);
    expect(page.items[0]).toMatchObject({ str: 'White on black', size: 30 });
    const { PDFDocument } = await import('pdf-lib');
    const { pageContentBytes } = await import('../content/contentModel');
    expect(new TextDecoder('latin1').decode(pageContentBytes(await PDFDocument.load(result.bytes), 0))).toMatch(/BT\n1 1 1 rg/);
  });
});

describe('conversion edge cases, round 9', () => {
  const S = 'xmlns="m" xmlns:r="r"';
  const book = (sheetName: string, sheet: string, extra = '', styles = '') => zipSync({
    'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>${extra}</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><sheetData>${sheet}</sheetData></worksheet>`),
    ...(styles ? { 'xl/styles.xml': strToU8(styles) } : {}),
  });
  const options = { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' } as const;

  it('rounds to optional decimal places and trims only their trailing zeros', async () => {
    const styles = '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="#,##0.##"/><numFmt numFmtId="165" formatCode="0.0#"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';
    const row = (r: number, a: string, b: string) => `<row r="${r}"><c r="A${r}" s="1"><v>${a}</v></c><c r="B${r}" s="2"><v>${b}</v></c></row>`;
    const [page] = await read((await xlsxToPdf(book('S', row(1, '1234.567', '1234.567') + row(2, '1234.5', '1234.5') + row(3, '7', '7'), '', styles), options)).bytes);
    expect(page.items.map((i) => i.str)).toEqual(['1,234.57', '1234.57', '1,234.5', '1234.5', '7.', '7.0']);
  });

  it('keeps a quoted sheet name with a comma whole when reading the print area', async () => {
    const names = `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'A,B'!$C$1:$C$1</definedName></definedNames>`;
    const result = await xlsxToPdf(book('A,B', '<row r="1"><c r="A1" t="inlineStr"><is><t>Outside</t></is></c><c r="C1" t="inlineStr"><is><t>Inside</t></is></c></row>', names), options);
    expect((await read(result.bytes)).map((p) => p.text)).toEqual(['Inside']);
  });
});

describe('conversion edge cases, round 10', () => {
  it('looks up one-bit palette TIFF pixels in the colour map', () => {
    // A 2×1 uncompressed TIFF: index 0 is red and index 1 is blue.
    const entries: [number, number, number][] = [[256, 3, 2], [257, 3, 1], [258, 3, 1], [259, 3, 1], [262, 3, 3], [273, 4, 0], [277, 3, 1], [278, 3, 1], [279, 4, 1], [320, 3, 0]];
    const ifd = 8, mapAt = ifd + 2 + entries.length * 12 + 4, stripAt = mapAt + 12;
    const bytes = new Uint8Array(stripAt + 1); const v = new DataView(bytes.buffer);
    bytes.set([0x49, 0x49]); v.setUint16(2, 42, true); v.setUint32(4, ifd, true); v.setUint16(ifd, entries.length, true);
    entries.forEach(([tag, type, value], i) => {
      const e = ifd + 2 + i * 12;
      v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, tag === 320 ? 6 : 1, true);
      if (tag === 320) v.setUint32(e + 8, mapAt, true); else if (tag === 273) v.setUint32(e + 8, stripAt, true); else if (type === 3) v.setUint16(e + 8, value, true); else v.setUint32(e + 8, value, true);
    });
    [65535, 0, 0, 0, 0, 65535].forEach((c, k) => v.setUint16(mapAt + k * 2, c, true)); // red: 1, 0; green: 0, 0; blue: 0, 1
    bytes[stripAt] = 0b01000000;
    const [page] = decodeTiff(bytes);
    expect([...page.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it('prints nothing from an HTML body hidden by display:none', async () => {
    const result = await htmlToPdf('<body style="display:none"><p>Hidden body content</p></body>', { pageSize: 'a4', landscape: false, margin: 36 });
    expect((await read(result.bytes)).map((p) => p.text).join('')).toBe('');
  });

  it('bounds a sheet-sized merged range by the conversion limits', async () => {
    const S = 'xmlns="m" xmlns:r="r"';
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Merged</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Below</t></is></c></row></sheetData><mergeCells><mergeCell ref="B5:XFD1048576"/><mergeCell ref="A1:B1"/></mergeCells></worksheet>`),
    });
    const started = Date.now();
    const result = await xlsxToPdf(xlsx, { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' });
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await read(result.bytes))[0].text).toBe('Merged Below');
  }, 20000);
});

describe('conversion edge cases, round 11', () => {
  it('leaves out an HTML picture hidden by its own attribute or style', async () => {
    const img = `data:image/png;base64,${btoa(String.fromCharCode(...encodePng(rgba(8, 4, [255, 0, 0, 255]))))}`;
    const result = await htmlToPdf(`<p>Text<img hidden src="${img}"><img style="display:none" src="${img}"></p>`, { pageSize: 'a4', landscape: false, margin: 36 });
    const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length ?? 0).toBe(0);
  });

  it('turns premultiplied TIFF alpha into straight alpha', () => {
    // A 1×1 RGBA TIFF with associated alpha: half-transparent red is stored as 128, 0, 0, 128.
    const entries: [number, number, number, number][] = [[256, 3, 1, 1], [257, 3, 1, 1], [258, 3, 4, 0], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 0], [277, 3, 1, 4], [278, 3, 1, 1], [279, 4, 1, 4], [338, 3, 1, 1]];
    const ifd = 8, bpsAt = ifd + 2 + entries.length * 12 + 4, stripAt = bpsAt + 8;
    const bytes = new Uint8Array(stripAt + 4); const v = new DataView(bytes.buffer);
    bytes.set([0x49, 0x49]); v.setUint16(2, 42, true); v.setUint32(4, ifd, true); v.setUint16(ifd, entries.length, true);
    entries.forEach(([tag, type, count, value], i) => {
      const e = ifd + 2 + i * 12;
      v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, count, true);
      if (tag === 258) v.setUint32(e + 8, bpsAt, true); else if (tag === 273) v.setUint32(e + 8, stripAt, true); else if (type === 3) v.setUint16(e + 8, value, true); else v.setUint32(e + 8, value, true);
    });
    for (let k = 0; k < 4; k++) v.setUint16(bpsAt + k * 2, 8, true);
    bytes.set([128, 0, 0, 128], stripAt);
    expect([...decodeTiff(bytes)[0].data]).toEqual([255, 0, 0, 128]);
  });
});

describe('conversion edge cases, round 12', () => {
  it('turns a TIFF page by its Orientation tag', () => {
    // A 2×1 grey TIFF (10, 200) with Orientation 6: shown turned a quarter clockwise, 1×2 with 10 on top.
    const entries: [number, number, number][] = [[256, 3, 2], [257, 3, 1], [258, 3, 8], [259, 3, 1], [262, 3, 1], [273, 4, 0], [274, 3, 6], [277, 3, 1], [278, 3, 1], [279, 4, 2]];
    const ifd = 8, stripAt = ifd + 2 + entries.length * 12 + 4;
    const bytes = new Uint8Array(stripAt + 2); const v = new DataView(bytes.buffer);
    bytes.set([0x49, 0x49]); v.setUint16(2, 42, true); v.setUint32(4, ifd, true); v.setUint16(ifd, entries.length, true);
    entries.forEach(([tag, type, value], i) => {
      const e = ifd + 2 + i * 12;
      v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, 1, true);
      if (tag === 273) v.setUint32(e + 8, stripAt, true); else if (type === 3) v.setUint16(e + 8, value, true); else v.setUint32(e + 8, value, true);
    });
    bytes.set([10, 200], stripAt);
    const [page] = decodeTiff(bytes);
    expect([page.width, page.height, page.data[0], page.data[4]]).toEqual([1, 2, 10, 200]);
  });

  it('carries a table row’s colour and background into its cells', async () => {
    const result = await htmlToPdf('<table style="color:white"><tr style="background-color:black"><td>Visible on black</td></tr></table>', { pageSize: 'a4', landscape: false, margin: 36 });
    const { PDFDocument } = await import('pdf-lib');
    const { pageContentBytes } = await import('../content/contentModel');
    const content = new TextDecoder('latin1').decode(pageContentBytes(await PDFDocument.load(result.bytes), 0));
    expect(content).toMatch(/0 0 0 rg[\s\S]*?\nf\n[\s\S]*?BT\n1 1 1 rg/);
  });
});

describe('conversion edge cases, round 13', () => {
  it('bounds HTML column spans as browsers do and refuses tables wider than that', async () => {
    const started = Date.now();
    const [page] = await read((await htmlToPdf('<table><tr><td colspan="1000000000">Hello</td></tr></table>', { pageSize: 'a4', landscape: false, margin: 36 })).bytes);
    expect(page.text).toBe('Hello');
    expect(Date.now() - started).toBeLessThan(5000);
    await expect(htmlToPdf('<table><tr><td colspan="1000">A</td><td colspan="1000">B</td></tr></table>', { pageSize: 'a4', landscape: false, margin: 36 })).rejects.toThrow(/more than 1000 columns/);
  }, 20000);

  it('numbers a list item on the same line as the paragraph inside it', async () => {
    const [page] = await read((await htmlToPdf('<ol><li><p>First</p></li><li><p>Second</p></li></ol>', { pageSize: 'a4', landscape: false, margin: 36 })).bytes);
    // Each marker is drawn with its item's text, on one line each: no separate marker-only lines.
    expect(page.items.map((i) => i.str)).toEqual(['1. First', '2. Second']);
  });

  it('reads one-bit TIFF samples stored least significant bit first', () => {
    // An 8×1 TIFF, white is one, FillOrder 2: the byte 0x01 is the first pixel white.
    const entries: [number, number, number][] = [[256, 3, 8], [257, 3, 1], [258, 3, 1], [259, 3, 1], [262, 3, 1], [266, 3, 2], [273, 4, 0], [277, 3, 1], [278, 3, 1], [279, 4, 1]];
    const ifd = 8, stripAt = ifd + 2 + entries.length * 12 + 4;
    const bytes = new Uint8Array(stripAt + 1); const v = new DataView(bytes.buffer);
    bytes.set([0x49, 0x49]); v.setUint16(2, 42, true); v.setUint32(4, ifd, true); v.setUint16(ifd, entries.length, true);
    entries.forEach(([tag, type, value], i) => {
      const e = ifd + 2 + i * 12;
      v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, 1, true);
      if (tag === 273) v.setUint32(e + 8, stripAt, true); else if (type === 3) v.setUint16(e + 8, value, true); else v.setUint32(e + 8, value, true);
    });
    bytes[stripAt] = 0x01;
    const [page] = decodeTiff(bytes);
    expect(Array.from({ length: 8 }, (_, k) => page.data[k * 4])).toEqual([255, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('conversion edge cases, round 14', () => {
  it('bounds Word table spans and refuses tables wider than 1000 columns', async () => {
    const docx = (cells: string) => zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(`<w:document ${W}><w:body><w:tbl><w:tr>${cells}</w:tr></w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`),
    });
    const cell = (span: string, text: string) => `<w:tc><w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const started = Date.now();
    const [page] = await read((await docxToPdf(docx(cell('1000000000', 'Hello')))).bytes);
    expect(page.text).toBe('Hello');
    expect(Date.now() - started).toBeLessThan(5000);
    await expect(docxToPdf(docx(cell('1000', 'A') + cell('1000', 'B')))).rejects.toThrow(/more than 1000 columns/);
  }, 20000);

  it('resolves worksheet theme colours, with their tint', async () => {
    const S = 'xmlns="m" xmlns:r="r"';
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="theme/theme1.xml"/></Relationships>'),
      'xl/theme/theme1.xml': strToU8('<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1></a:clrScheme></a:themeElements></a:theme>'),
      'xl/styles.xml': strToU8('<styleSheet><fonts><font><sz val="11"/></font><font><sz val="11"/><color theme="0"/></font><font><sz val="11"/><color theme="1" tint="0.5"/></font></fonts><fills><fill/><fill/><fill><patternFill patternType="solid"><fgColor rgb="FF000000"/></patternFill></fill></fills><cellXfs><xf fontId="0" fillId="0"/><xf fontId="1" fillId="2"/><xf fontId="2" fillId="0"/></cellXfs></styleSheet>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><sheetData><row r="1"><c r="A1" s="1" t="inlineStr"><is><t>White on black</t></is></c><c r="B1" s="2" t="inlineStr"><is><t>Grey</t></is></c></row></sheetData></worksheet>`),
    });
    const result = await xlsxToPdf(xlsx, { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' });
    const { PDFDocument } = await import('pdf-lib');
    const { pageContentBytes } = await import('../content/contentModel');
    const content = new TextDecoder('latin1').decode(pageContentBytes(await PDFDocument.load(result.bytes), 0));
    expect(content).toMatch(/0 0 0 rg[\s\S]*?\nf\n[\s\S]*?BT\n1 1 1 rg/);
    expect(content).toMatch(/BT\n0\.5 0\.5 0\.5 rg/); // black lightened by half
  });
});

describe('conversion edge cases, round 15', () => {
  it('refuses TIFF sample counts outside the colour model before allocating', () => {
    // A 1000×1000 grey TIFF header claiming 1024 samples per pixel (over 1 GB decoded), with no image data.
    const entries: [number, number, number][] = [[256, 3, 1000], [257, 3, 1000], [258, 3, 8], [259, 3, 1], [262, 3, 1], [273, 4, 0], [277, 3, 1024], [278, 3, 1000], [279, 4, 0]];
    const ifd = 8; const bytes = new Uint8Array(ifd + 2 + entries.length * 12 + 4); const v = new DataView(bytes.buffer);
    bytes.set([0x49, 0x49]); v.setUint16(2, 42, true); v.setUint32(4, ifd, true); v.setUint16(ifd, entries.length, true);
    entries.forEach(([tag, type, value], i) => {
      const e = ifd + 2 + i * 12;
      v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, 1, true);
      if (type === 3) v.setUint16(e + 8, value, true); else v.setUint32(e + 8, value, true);
    });
    expect(() => decodeTiff(bytes)).toThrow(/1024 samples per pixel/);
  });

  it('prints blank worksheet cells that have a fill', async () => {
    const S = 'xmlns="m" xmlns:r="r"';
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/styles.xml': strToU8('<styleSheet><fonts><font><sz val="11"/></font></fonts><fills><fill/><fill/><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill></fills><cellXfs><xf fontId="0" fillId="0"/><xf fontId="0" fillId="2"/></cellXfs></styleSheet>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}><sheetData><row r="1"><c r="A1" s="1"/></row></sheetData></worksheet>`),
    });
    const result = await xlsxToPdf(xlsx, { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' });
    const { PDFDocument } = await import('pdf-lib');
    const { pageContentBytes } = await import('../content/contentModel');
    expect(new TextDecoder('latin1').decode(pageContentBytes(await PDFDocument.load(result.bytes), 0))).toMatch(/1 0 0 rg[\s\S]*?\nf\n/);
  });

  it('crops a PowerPoint picture by its source rectangle', async () => {
    const A = 'xmlns:a="a" xmlns:p="p" xmlns:r="r"';
    const pptx = zipSync({
      'ppt/presentation.xml': strToU8(`<p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
      'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>'),
      'ppt/slides/slide1.xml': strToU8(`<p:sld ${A}><p:cSld><p:spTree><p:pic><p:blipFill><a:blip r:embed="rId5"/><a:srcRect l="50000"/></p:blipFill><p:spPr><a:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="1270000" cy="635000"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`),
      'ppt/slides/_rels/slide1.xml.rels': strToU8('<Relationships><Relationship Id="rId5" Target="../media/a.png"/></Relationships>'),
      'ppt/media/a.png': encodePng(rgba(4, 2, [0, 0, 255, 255])),
    });
    const result = await pptxToPdf(pptx);
    const { PDFDocument } = await import('pdf-lib');
    const { pageContentBytes } = await import('../content/contentModel');
    const content = new TextDecoder('latin1').decode(pageContentBytes(await PDFDocument.load(result.bytes), 0));
    // Clipped to the 100 × 50 pt box at (100, 255); the whole picture is drawn 200 pt wide, starting 100 pt to the left.
    expect(content).toMatch(/100 255 100 50 re\s+W\s+n\s+q\s+1 0 0 1 0 255 cm[\s\S]*?200 0 0 50 0 0 cm/);
  });
});

describe('conversion edge cases, round 16', () => {
  const tiff = (entries: [number, number, number][], strip: number[]) => {
    const ifd = 8, stripAt = ifd + 2 + entries.length * 12 + 4;
    const bytes = new Uint8Array(stripAt + strip.length); const v = new DataView(bytes.buffer);
    bytes.set([0x49, 0x49]); v.setUint16(2, 42, true); v.setUint32(4, ifd, true); v.setUint16(ifd, entries.length, true);
    entries.forEach(([tag, type, value], i) => {
      const e = ifd + 2 + i * 12;
      v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, 1, true);
      if (tag === 273) v.setUint32(e + 8, stripAt, true); else if (tag === 279) v.setUint32(e + 8, strip.length, true); else if (type === 3) v.setUint16(e + 8, value, true); else v.setUint32(e + 8, value, true);
    });
    bytes.set(strip, stripAt);
    return bytes;
  };

  it('refuses one-bit TIFF colour', () => {
    // 1×1 RGB with one bit per sample (bits 100: red).
    const entries: [number, number, number][] = [[256, 3, 1], [257, 3, 1], [258, 3, 1], [259, 3, 1], [262, 3, 2], [273, 4, 0], [277, 3, 3], [278, 3, 1], [279, 4, 0]];
    expect(() => decodeTiff(tiff(entries, [0b10000000]))).toThrow(/One-bit TIFF images with several samples/);
  });

  it('keeps a normal line height for empty Word paragraphs', async () => {
    const docx = (blanks: number) => zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(`<w:document ${W}><w:body><w:p><w:r><w:t>Top</w:t></w:r></w:p>${'<w:p/>'.repeat(blanks)}<w:p><w:r><w:t>Bottom</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`),
    });
    const gap = async (blanks: number) => { const [page] = await read((await docxToPdf(docx(blanks))).bytes); const at = (s: string) => page.items.find((i) => i.str === s)!.top; return at('Bottom') - at('Top'); };
    // Three empty paragraphs add about three lines of 11 pt text (12.65 pt each), not three points.
    expect((await gap(3)) - (await gap(0))).toBeGreaterThan(3 * 12);
  });
});

describe('conversion edge cases, round 17', () => {
  const S = 'xmlns="m" xmlns:r="r"';
  const book = (sheet: string, styles = '', cols = '') => zipSync({
    'xl/workbook.xml': strToU8(`<workbook ${S}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${S}>${cols}<sheetData>${sheet}</sheetData></worksheet>`),
    ...(styles ? { 'xl/styles.xml': strToU8(styles) } : {}),
  });
  const options = { pageSize: 'letter', orientation: 'sheet', gridlines: 'sheet', sheets: 'all' } as const;

  it('divides by a thousand for each scaling comma and keeps the quoted suffix', async () => {
    const styles = '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="0.0,&quot; thousand&quot;"/><numFmt numFmtId="165" formatCode="#,##0,,&quot;M&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';
    const [page] = await read((await xlsxToPdf(book('<row r="1"><c r="A1" s="1"><v>1234</v></c><c r="B1" s="2"><v>2500000000</v></c></row>', styles, '<cols><col min="1" max="2" width="20"/></cols>'), options)).bytes);
    expect(page.items.map((i) => i.str)).toEqual(['1.2 thousand', '2,500M']);
  });

  it('hides rows and columns marked hidden="true"', async () => {
    const sheet = '<row r="1"><c r="A1" t="inlineStr"><is><t>Shown</t></is></c><c r="B1" t="inlineStr"><is><t>Hidden column</t></is></c></row><row r="2" hidden="true"><c r="A2" t="inlineStr"><is><t>Hidden row</t></is></c></row>';
    const [page] = await read((await xlsxToPdf(book(sheet, '', '<cols><col min="2" max="2" hidden="true"/></cols>'), options)).bytes);
    expect(page.text).toBe('Shown');
  });

  it('inherits line-height from a containing element', async () => {
    const gap = async (html: string) => { const [page] = await read((await htmlToPdf(html, { pageSize: 'a4', landscape: false, margin: 36 })).bytes); const at = (s: string) => page.items.find((i) => i.str === s)!.top; return at('Second') - at('First'); };
    const inherited = await gap('<body style="line-height:2"><p>First<br>Second</p></body>');
    expect(inherited).toBe(await gap('<body><p style="line-height:2">First<br>Second</p></body>'));
    expect(inherited).toBeGreaterThan(await gap('<body><p>First<br>Second</p></body>'));
  });

  it('reports shapes inherited from a slide layout or master', async () => {
    const A = 'xmlns:a="a" xmlns:p="p" xmlns:r="r"';
    const sp = (text: string) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
    const pptx = zipSync({
      'ppt/presentation.xml': strToU8(`<p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
      'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>'),
      'ppt/slides/slide1.xml': strToU8(`<p:sld ${A}><p:cSld><p:spTree>${sp('Slide text')}</p:spTree></p:cSld></p:sld>`),
      'ppt/slides/_rels/slide1.xml.rels': strToU8('<Relationships><Relationship Id="rL" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'),
      'ppt/slideLayouts/slideLayout1.xml': strToU8(`<p:sldLayout ${A}><p:cSld><p:spTree>${sp('Layout text')}</p:spTree></p:cSld></p:sldLayout>`),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': strToU8('<Relationships><Relationship Id="rM" Target="../slideMasters/slideMaster1.xml"/></Relationships>'),
      'ppt/slideMasters/slideMaster1.xml': strToU8(`<p:sldMaster ${A}><p:cSld><p:spTree>${sp('Master text')}</p:spTree></p:cSld></p:sldMaster>`),
    });
    const result = await pptxToPdf(pptx);
    expect(result.notes.join(' ')).toMatch(/Not rendered: 2 shape\(s\) inherited from slide layouts or masters/);
  });
});

describe('conversion edge cases, round 18', () => {
  it('resolves theme colours from each slide’s own master', async () => {
    const A = 'xmlns:a="a" xmlns:p="p" xmlns:r="r"';
    const theme = (accent: string) => strToU8(`<a:theme ${A}><a:themeElements><a:clrScheme name="t"><a:accent1><a:srgbClr val="${accent}"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`);
    const slide = `<p:sld ${A}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="1524000"/></a:xfrm><a:solidFill><a:srgbClr val="000000"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2000"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr><a:t>Accent text</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const pptx = zipSync({
      'ppt/presentation.xml': strToU8(`<p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`),
      'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>'),
      'ppt/slides/slide1.xml': strToU8(slide), 'ppt/slides/slide2.xml': strToU8(slide),
      'ppt/slides/_rels/slide1.xml.rels': strToU8('<Relationships><Relationship Id="rL" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'),
      'ppt/slides/_rels/slide2.xml.rels': strToU8('<Relationships><Relationship Id="rL" Target="../slideLayouts/slideLayout2.xml"/></Relationships>'),
      'ppt/slideLayouts/slideLayout1.xml': strToU8(`<p:sldLayout ${A}/>`), 'ppt/slideLayouts/slideLayout2.xml': strToU8(`<p:sldLayout ${A}/>`),
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels': strToU8('<Relationships><Relationship Id="rM" Target="../slideMasters/slideMaster1.xml"/></Relationships>'),
      'ppt/slideLayouts/_rels/slideLayout2.xml.rels': strToU8('<Relationships><Relationship Id="rM" Target="../slideMasters/slideMaster2.xml"/></Relationships>'),
      'ppt/slideMasters/slideMaster1.xml': strToU8(`<p:sldMaster ${A}/>`), 'ppt/slideMasters/slideMaster2.xml': strToU8(`<p:sldMaster ${A}/>`),
      'ppt/slideMasters/_rels/slideMaster1.xml.rels': strToU8('<Relationships><Relationship Id="rT" Target="../theme/theme1.xml"/></Relationships>'),
      'ppt/slideMasters/_rels/slideMaster2.xml.rels': strToU8('<Relationships><Relationship Id="rT" Target="../theme/theme2.xml"/></Relationships>'),
      'ppt/theme/theme1.xml': theme('FF0000'), 'ppt/theme/theme2.xml': theme('FFFFFF'),
    });
    const result = await pptxToPdf(pptx);
    const { PDFDocument } = await import('pdf-lib');
    const { pageContentBytes } = await import('../content/contentModel');
    const pdf = await PDFDocument.load(result.bytes);
    const content = (i: number) => new TextDecoder('latin1').decode(pageContentBytes(pdf, i));
    expect(content(0)).toMatch(/BT\n1 0 0 rg/);
    expect(content(1)).toMatch(/BT\n1 1 1 rg/);
  });
});
