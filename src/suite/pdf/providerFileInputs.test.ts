import { describe,expect,it } from 'vitest';
import { PDFDocument,PDFHexString,PDFName } from 'pdf-lib';
import type { PdfProviderInputFile,PdfProviderOperationField } from './backend';
import {
  fieldAcceptsActivePdf,isPdfProviderInput,providerOperationMayRewritePdfInputs,requireUnsignedPdfProviderInputs,
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

  it('passes signed PDFs to the explicitly read-only ValidateSignature tool',()=>{
    expect(providerOperationMayRewritePdfInputs({id:'ValidateSignature',category:'sign'})).toBe(false);
    expect(providerOperationMayRewritePdfInputs({id:'validateSignature',category:'sign'})).toBe(false);
    expect(providerOperationMayRewritePdfInputs({id:'Merge',category:'organize'})).toBe(true);
    expect(providerOperationMayRewritePdfInputs({id:'Sign',category:'sign'})).toBe(true);
    expect(providerOperationMayRewritePdfInputs({id:'ValidateSignature',category:'organize'})).toBe(true);
    expect(providerOperationMayRewritePdfInputs({id:'ValidateSignatureButRewrite',category:'sign'})).toBe(true);
  });

  it('does not treat PDF marker text in an HTML or TXT file as a PDF',async()=>{
    const encoder=new TextEncoder();
    const plain:PdfProviderInputFile={
      field:'fileInput',filename:'notes.txt',contentType:'text/plain',
      bytes:Array.from(encoder.encode('Header: example\\nThe text says %PDF-1.7 inside it.')),
    };
    const html:PdfProviderInputFile={
      field:'fileInput',filename:'sample.html',contentType:'text/html',
      bytes:Array.from(encoder.encode('<p>Reference: %PDF-1.7</p>')),
    };
    expect(isPdfProviderInput(plain)).toBe(false);
    expect(isPdfProviderInput(html)).toBe(false);
    await expect(requireUnsignedPdfProviderInputs([plain,html])).resolves.toBeUndefined();
  });

  it('recognizes disguised PDFs behind a long whitespace prefix',()=>{
    const leading=Array.from({length:600},()=>32);
    const header=Array.from(new TextEncoder().encode('%PDF-1.7\n'));
    const disguised:PdfProviderInputFile={
      field:'fileInput',filename:'merged.bin',contentType:'application/octet-stream',
      bytes:[...leading,...header,0,0],
    };
    expect(isPdfProviderInput(disguised)).toBe(true);
    const bom={...disguised,bytes:[239,187,191,...leading,...header]};
    expect(isPdfProviderInput(bom)).toBe(true);
    // A bare occurrence in prose is not a valid header prefix.
    expect(isPdfProviderInput({
      ...disguised,bytes:Array.from(new TextEncoder().encode('Report: %PDF-1.7')),
    })).toBe(false);
  });
});
