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
