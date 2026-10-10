import {describe,expect,it,vi} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {zlibSync} from 'fflate';
import {exportSearchablePdfFromLocalOcr,normalizePdfOcrText} from './pdfLocalOcr';

function png():Uint8Array{
  const word=(n:number)=>Uint8Array.of(n>>>24,(n>>>16)&255,(n>>>8)&255,n&255);
  const join=(...parts:Uint8Array[])=>{const result=new Uint8Array(parts.reduce((n,x)=>n+x.length,0));let i=0;for(const p of parts){result.set(p,i);i+=p.length;}return result;};
  const chunk=(type:string,data:Uint8Array)=>{
    const payload=join(new TextEncoder().encode(type),data);
    let crc=0xffffffff;
    for(const byte of payload){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    return join(word(data.length),payload,word((crc^0xffffffff)>>>0));
  };
  return join(Uint8Array.of(137,80,78,71,13,10,26,10),
    chunk('IHDR',join(word(2),word(2),Uint8Array.of(8,2,0,0,0))),
    chunk('IDAT',zlibSync(Uint8Array.of(0,255,255,255,255,255,255,0,255,255,255,255,255,255))),
    chunk('IEND',new Uint8Array()));
}
async function source(pages=1):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  for(let i=0;i<pages;i++)pdf.addPage([2,2]);
  return Uint8Array.from(await pdf.save());
}
const reader=(count=1)=>({numPages:count,getPage:async()=>({
  getViewport:()=>({width:2,height:2}),
  render:()=>({promise:Promise.resolve(),cancel:()=>{}}),
})}) as never;
describe('optional local PDF OCR output',()=>{
  it('reopens raster PDF with embedded hidden selectable text without altering source',async()=>{
    const data=await source();
    const original=Uint8Array.from(data);
    const image=png();
    const canvas={
      width:0,height:0,getContext:()=>({}),
      toBlob:(done:(v:Blob)=>void)=>{
        const safe=new Uint8Array(new ArrayBuffer(image.byteLength));safe.set(image);
        done(new Blob([safe],{type:'image/png'}));
      },
    };
    vi.stubGlobal('document',{createElement:()=>canvas});
    try{
      const recognize=vi.fn(async()=>({text:'Invoice OCR recognized',confidence:94}));
      const result=await exportSearchablePdfFromLocalOcr(data,reader(),{recognize});
      expect(data).toEqual(original);
      expect(result.pages).toEqual([{page:1,text:'Invoice OCR recognized',confidence:94}]);
      expect(recognize).toHaveBeenCalledTimes(1);
      expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
      expect(result.bytes).not.toEqual(data);
    }finally{vi.unstubAllGlobals();}
  });
  it('converts unsupported Unicode to searchable ASCII escapes',()=>{
    expect(normalizePdfOcrText('Hello 世界')).toBe('Hello \\u4e16\\u754c');
    expect(()=>normalizePdfOcrText('x'.repeat(20001))).toThrow(/20,000/);
  });
  it('rejects blank source, page limits and missing desktop provider',async()=>{
    await expect(exportSearchablePdfFromLocalOcr(new Uint8Array(),reader(),{
      recognize:async()=>({text:'x',confidence:98}),
    })).rejects.toThrow(/32 MB/);
    await expect(exportSearchablePdfFromLocalOcr(await source(11),reader(11),{
      recognize:async()=>({text:'x',confidence:98}),
    })).rejects.toThrow(/1 to 10/);
    await expect(exportSearchablePdfFromLocalOcr(await source(),reader()))
      .rejects.toThrow(/desktop PaddleOCR/);
  });
  it('fails fast for aborted operations',async()=>{
    const signal=new AbortController();signal.abort();
    await expect(exportSearchablePdfFromLocalOcr(await source(),reader(),{
      signal:signal.signal,recognize:async()=>({text:'x',confidence:99}),
    })).rejects.toMatchObject({name:'AbortError'});
  });
});
