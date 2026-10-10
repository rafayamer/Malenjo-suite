import {describe,expect,it} from 'vitest';
import {zipSync,zlibSync} from 'fflate';
import {archivePdfPagePngs} from './pageImageExport';
import {validatePdfCbzArchive} from './pdfToCbz';

function be32(n:number):number[]{
  return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
}
function chunk(type:string,data:number[]):number[]{
  const b=[...Array.from(type).map(c=>c.charCodeAt(0)),...data];
  let crc=0xffffffff;
  for(const k of b){crc^=k;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return [...be32(data.length),...b,...be32((crc^0xffffffff)>>>0)];
}
function png():Uint8Array{
  return Uint8Array.from([
    137,80,78,71,13,10,26,10,
    ...chunk('IHDR',[...be32(1),...be32(1),8,6,0,0,0]),
    ...chunk('IDAT',Array.from(zlibSync(Uint8Array.from([0,100,150,200,255])))),
    ...chunk('IEND',[]),
  ]);
}
describe('offline PDF to comic-book CBZ validation',()=>{
  it('accepts ordered real PNG page outputs in the comic-book ZIP container',async()=>{
    const archive=archivePdfPagePngs([
      {pageNumber:1,bytes:png()},{pageNumber:2,bytes:png()},
    ],2);
    await expect(validatePdfCbzArchive(archive)).resolves.toBeUndefined();
    expect(archive.slice(0,2)).toEqual(Uint8Array.from([80,75]));
  });
  it('rejects a truncated PNG member even when the ZIP structure itself is valid',async()=>{
    const archive=zipSync({'page-0001.png':png().slice(0,-12)});
    await expect(validatePdfCbzArchive(archive)).rejects.toThrow(/image/i);
  });
  it('rejects non-image members, invalid ZIPs, and non-image disguises',async()=>{
    await expect(validatePdfCbzArchive(Uint8Array.from([80,75,3,4,0]))).rejects.toThrow();
    await expect(validatePdfCbzArchive(zipSync({'oops.pdf':png()}))).rejects.toThrow(/unexpected file type/i);
    await expect(validatePdfCbzArchive(zipSync({'page-0001.png':Uint8Array.from([137,80,78,71,13,10,26,10])}))).rejects.toThrow();
  });
});
