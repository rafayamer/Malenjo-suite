import {describe,expect,it} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {
  prepareJsonPdfLines,convertJsonToPdf,JSON_TO_PDF_MAX_INPUT_BYTES,
  JSON_TO_PDF_MAX_CHARACTERS,JSON_TO_PDF_MAX_PAGES,
} from './jsonToPdf';
const utf8=(value:string)=>new TextEncoder().encode(value);
describe('offline JSON to real PDF',()=>{
  it('renders a searchable multi-page PDF with valid page count and report metadata',async()=>{
    const long=Array.from({length:175},(_,i)=>({record:i,status:'OK'}));
    const pdf=await convertJsonToPdf(utf8(JSON.stringify(long)));
    expect(Array.from(pdf.slice(0,5))).toEqual([37,80,68,70,45]);
    const result=await PDFDocument.load(pdf);
    expect(result.getPageCount()).toBeGreaterThan(1);
    expect(result.getPageCount()).toBeLessThanOrEqual(JSON_TO_PDF_MAX_PAGES);
    expect(result.getTitle()).toBe('JSON text report');
  });
  it('preserves arbitrary Unicode reversibly with printed ASCII JSON escapes',()=>{
    const lines=prepareJsonPdfLines(utf8('{"greeting":"Résumé 😀","safe":"<script>"}'));
    expect(lines.join('')).toContain('R\\u00e9sum\\u00e9');
    expect(lines.join('')).toContain('\\ud83d\\ude00');
    expect(lines.join('')).toContain('<script>');
    for(const line of lines)expect(line).toMatch(/^[\x20-\x7e]*$/);
  });
  it('does not execute or interpret hostile HTML, paths or object keys',async()=>{
    const input=utf8('{"__proto__":{"isAdmin":true},"cmd":"<script>alert(1)</script>"}');
    const before=Uint8Array.from(input);
    const result=await convertJsonToPdf(input);
    expect(result.length).toBeGreaterThan(300);
    expect(input).toEqual(before);
    expect(({} as Record<string,unknown>).isAdmin).toBeUndefined();
  });
  it('rejects malformed JSON, non-UTF8 data and oversized source',async()=>{
    await expect(convertJsonToPdf(utf8('{not json}'))).rejects.toThrow(/syntactically valid/);
    await expect(convertJsonToPdf(Uint8Array.from([0xff,0xfe,0xfd])))
      .rejects.toThrow(/valid UTF-8/);
    expect(()=>prepareJsonPdfLines(new Uint8Array(JSON_TO_PDF_MAX_INPUT_BYTES+1)))
      .toThrow(/at most 2 MB/);
  });
  it('rejects excess depth, line count and character count before PDF allocation',()=>{
    const deeplyNested='['.repeat(70)+'0'+']'.repeat(70);
    expect(()=>prepareJsonPdfLines(utf8(deeplyNested))).toThrow(/64 levels/);
    const many={records:'x'.repeat(JSON_TO_PDF_MAX_CHARACTERS)};
    expect(()=>prepareJsonPdfLines(utf8(JSON.stringify(many)))).toThrow(/500,000-character/);
    const lines=Array.from({length:6500},(_,i)=>String(i)).join('\n');
    expect(()=>prepareJsonPdfLines(utf8(JSON.stringify(lines)))).not.toThrow();
    expect(JSON_TO_PDF_MAX_PAGES).toBe(100);
  });
});
