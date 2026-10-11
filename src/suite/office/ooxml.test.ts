import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  detectOfficeKind,
  exactCopy,
  parseDocx,
  parsePptx,
  parseXlsx,
  writeDocx,
  writePptx,
  writeXlsx,
} from './ooxml';

function zip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, strToU8(value)]),
  ));
}

describe('OOXML fidelity adapters', () => {
  it('preserves untouched bytes exactly', () => {
    const source = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body/></w:document>' });
    expect(exactCopy(source)).toEqual(source);
  });

  it('parses and rewrites simple DOCX while retaining unrelated package parts', () => {
    const source = zip({
      '[Content_Types].xml': '<Types/>',
      'custom/item.xml': '<keep>yes</keep>',
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
    });
    expect(detectOfficeKind(source)).toBe('docx');
    expect(parseDocx(source).paragraphs).toEqual(['Hello']);
    const next = writeDocx(source, ['Changed']);
    const files = unzipSync(next);
    expect(strFromU8(files['word/document.xml'])).toContain('Changed');
    expect(strFromU8(files['custom/item.xml'])).toBe('<keep>yes</keep>');
  });

  it('parses and rewrites a simple XLSX worksheet', () => {
    const source = zip({
      '[Content_Types].xml': '<Types/>',
      'xl/workbook.xml': '<workbook><sheets><sheet name="Data"/></sheets></workbook>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>',
    });
    const model = parseXlsx(source);
    expect(model.sheetName).toBe('Data');
    expect(model.cells[0][0]).toBe('Hello');
    expect(model.cells[0][1]).toBe('42');
    model.cells[0][0] = 'Changed';
    const next = writeXlsx(source, model);
    expect(strFromU8(unzipSync(next)['xl/worksheets/sheet1.xml'])).toContain('Changed');
  });


  it('preserves formulas and out-of-window cells while editing B2', () => {
    const source = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Data"/></sheets></workbook>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1"><f>1+2</f><v>3</v></c></row>' +
        '<row r="2"><c r="B2" t="inlineStr"><is><t>old</t></is></c></row>' +
        '<row r="201"><c r="AX201"><f>7+8</f><v>15</v></c></row></sheetData></worksheet>',
    });
    const model = parseXlsx(source);
    model.cells[1][1] = 'new';
    const xml = strFromU8(unzipSync(writeXlsx(source, model))['xl/worksheets/sheet1.xml']);
    expect(xml).toContain('<f>1+2</f>');
    expect(xml).toContain('<c r="AX201"><f>7+8</f><v>15</v></c>');
    expect(xml).toContain('new');
  });

  it('keeps leading-zero and long text identifiers as strings', () => {
    const source = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="IDs"/></sheets></workbook>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>old</t></is></c></row></sheetData></worksheet>',
    });
    const model = parseXlsx(source);
    model.cells[0][0] = '00123';
    model.cells[0][1] = '12345678901234567890';
    const xml = strFromU8(unzipSync(writeXlsx(source, model))['xl/worksheets/sheet1.xml']);
    expect(xml).toContain('00123');
    expect(xml).toContain('12345678901234567890');
    expect(xml).toContain('t="inlineStr"');
  });

  it('resolves the first spreadsheet tab by workbook relationship order', () => {
    const source = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Actual First" r:id="rId9"/><sheet name="Other" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId9" Target="worksheets/sheet7.xml"/><Relationship Id="rId2" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet7.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>first</t></is></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>second</t></is></c></row></sheetData></worksheet>',
    });
    const model = parseXlsx(source);
    expect(model.sheetName).toBe('Actual First');
    expect(model.sheetPath).toBe('xl/worksheets/sheet7.xml');
    expect(model.cells[0][0]).toBe('first');
  });

  it('rejects an OOXML entry above the safe expanded-size budget', () => {
    const bomb = zipSync({ 'word/document.xml': new Uint8Array(33 * 1024 * 1024) });
    expect(() => detectOfficeKind(bomb)).toThrow(/expanded-size|entry count/);
  });

  it('keeps DOCX styles, drawings, tables and section properties after a plain paragraph edit', () => {
    const documentXml='<w:document><w:body>'+
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'+
      '<w:r><w:rPr><w:b/></w:rPr><w:t>Before</w:t></w:r></w:p>'+
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table unchanged</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'+
      '<w:p><w:r><w:drawing/></w:r><w:r><w:t>Drawing paragraph</w:t></w:r></w:p>'+
      '<w:sectPr><w:pgSz w:w="12240"/></w:sectPr></w:body></w:document>';
    const source=zip({'word/document.xml':documentXml,'word/media/image1.png':'image-bytes'});
    const model=parseDocx(source);
    model.paragraphs[0]='After';
    const saved=writeDocx(source,model.paragraphs);
    const xml=strFromU8(unzipSync(saved)['word/document.xml']);
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('Table unchanged');
    expect(xml).toContain('<w:drawing/>');
    expect(xml).toContain('<w:sectPr><w:pgSz w:w="12240"/></w:sectPr>');
    expect(parseDocx(saved).paragraphs[0]).toBe('After');
  });

  it('refuses DOCX paragraph deletion and rich-object rewriting rather than destroying content', () => {
    const source=zip({'word/document.xml':
      '<w:document><w:body><w:p><w:hyperlink><w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p></w:body></w:document>'});
    expect(()=>writeDocx(source,[])).toThrow(/cannot safely add\/remove/);
    expect(()=>writeDocx(source,['Changed'])).toThrow(/rich DOCX objects/);
    expect(parseDocx(source).paragraphs).toEqual(['Link']);
  });

  it('uses the PowerPoint slide-id relationship order, not filename order', () => {
    const source=zip({
      'ppt/presentation.xml':'<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId7"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':'<Relationships><Relationship Id="rId7" Target="slides/slide9.xml"/><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>',
      'ppt/slides/slide1.xml':'<p:sld><a:t>SECOND</a:t></p:sld>',
      'ppt/slides/slide9.xml':'<p:sld><a:t>FIRST</a:t></p:sld>',
    });
    const slides=parsePptx(source).slides;
    expect(slides.map(s=>s.texts[0])).toEqual(['FIRST','SECOND']);
    slides[0].texts[0]='Updated first';
    const files=unzipSync(writePptx(source,{kind:'pptx',slides,fidelity:'structure-preserving'}));
    expect(strFromU8(files['ppt/slides/slide9.xml'])).toContain('Updated first');
    expect(strFromU8(files['ppt/slides/slide1.xml'])).toContain('SECOND');
  });

  it('refuses a multi-slide PPTX without an authoritative order relationship', () => {
    const source=zip({
      'ppt/presentation.xml':'<p:presentation/>',
      'ppt/slides/slide1.xml':'<p:sld><a:t>A</a:t></p:sld>',
      'ppt/slides/slide2.xml':'<p:sld><a:t>B</a:t></p:sld>',
    });
    expect(()=>parsePptx(source)).toThrow(/canonical slide order/);
  });

  it('parses and rewrites PPTX text runs', () => {
    const source = zip({
      '[Content_Types].xml': '<Types/>',
      'ppt/presentation.xml': '<p:presentation/>',
      'ppt/slides/slide1.xml': '<p:sld><a:t>Title</a:t><a:t>Body</a:t></p:sld>',
    });
    const model = parsePptx(source);
    expect(model.slides[0].texts).toEqual(['Title', 'Body']);
    model.slides[0].texts[1] = 'Updated';
    const next = writePptx(source, model);
    expect(strFromU8(unzipSync(next)['ppt/slides/slide1.xml'])).toContain('Updated');
  });

  it('round-trips edits on two ordered visible tabs and keeps a hidden tab and formulas untouched', () => {
    const hidden = '<worksheet><sheetData><row r="1"><c r="A1"><f>100+1</f><v>101</v></c></row></sheetData></worksheet>';
    const first = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>First before</t></is></c><c r="B1"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>';
    const second = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Second before</t></is></c></row></sheetData></worksheet>';
    const source = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Hidden" state="veryHidden" r:id="rId3"/><sheet name="Second" r:id="rId9"/><sheet name="First" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId3" Target="worksheets/sheet8.xml"/><Relationship Id="rId9" Target="worksheets/sheet13.xml"/><Relationship Id="rId1" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/worksheets/sheet8.xml': hidden,
      'xl/worksheets/sheet13.xml': second,
      'xl/worksheets/sheet2.xml': first,
      'custom/preserved.xml': '<keep>yes</keep>',
    });
    const originalBytes = source.slice();
    const model = parseXlsx(source);
    expect(model.sheetName).toBe('Second');
    expect(model.sheets!.map((sheet) => [sheet.name, sheet.path, sheet.hidden])).toEqual([
      ['Hidden', 'xl/worksheets/sheet8.xml', true],
      ['Second', 'xl/worksheets/sheet13.xml', false],
      ['First', 'xl/worksheets/sheet2.xml', false],
    ]);
    model.cells[0][0] = 'Second after';
    model.sheets![2].cells[0][0] = 'First after';
    const saved = writeXlsx(source, model);
    const parts = unzipSync(saved);
    expect(strFromU8(parts['xl/worksheets/sheet13.xml'])).toContain('Second after');
    expect(strFromU8(parts['xl/worksheets/sheet2.xml'])).toContain('First after');
    expect(strFromU8(parts['xl/worksheets/sheet2.xml'])).toContain('<f>1+2</f>');
    expect(strFromU8(parts['xl/worksheets/sheet8.xml'])).toBe(hidden);
    expect(strFromU8(parts['custom/preserved.xml'])).toBe('<keep>yes</keep>');
    expect(strFromU8(parts['xl/workbook.xml'])).toContain('state="veryHidden"');
    expect(source).toEqual(originalBytes);
    const reopened = parseXlsx(saved);
    expect(reopened.sheets!.map((sheet) => sheet.name)).toEqual(['Hidden','Second','First']);
    expect(reopened.cells[0][0]).toBe('Second after');
    expect(reopened.sheets![2].cells[0][0]).toBe('First after');
  });

  it('rejects incomplete, reordered and hidden-sheet edit models without touching the original', () => {
    const source = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Visible" r:id="a"/><sheet name="Hidden" state="hidden" r:id="b"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="a" Target="worksheets/sheet5.xml"/><Relationship Id="b" Target="worksheets/sheet6.xml"/></Relationships>',
      'xl/worksheets/sheet5.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet6.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>2</v></c></row></sheetData></worksheet>',
    });
    const immutable = source.slice();
    const missing = parseXlsx(source);
    missing.sheets!.pop();
    expect(() => writeXlsx(source, missing)).toThrow(/identities\/order/);
    const reordered = parseXlsx(source);
    reordered.sheets!.reverse();
    expect(() => writeXlsx(source, reordered)).toThrow(/identities\/order/);
    const hidden = parseXlsx(source);
    hidden.sheets![1].cells[0][0] = 'modified';
    expect(() => writeXlsx(source, hidden)).toThrow(/hidden XLSX worksheets/);
    expect(source).toEqual(immutable);
  });

  it('fails closed on ambiguous multi-sheet or unsafe worksheet relationships', () => {
    const withoutRels = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="A"/><sheet name="B"/></sheets></workbook>',
      'xl/worksheets/sheet1.xml': '<worksheet/>',
      'xl/worksheets/sheet2.xml': '<worksheet/>',
    });
    expect(() => parseXlsx(withoutRels)).toThrow(/requires workbook relationships/);
    const unsafe = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="A" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="../../outside.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet/>',
    });
    expect(() => parseXlsx(unsafe)).toThrow(/unsafe/);
    const noVisible = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Secrets" state="veryHidden" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet/>',
    });
    expect(() => parseXlsx(noVisible)).toThrow(/no visible worksheet/);
  });
});
