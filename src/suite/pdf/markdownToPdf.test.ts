import {describe,expect,it} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {
  parseOfflineMarkdown,convertMarkdownToPdf,
  MARKDOWN_TO_PDF_MAX_INPUT_BYTES,MARKDOWN_TO_PDF_MAX_PAGES,
} from './markdownToPdf';
const encode=(s:string)=>new TextEncoder().encode(s);
describe('safe offline Markdown -> PDF',()=>{
  it('renders headings, paragraphs, lists, fenced code and quotes to a real PDF',async()=>{
    const input=encode([
      '# First heading','',
      'Paragraph with **emphasis** and [link](https://example.org).',
      '- First bullet','1. Second item','> Quoted information',
      '~~~js','console.log("<script>");','~~~','## Second heading',
    ].join('\n'));
    const lines=parseOfflineMarkdown(input);
    expect(lines.some(v=>v.style==='heading1')).toBe(true);
    expect(lines.some(v=>v.style==='heading2')).toBe(true);
    expect(lines.some(v=>v.style==='list')).toBe(true);
    expect(lines.some(v=>v.style==='quote')).toBe(true);
    expect(lines.some(v=>v.style==='code'&&v.text.includes('console.log'))).toBe(true);
    const before=Uint8Array.from(input);
    const output=await convertMarkdownToPdf(input);
    const doc=await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getCreator()).toContain('MALENJO');
    expect(input).toEqual(before);
    expect(Array.from(output.slice(0,5))).toEqual([37,80,68,70,45]);
  });
  it('renders non-WinAnsi text with explicit escape sequences instead of errors',async()=>{
    const lines=parseOfflineMarkdown(encode('# Emoji 😀\nनमस्ते'));
    expect(lines.map(v=>v.text).join(' ')).toContain('\\ud83d\\ude00');
    expect(lines.map(v=>v.text).join(' ')).toContain('\\u0928');
    const pdf=await PDFDocument.load(await convertMarkdownToPdf(encode('# Emoji 😀\nनमस्ते')));
    expect(pdf.getPageCount()).toBe(1);
  });
  it('paginates long documents without truncating and rejects unbounded page counts',async()=>{
    const source=encode(Array.from({length:110},(_,i)=>'# Chapter '+i+'\n'+
      'MALENJO PDF text renderer.\n').join(''));
    const doc=await PDFDocument.load(await convertMarkdownToPdf(source));
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getPageCount()).toBeLessThanOrEqual(MARKDOWN_TO_PDF_MAX_PAGES);
    await expect(convertMarkdownToPdf(encode(('Text content\n').repeat(12_000))))
      .rejects.toThrow(/100-page/);
  });
  it('rejects unreadable and oversized files before producing output',async()=>{
    expect(()=>parseOfflineMarkdown(new Uint8Array())).toThrow(/2 MB/);
    expect(()=>parseOfflineMarkdown(new Uint8Array(MARKDOWN_TO_PDF_MAX_INPUT_BYTES+1)))
      .toThrow(/2 MB/);
    expect(()=>parseOfflineMarkdown(Uint8Array.from([0xff,0xff])))
      .toThrow(/valid UTF-8/);
    expect(()=>parseOfflineMarkdown(encode('   \n  '))).toThrow(/no visible content/);
  });
  it('displays hostile HTML as literal text without fetching or executing it',async()=>{
    const source=encode('<img src="https://private.internal/test" onerror="alert(1)">');
    const parsed=parseOfflineMarkdown(source);
    expect(parsed[0].text).toContain('https://private.internal');
    const pdf=await PDFDocument.load(await convertMarkdownToPdf(source));
    expect(pdf.getPageCount()).toBe(1);
  });
});
