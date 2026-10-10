import {describe,expect,it} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {parsePlainPdfLines,convertPlainTextToPdf,TEXT_TO_PDF_MAX_INPUT_BYTES} from './plainTextToPdf';
const encode=(text:string)=>new TextEncoder().encode(text);
describe('offline literal text-to-PDF fallback',()=>{
  it('preserves source text markup as literal text rather than Markdown headings/code',async()=>{
    const source=encode('# Not a heading\n- Not a bullet\n<script>alert(1)</script>');
    const before=Uint8Array.from(source);
    const lines=parsePlainPdfLines(source);
    expect(lines.every(line=>line.style==='body')).toBe(true);
    expect(lines[0].text).toBe('# Not a heading');
    expect(lines[1].text).toBe('- Not a bullet');
    expect(lines[2].text).toContain('<script>');
    const result=await convertPlainTextToPdf(source);
    const loaded=await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(1);
    expect(loaded.getTitle()).toBe('Plain text document');
    expect(source).toEqual(before);
  });
  it('transliterates Unicode to visible reversible escapes',async()=>{
    const lines=parsePlainPdfLines(encode('Hello 😀\nمرحبا'));
    expect(lines[0].text).toContain('\\ud83d\\ude00');
    expect(lines[1].text).toContain('\\u0645');
    expect((await PDFDocument.load(await convertPlainTextToPdf(encode('abc 😀'))))
      .getPageCount()).toBe(1);
  });
  it('paginates ordinary multiline text and can reopen all resulting pages',async()=>{
    const text=Array.from({length:130},(_,i)=>'Original text line '+i).join('\n');
    const loaded=await PDFDocument.load(await convertPlainTextToPdf(encode(text)));
    expect(loaded.getPageCount()).toBeGreaterThan(1);
  });
  it('refuses malformed UTF-8, oversized and textless sources',async()=>{
    expect(()=>parsePlainPdfLines(new Uint8Array())).toThrow(/2 MB/);
    expect(()=>parsePlainPdfLines(new Uint8Array(TEXT_TO_PDF_MAX_INPUT_BYTES+1)))
      .toThrow(/2 MB/);
    expect(()=>parsePlainPdfLines(Uint8Array.from([0xff,0xff])))
      .toThrow(/valid UTF-8/);
    expect(()=>parsePlainPdfLines(encode('   \n  '))).toThrow(/no printable content/);
  });
});
