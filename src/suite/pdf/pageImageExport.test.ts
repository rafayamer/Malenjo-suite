import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { archivePdfPageJpegs, archivePdfPagePngs, exportPdfPagesAsJpegZip, exportPdfPagesAsPngZip, PDF_PAGE_IMAGE_MAX_PAGES } from './pageImageExport';

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

describe('real PDF page-to-JPEG archive safety',()=>{
  const jpeg=Uint8Array.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0xff,0xd9]);

  it('archives every JPEG page in stable PDF order, with .jpg names',()=>{
    const archive=archivePdfPageJpegs([
      {pageNumber:1,bytes:jpeg},{pageNumber:2,bytes:jpeg},
    ],2);
    const files=unzipSync(archive);
    expect(Object.keys(files)).toEqual(['page-0001.jpg','page-0002.jpg']);
    expect(Array.from(files['page-0002.jpg'])).toEqual(Array.from(jpeg));
  });

  it('rejects missing, reordered, or PNG-mislabeled pages before creating a ZIP',()=>{
    expect(()=>archivePdfPageJpegs([{pageNumber:2,bytes:jpeg}],1)).toThrow(/consecutive/);
    expect(()=>archivePdfPageJpegs([],1)).toThrow(/requires all PDF pages/);
    expect(()=>archivePdfPageJpegs([{pageNumber:1,bytes:image()}],1)).toThrow(/Invalid JPEG/);
    expect(()=>archivePdfPageJpegs([{pageNumber:1,bytes:jpeg}],2)).toThrow(/requires all PDF pages/);
  });

  it('rejects unsupported page counts and quality limits before touching PDF pages',async()=>{
    let accessed=false;
    const bad={numPages:51,getPage:async()=>{accessed=true;throw Error('Must not render');}};
    await expect(exportPdfPagesAsJpegZip(bad as never)).rejects.toThrow(/refusing partial exports/);
    expect(accessed).toBe(false);
    await expect(exportPdfPagesAsJpegZip({...bad,numPages:1} as never,{quality:0.1}))
      .rejects.toThrow(/quality/);
    expect(accessed).toBe(false);
  });

  it('honors cancellations before rasterizing source pages',async()=>{
    const controller=new AbortController();
    controller.abort();
    let called=false;
    const pdf={numPages:1,getPage:async()=>{called=true;throw Error('Must not access');}};
    await expect(exportPdfPagesAsJpegZip(pdf as never,{signal:controller.signal}))
      .rejects.toMatchObject({name:'AbortError'});
    expect(called).toBe(false);
  });
});
