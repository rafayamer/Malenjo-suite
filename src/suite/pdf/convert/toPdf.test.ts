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
});
