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
});
