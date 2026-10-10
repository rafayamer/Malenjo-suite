import {describe,expect,it,vi} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {zlibSync} from 'fflate';
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

/** Create a real CRC-valid PNG from the mock rendered canvas pixels. */
function rasterPng(width:number,height:number,rgba:Uint8ClampedArray):Uint8Array{
  const word=(n:number)=>Uint8Array.of(n>>>24,(n>>>16)&255,(n>>>8)&255,n&255);
  const join=(...parts:Uint8Array[])=>{
    const out=new Uint8Array(parts.reduce((a,x)=>a+x.length,0));
    let p=0;for(const bytes of parts){out.set(bytes,p);p+=bytes.length;}return out;
  };
  const chunk=(type:string,bytes:Uint8Array)=>{
    const data=join(new TextEncoder().encode(type),bytes);
    let crc=0xffffffff;
    for(const byte of data){
      crc^=byte;
      for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    return join(word(bytes.length),data,word((crc^0xffffffff)>>>0));
  };
  const raw=new Uint8Array(height*(1+width*3));
  let cursor=0;
  for(let y=0;y<height;y++){
    raw[cursor++]=0;
    for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      raw[cursor++]=rgba[i];raw[cursor++]=rgba[i+1];raw[cursor++]=rgba[i+2];
    }
  }
  return join(Uint8Array.of(137,80,78,71,13,10,26,10),
    chunk('IHDR',join(word(width),word(height),Uint8Array.of(8,2,0,0,0))),
    chunk('IDAT',zlibSync(raw)),chunk('IEND',new Uint8Array()));
}

describe('real PDF export from a mocked PDF.js render surface',()=>{
  it('renders, changes pixels, embeds a valid PNG and reopens a separate PDF',async()=>{
    let savedPixels:Uint8ClampedArray|null=null;
    const canvas={
      width:0,height:0,
      getContext:()=>({
        getImageData:()=>({
          data:Uint8ClampedArray.from([10,20,30,255,10,20,30,255]),
        }),
        putImageData:(image:{data:Uint8ClampedArray})=>{
          savedPixels=Uint8ClampedArray.from(image.data);
        },
      }),
      toBlob:(callback:(blob:Blob)=>void)=>{
        if(!savedPixels)throw new Error('Pixels were not modified before PNG encoding.');
        callback(new Blob([rasterPng(2,1,savedPixels)],{type:'image/png'}));
      },
    };
    vi.stubGlobal('document',{createElement:()=>canvas});
    try{
      const pdf={
        numPages:1,
        getPage:async()=>({
          getViewport:()=>({width:2,height:1}),
          render:()=>({promise:Promise.resolve(),cancel:()=>{}}),
        }),
      };
      const progress=vi.fn();
      const result=await exportPdfRasterEffect(pdf as never,{effect:'invert',onProgress:progress});
      const reopened=await PDFDocument.load(result);
      expect(reopened.getPageCount()).toBe(1);
      expect(reopened.getPage(0).getWidth()).toBe(2);
      expect(reopened.getPage(0).getHeight()).toBe(1);
      expect(savedPixels?Array.from(savedPixels):null).toEqual([245,235,225,255,245,235,225,255]);
      expect(progress).toHaveBeenCalledWith(1,1);
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
    }finally{
      vi.unstubAllGlobals();
    }
  });
});
