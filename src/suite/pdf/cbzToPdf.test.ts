import {describe,expect,it} from 'vitest';
import {zipSync,zlibSync} from 'fflate';
import {PDFDocument} from 'pdf-lib';
import {readCbzPages,convertCbzToPdf,CBZ_TO_PDF_MAX_IMAGES} from './cbzToPdf';

const be=(x:number)=>[(x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255];
function chunk(name:string,data:number[]):number[]{
  const b=[...Array.from(name).map(x=>x.charCodeAt(0)),...data];
  let crc=0xffffffff;
  for(const value of b){crc^=value;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return [...be(data.length),...b,...be((crc^0xffffffff)>>>0)];
}
function png(width=1):Uint8Array{
  return Uint8Array.from([137,80,78,71,13,10,26,10,
    ...chunk('IHDR',[...be(width),...be(1),8,6,0,0,0]),
    ...chunk('IDAT',Array.from(zlibSync(Uint8Array.from([0,...Array.from({length:width},()=>[120,50,20,255]).flat()])))),
    ...chunk('IEND',[])]);
}
describe('native CBZ to PDF conversion',()=>{
  it('accepts real PNGs, sorts numbered filenames naturally and reopens its PDF pages',async()=>{
    const source=zipSync({'page-10.png':png(2),'page-2.png':png(1)});
    expect(readCbzPages(source).map(x=>x.name)).toEqual(['page-2.png','page-10.png']);
    const original=Uint8Array.from(source);
    const converted=await convertCbzToPdf(source);
    const pdf=await PDFDocument.load(converted);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize().width).toBe(1);
    expect(pdf.getPage(1).getSize().width).toBe(2);
    expect(source).toEqual(original);
  });
  it('refuses traversal, Windows drive paths, and non-image archive contents',()=>{
    for(const path of ['../attack.png','folder/../../evil.png','C:bad.png','folder\\page.png']){
      expect(()=>readCbzPages(zipSync({[path]:png()}))).toThrow(/unsafe member path/);
    }
    expect(()=>readCbzPages(zipSync({'ComicInfo.xml':new TextEncoder().encode('<xml/>')})))
      .toThrow(/unsupported archive member/);
  });
  it('fails closed for truncated or tampered PNG pages',()=>{
    const cut=png().slice(0,-8);
    expect(()=>readCbzPages(zipSync({'page.png':cut}))).toThrow(/damaged image/);
    const corrupt=png();corrupt[40]^=0xff;
    expect(()=>readCbzPages(zipSync({'page.png':corrupt}))).toThrow(/damaged image/);
  });
  it('refuses oversized image dimensions and excessive page counts',()=>{
    expect(()=>readCbzPages(zipSync({'large.png':png(32769)}))).toThrow(/damaged image/);
    const entries:Record<string,Uint8Array>={};
    for(let i=1;i<=CBZ_TO_PDF_MAX_IMAGES+1;i++)entries['page-'+i+'.png']=png();
    expect(()=>readCbzPages(zipSync(entries))).toThrow(/50-page image limit/);
  });
  it('rejects empty or corrupt ZIP input without producing a PDF',async()=>{
    await expect(convertCbzToPdf(Uint8Array.from([80,75,3,4,0]))).rejects.toThrow();
    await expect(convertCbzToPdf(zipSync({}))).rejects.toThrow(/no valid page images/);
  });
});
