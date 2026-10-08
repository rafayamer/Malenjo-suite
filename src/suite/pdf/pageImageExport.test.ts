import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { archivePdfPagePngs, exportPdfPagesAsPngZip, PDF_PAGE_IMAGE_MAX_PAGES } from './pageImageExport';

const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS6cAAAAASUVORK5CYII=';
function image():Uint8Array{
  return Uint8Array.from(atob(PNG),value=>value.charCodeAt(0));
}

describe('PDF page image ZIP exporter',()=>{
  it('keeps PNG pages ordered and named with stable numerical sorting',()=>{
    const first=image(),second=image();
    const zip=archivePdfPagePngs([
      {pageNumber:1,bytes:first},{pageNumber:2,bytes:second},
    ],2);
    const files=unzipSync(zip);
    expect(Object.keys(files)).toEqual(['page-0001.png','page-0002.png']);
    expect([...files['page-0001.png']]).toEqual([...first]);
  });

  it('rejects missing pages, non-PNG content and inappropriate archive size',()=>{
    expect(()=>archivePdfPagePngs([{pageNumber:2,bytes:image()}],1))
      .toThrow(/consecutive/i);
    expect(()=>archivePdfPagePngs([{pageNumber:1,bytes:new Uint8Array([1,2,3])}],1))
      .toThrow(/invalid PNG/i);
    expect(()=>archivePdfPagePngs([],1)).toThrow(/requires every page/i);
    expect(()=>archivePdfPagePngs(Array.from({length:PDF_PAGE_IMAGE_MAX_PAGES+1},(_,i)=>({pageNumber:i+1,bytes:image()})),PDF_PAGE_IMAGE_MAX_PAGES+1))
      .toThrow(/at most 50 pages/i);
  });

  it('rejects oversized PDF page counts without rendering anything',async()=>{
    let accessed=false;
    await expect(exportPdfPagesAsPngZip({
      numPages:51,
      getPage:async()=>{accessed=true;throw Error('Should never render');},
    } as never)).rejects.toThrow(/no pages were silently omitted/i);
    expect(accessed).toBe(false);
  });

  it('rejects an aborted request before rendering',async()=>{
    const controller=new AbortController();
    controller.abort();
    await expect(exportPdfPagesAsPngZip({
      numPages:1,
      getPage:async()=>{throw Error('Should never render');},
    } as never,{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  });

  it('validates output scales before acquiring canvases',async()=>{
    await expect(exportPdfPagesAsPngZip({numPages:1,getPage:async()=>{throw Error('No');}} as never,{scale:10}))
      .rejects.toThrow(/scale/i);
  });
});
