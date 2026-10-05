import { describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  flattenPdfOutline,
  normalizePdfAttachments,
  resolvePdfOutlinePage,
  sanitizePdfAttachmentName,
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
  it('sanitizes filenames and copies attachment bytes', () => {
    const source = new Uint8Array([1,2,3]);
    const model = normalizePdfAttachments({
      dangerous:{ filename:'../secret\\payload.exe', content:source },
    },200,1024);

    expect(model.entries).toHaveLength(1);
    expect(model.entries[0].name).toBe('_secret_payload.exe');
    expect([...model.entries[0].content]).toEqual([1,2,3]);
    source[0]=9;
    expect(model.entries[0].content[0]).toBe(1);
  });

  it('blocks empty and over-limit extraction', () => {
    const model = normalizePdfAttachments({
      empty:{ filename:'empty.bin', content:new Uint8Array() },
      huge:{ filename:'huge.bin', content:new Uint8Array(5) },
    },200,4);

    expect(model.entries[0].downloadable).toBe(false);
    expect(model.entries[1].downloadable).toBe(false);
    expect(model.entries[1].reason).toMatch(/limit/i);
  });

  it('removes path traversal and control characters from exported names', () => {
    expect(sanitizePdfAttachmentName('../../bad\u0000/name.txt','fallback.bin')).toBe('_bad_name.txt');
  });
});
