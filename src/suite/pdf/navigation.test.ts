import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  flattenPdfOutline,
  normalizePdfAttachments,
  resolvePdfOutlinePage,
  sanitizePdfAttachmentName,
  safePdfAttachmentExportName,
  readPdfAttachmentBytes,
} from './navigation';

describe('PDF outline navigation', () => {
  it('flattens nested outline entries with bounded depth and external-link metadata', () => {
    const model = flattenPdfOutline([
      {
        title:'Chapter 1',
        dest:'chapter-1',
        items:[
          { title:'Section 1.1', dest:[0, { name:'XYZ' }, 0, 0, null] },
          { title:'Website', url:'https://example.invalid/' },
        ],
      },
    ]);

    expect(model.truncated).toBe(false);
    expect(model.entries.map((item)=>[item.title,item.depth])).toEqual([
      ['Chapter 1',0],
      ['Section 1.1',1],
      ['Website',1],
    ]);
    expect(model.entries[2].url).toBe('https://example.invalid/');
  });

  it('caps pathological outline trees', () => {
    const model = flattenPdfOutline(
      Array.from({length:20},(_,index)=>({title:`Item ${index}`})),
      5,
    );
    expect(model.entries).toHaveLength(5);
    expect(model.truncated).toBe(true);
  });

  it('resolves named, numeric and ref destinations to one-based pages', async () => {
    const ref = { num:7, gen:0 };
    const document = {
      numPages:10,
      getDestination: async (name:string) => name === 'named' ? [ref, { name:'Fit' }] : null,
      getPageIndex: async (value:unknown) => value === ref ? 4 : -1,
    } as unknown as Pick<PDFDocumentProxy,'numPages'|'getDestination'|'getPageIndex'>;

    await expect(resolvePdfOutlinePage(document,'named')).resolves.toBe(5);
    await expect(resolvePdfOutlinePage(document,[2,{name:'Fit'}])).resolves.toBe(3);
    await expect(resolvePdfOutlinePage(document,'missing')).resolves.toBeNull();
  });
});

describe('PDF embedded attachments', () => {
  it('reads metadata Map without fetching or copying attachment contents',()=>{
    const model=normalizePdfAttachments(new Map([
      ['internal-file-id',{filename:'../secret\\payload.exe',size:3}],
    ]),200,1024);
    expect(model.entries).toHaveLength(1);
    expect(model.entries[0]).toMatchObject({
      id:'internal-file-id',
      name:'_secret_payload.exe',
      sizeBytes:3,
      downloadable:true,
    });
    expect('content' in model.entries[0]).toBe(false);
  });

  it('blocks unknown sizes and files exceeding the advertised limit',()=>{
    const model=normalizePdfAttachments(new Map([
      ['empty',{filename:'empty.bin'}],
      ['huge',{filename:'huge.bin',size:5}],
    ]),200,4);
    expect(model.entries[0].downloadable).toBe(false);
    expect(model.entries[0].reason).toMatch(/size is unavailable/i);
    expect(model.entries[1].downloadable).toBe(false);
    expect(model.entries[1].reason).toMatch(/limit/i);
  });

  it('copies attachment bytes only after a separate explicit content fetch',()=>{
    const source=new Uint8Array([1,2,3]);
    const extracted=readPdfAttachmentBytes({content:source},4);
    expect([...extracted]).toEqual([1,2,3]);
    source[0]=9;
    expect(extracted[0]).toBe(1);
    expect(()=>readPdfAttachmentBytes({content:new Uint8Array(5)},4))
      .toThrow(/limit/i);
  });

  it('removes path traversal and control characters from exported names', () => {
    expect(sanitizePdfAttachmentName('../../bad\u0000/name.txt','fallback.bin')).toBe('_bad_name.txt');
  });

  it('blocks untrusted executable file extensions while preserving safe names',()=>{
    expect(safePdfAttachmentExportName('installer.exe')).toBe('installer.exe.bin');
    expect(safePdfAttachmentExportName('report.pdf')).toBe('report.pdf');
    expect(safePdfAttachmentExportName('document.docx')).toBe('document.docx');
    expect(safePdfAttachmentExportName('page.html')).toBe('page.html.bin');
  });

  it('limits the number of attachment metadata rows',()=>{
    const input=new Map(Array.from({length:210},(_,i)=>['file-'+i,{filename:'file-'+i+'.txt',size:2}] as const));
    const result=normalizePdfAttachments(input);
    expect(result.entries).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });
});
});
