import {describe,expect,it} from 'vitest';
import {
  exportPdfRasterEffect,transformPdfRasterPixels,
  PDF_RASTER_EFFECT_MAX_PIXELS,
} from './pdfRasterEffects';

describe('native offline PDF raster processing',()=>{
  it('applies real contrast to all RGB channels while keeping opaque output',()=>{
    const rgba=Uint8ClampedArray.from([100,150,200,255,128,128,128,255]);
    transformPdfRasterPixels(rgba,2,1,'contrast',2);
    expect(Array.from(rgba)).toEqual([72,172,255,255,128,128,128,255]);
  });
  it('inverts opaque colors and composites transparency against white first',()=>{
    const rgba=Uint8ClampedArray.from([10,20,30,255,0,0,0,0]);
    transformPdfRasterPixels(rgba,2,1,'invert');
    expect(Array.from(rgba)).toEqual([245,235,225,255,0,0,0,255]);
  });
  it('produces grayscale scan ink with white paper and deterministic edge behavior',()=>{
    const rgba=Uint8ClampedArray.from([0,0,0,255,255,255,255,255,150,150,150,255]);
    transformPdfRasterPixels(rgba,3,1,'scan');
    expect(Array.from(rgba.slice(0,8))).toEqual([0,0,0,255,255,255,255,255]);
    expect(rgba[8]).toBeGreaterThan(0);
    expect(rgba[8]).toBeLessThan(255);
    expect(rgba[8]).toBe(rgba[9]);expect(rgba[9]).toBe(rgba[10]);
  });
  it('rejects unsafe dimensions, invalid pixel shapes and out-of-range settings',()=>{
    expect(()=>transformPdfRasterPixels(new Uint8ClampedArray(4),0,1,'scan')).toThrow(/dimensions/);
    expect(()=>transformPdfRasterPixels(new Uint8ClampedArray(4),2,1,'scan')).toThrow(/dimensions/);
    expect(()=>transformPdfRasterPixels(new Uint8ClampedArray(4),1,1,'contrast',Infinity)).toThrow(/Contrast/);
    expect(()=>transformPdfRasterPixels(new Uint8ClampedArray(4),1,1,'contrast',3.5)).toThrow(/Contrast/);
    expect(()=>transformPdfRasterPixels(new Uint8ClampedArray(4),1,1,'contrast',0.2)).toThrow(/Contrast/);
    expect(()=>transformPdfRasterPixels(new Uint8ClampedArray(4),1,1,'bogus' as 'scan')).toThrow(/Unsupported/);
    expect(PDF_RASTER_EFFECT_MAX_PIXELS).toBe(8_000_000);
  });
  it('rejects documents with too many pages before any rendering and supports cancellation',async()=>{
    const unused=()=>{throw new Error('getPage must not be called');};
    await expect(exportPdfRasterEffect({numPages:21,getPage:unused} as never,{effect:'scan'}))
      .rejects.toThrow(/1 to 20 pages/);
    await expect(exportPdfRasterEffect({numPages:0,getPage:unused} as never,{effect:'invert'}))
      .rejects.toThrow(/1 to 20 pages/);
    const controller=new AbortController();controller.abort();
    await expect(exportPdfRasterEffect({numPages:1,getPage:unused} as never,
      {effect:'contrast',signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  });
});
