import { describe, expect, it } from 'vitest';
import { createPdfPageDragPayload, readPdfPageDragPayload } from './pageDrag';

describe('PDF page drag payload isolation',()=>{
  it('round-trips a page only for the owning document tab',()=>{
    const payload=createPdfPageDragPayload('doc-A',3);
    expect(readPdfPageDragPayload(payload,'doc-A',4)).toBe(3);
    expect(readPdfPageDragPayload(payload,'doc-B',4)).toBeNull();
  });
  it('rejects out-of-range, modified and external payloads',()=>{
    const payload=createPdfPageDragPayload('doc-A',3);
    expect(readPdfPageDragPayload(payload,'doc-A',2)).toBeNull();
    expect(readPdfPageDragPayload(JSON.stringify({v:2,scope:'doc-A',page:1}),'doc-A',2)).toBeNull();
    expect(readPdfPageDragPayload(JSON.stringify({v:1,scope:'doc-A',page:'1'}),'doc-A',2)).toBeNull();
    expect(readPdfPageDragPayload('malformed','doc-A',4)).toBeNull();
    expect(readPdfPageDragPayload(' '.repeat(513),'doc-A',4)).toBeNull();
  });
  it('rejects invalid source page metadata before initiating a drag',()=>{
    expect(()=>createPdfPageDragPayload('',1)).toThrow(/invalid/i);
    expect(()=>createPdfPageDragPayload('doc',0)).toThrow(/invalid/i);
    expect(()=>createPdfPageDragPayload('doc',1.5)).toThrow(/invalid/i);
  });
});
