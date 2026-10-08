import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createPdfFromImages, PDF_IMAGE_MAX_COUNT } from './imageConvert';

const PNG_1PX='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS6cAAAAASUVORK5CYII=';
function png():Uint8Array{
  return Uint8Array.from(atob(PNG_1PX),char=>char.charCodeAt(0));
}

describe('local images-to-PDF creation',()=>{
  it('creates an ordered multi-page PDF from PNG images',async()=>{
    const progress=vi.fn();
    const bytes=await createPdfFromImages([
      {name:'first.png',bytes:png()},
      {name:'second.png',bytes:png()},
    ],{onProgress:progress});
    const pdf=await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getWidth()).toBeGreaterThan(0);
    expect(progress).toHaveBeenNthCalledWith(1,1,2);
    expect(progress).toHaveBeenNthCalledWith(2,2,2);
  });

  it('rejects unsupported input before starting PDF output',async()=>{
    await expect(createPdfFromImages([{name:'fake.png',bytes:new Uint8Array([1,2,3])}]))
      .rejects.toThrow(/only valid PNG and JPEG/i);
    await expect(createPdfFromImages([])).rejects.toThrow(/at least one/i);
    await expect(createPdfFromImages(Array.from({length:PDF_IMAGE_MAX_COUNT+1},()=>({name:'photo.png',bytes:png()}))))
      .rejects.toThrow(/up to 100 images/i);
  });

  it('rejects oversized PNG dimensions without decoding a decompression bomb',async()=>{
    const bytes=png();
    const view=new DataView(bytes.buffer);
    view.setUint32(16,100000);
    view.setUint32(20,100000);
    await expect(createPdfFromImages([{name:'huge.png',bytes}]))
      .rejects.toThrow(/megapixel/i);
  });

  it('honors cancellation before producing output',async()=>{
    const controller=new AbortController();
    controller.abort();
    await expect(createPdfFromImages([{name:'good.png',bytes:png()}],{signal:controller.signal}))
      .rejects.toMatchObject({name:'AbortError'});
  });

  it('rejects images above the per-file input bound',async()=>{
    const data=new Uint8Array(32*1024*1024+1);
    await expect(createPdfFromImages([{name:'too-big.png',bytes:data}]))
      .rejects.toThrow(/32 MB/i);
  });
});
