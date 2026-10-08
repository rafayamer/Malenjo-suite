import { describe,expect,it } from 'vitest';
import { PDFDocument,PDFHexString,PDFName } from 'pdf-lib';
import type { PdfProviderInputFile,PdfProviderOperationField } from './backend';
import {
  fieldAcceptsActivePdf,isPdfProviderInput,requireUnsignedPdfProviderInputs,
} from './providerFileInputs';

function file(accept?:string):PdfProviderOperationField{
  return {name:'fileInput',label:'File',kind:'file',required:true,location:'form',accept};
}

describe('provider file input compatibility',()=>{
  it('uses the active PDF only for fields that accept PDF input',()=>{
    expect(fieldAcceptsActivePdf(file())).toBe(true);
    expect(fieldAcceptsActivePdf(file('.pdf'))).toBe(true);
    expect(fieldAcceptsActivePdf(file('application/pdf'))).toBe(true);
    expect(fieldAcceptsActivePdf(file('.docx,.pptx,.xlsx,.txt'))).toBe(false);
  });

  it('refuses a signed secondary PDF before any provider operation can process it',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const signature=pdf.context.register(pdf.context.obj({
      Type:PDFName.of('Sig'),ByteRange:[0,10,20,30],
      Contents:PDFHexString.of('ABCD'),
    }));
    const fieldRef=pdf.context.register(pdf.context.obj({
      FT:PDFName.of('Sig'),V:signature,
    }));
    pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(
      pdf.context.obj({Fields:[fieldRef]}),
    ));
    const signed=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    const secondary:PdfProviderInputFile={
      field:'fileInput',filename:'import.pdf',contentType:'application/pdf',
      bytes:Array.from(signed),
    };
    expect(isPdfProviderInput(secondary)).toBe(true);
    await expect(requireUnsignedPdfProviderInputs([secondary]))
      .rejects.toThrow(/invalidate signatures/i);
    // A renamed secondary PDF is still scanned based on its actual header.
    const disguised={...secondary,filename:'import.dat',contentType:'application/octet-stream'};
    expect(isPdfProviderInput(disguised)).toBe(true);
    await expect(requireUnsignedPdfProviderInputs([disguised]))
      .rejects.toThrow(/invalidate signatures/i);
  });

  it('allows ordinary PDF inputs and non-PDF conversion assets',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const unsigned:PdfProviderInputFile={
      field:'fileInput',filename:'source.pdf',contentType:'application/pdf',
      bytes:Array.from(await pdf.save({useObjectStreams:false})),
    };
    const image:PdfProviderInputFile={
      field:'pictures',filename:'photo.png',contentType:'image/png',
      bytes:[137,80,78,71,13,10,26,10,1,2,3,4],
    };
    expect(isPdfProviderInput(image)).toBe(false);
    await expect(requireUnsignedPdfProviderInputs([image,unsigned])).resolves.toBeUndefined();
  });

  it('rejects declared PDF inputs that cannot be structurally checked',async()=>{
    const invalid:PdfProviderInputFile={
      field:'files',filename:'bad.pdf',bytes:[0,1,2],
    };
    await expect(requireUnsignedPdfProviderInputs([invalid])).rejects.toThrow();
  });
});
