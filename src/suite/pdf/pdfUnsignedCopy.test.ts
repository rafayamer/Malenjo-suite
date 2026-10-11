import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName} from 'pdf-lib';
import {createUnsignedRasterPdfCopy} from './pdfUnsignedCopy';

async function pdf(signed:boolean):Promise<Uint8Array>{
 const doc=await PDFDocument.create();
 doc.addPage([100,200]);
 if(signed)doc.context.register(doc.context.obj({Type:PDFName.of('Sig'),ByteRange:[0,12,45,22]}));
 return Uint8Array.from(await doc.save());
}
const reader={numPages:1,getPage:async()=>{throw Error('No render in injection test');}} as never;
describe('explicit non-cryptographic signed PDF flattening',()=>{
 it('keeps source bytes and emits an independently unsigned PDF copy',async()=>{
   const data=await pdf(true),original=Uint8Array.from(data);
   const result=await createUnsignedRasterPdfCopy(data,reader,{
     rasterize:async()=>{
       const unsigned=await PDFDocument.create();
       unsigned.addPage([100,200]);
       return Uint8Array.from(await unsigned.save());
     },
   });
   expect(data).toEqual(original);
   expect(result.invalidatedSignatureObjects).toBeGreaterThan(0);
   const reopened=await PDFDocument.load(result.bytes);
   expect(reopened.getPageCount()).toBe(1);
   expect(reopened.context.enumerateIndirectObjects().some(([,o])=>o.toString().includes('/ByteRange'))).toBe(false);
 });
 it('refuses unsigned originals, oversized source and bad unsigned output',async()=>{
   await expect(createUnsignedRasterPdfCopy(await pdf(false),reader))
      .rejects.toThrow(/No certificate signature/);
   await expect(createUnsignedRasterPdfCopy(new Uint8Array(),reader))
      .rejects.toThrow(/32 MB/);
   const signed=await pdf(true);
   await expect(createUnsignedRasterPdfCopy(signed,reader,{rasterize:async()=>signed}))
      .rejects.toThrow(/without cryptographic/);
 });
 it('honors cancellation before producing a rewritten copy',async()=>{
   const c=new AbortController();c.abort();
   await expect(createUnsignedRasterPdfCopy(await pdf(true),reader,{signal:c.signal}))
     .rejects.toMatchObject({name:'AbortError'});
 });
});
