import {describe,expect,it} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {zipSync} from 'fflate';
import {verifyProviderCompletion} from './pdfProviderCompletion';
import type {PdfProviderResponse} from './backend';
const response=(bytes:number[],contentType:string):PdfProviderResponse=>({bytes,contentType,status:200});

describe('provider completion safety outside the 20-workflow manifest',()=>{
  it('opens each PDF in ZIP results for both existing split endpoints',async()=>{
    const pdf=await PDFDocument.create();pdf.addPage([300,400]);
    const bytes=Uint8Array.from(await pdf.save());
    const good=response(Array.from(zipSync({'part.pdf':bytes})),'application/zip');
    for(const route of ['/api/v1/general/split-pages','/api/v1/general/split-by-size-or-count']){
      await expect(verifyProviderCompletion(route,'save-file',good,true)).resolves.toBeUndefined();
      await expect(verifyProviderCompletion(route,'save-file',response([80,75,3,4,0,0], 'application/zip'),true)).rejects.toThrow();
      await expect(verifyProviderCompletion(route,'save-file',response(Array.from(zipSync({'part.pdf':Uint8Array.from([37,80,68,70,45])})),'application/zip'),true)).rejects.toThrow(/PDF/);
      await expect(verifyProviderCompletion(route,'apply-pdf',response(Array.from(bytes),'application/pdf'),true)).rejects.toThrow(/ZIP/);
    }
  });
  it('reopens PDF mutations before saving a detached upload with no working document',async()=>{
    const pdf=await PDFDocument.create();pdf.addPage([200,300]);
    const bytes=Array.from(await pdf.save());
    await expect(verifyProviderCompletion('/api/v1/general/crop','apply-pdf',response(bytes,'application/pdf'),false)).resolves.toBeUndefined();
    await expect(verifyProviderCompletion('/api/v1/general/crop','apply-pdf',response([37,80,68,70,45],'application/pdf'),false)).rejects.toThrow(/reopened/);
    // When active, onApplyPdf owns the parser/revision check instead.
    await expect(verifyProviderCompletion('/api/v1/general/crop','apply-pdf',response([37,80,68,70,45],'application/pdf'),true)).resolves.toBeUndefined();
  });
});
