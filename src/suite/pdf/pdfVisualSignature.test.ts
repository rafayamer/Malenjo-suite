import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName} from 'pdf-lib';
import {addPdfVisualSignature,PDF_VISUAL_SIGN_MAX_BYTES} from './pdfVisualSignature';

async function sample():Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  const page=pdf.addPage([612,792]);
  page.drawRectangle({x:50,y:50,width:120,height:100});
  pdf.setTitle('Original form agreement');
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
const mark={name:'Alice Smith',pageNumber:1,x:0.08,y:0.08};
describe('visual PDF signature mark with explicit non-cryptographic disclaimer',()=>{
  it('adds a labeled visible mark, preserves original and reopens the PDF',async()=>{
    const input=await sample(),snapshot=Uint8Array.from(input);
    const out=await addPdfVisualSignature(input,mark);
    const doc=await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Original form agreement');
    expect(out.length).toBeGreaterThan(input.length);
    expect(input).toEqual(snapshot);
  });
  it('refuses certification/permission dictionaries',async()=>{
    const pdf=await PDFDocument.load(await sample());
    pdf.catalog.set(PDFName.of('Perms'),pdf.context.obj({DocMDP:{}}));
    await expect(addPdfVisualSignature(Uint8Array.from(await pdf.save()),mark))
      .rejects.toThrow(/Certified/);
  });
  it('refuses signature fields before attempting to rewrite a signed form',async()=>{
    const pdf=await PDFDocument.load(await sample());
    const sig=pdf.context.obj({FT:PDFName.of('Sig'),T:'SigField'});
    const acro=pdf.context.obj({Fields:[pdf.context.register(sig)]});
    pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(acro));
    await expect(addPdfVisualSignature(Uint8Array.from(await pdf.save()),mark))
      .rejects.toThrow(/signature/i);
  });
  it('refuses invalid names, placement outside the page and improper page numbers',async()=>{
    const bytes=await sample();
    await expect(addPdfVisualSignature(bytes,{...mark,name:'\u0000'}))
      .rejects.toThrow(/name/);
    await expect(addPdfVisualSignature(bytes,{...mark,x:0.98}))
      .rejects.toThrow(/outside this page/);
    await expect(addPdfVisualSignature(bytes,{...mark,pageNumber:2}))
      .rejects.toThrow(/outside the supported/);
    await expect(addPdfVisualSignature(bytes,{...mark,fontSize:50}))
      .rejects.toThrow(/8 and 24/);
  });
  it('bounds input and refuses damaged PDFs',async()=>{
    await expect(addPdfVisualSignature(new Uint8Array(PDF_VISUAL_SIGN_MAX_BYTES+1),mark))
      .rejects.toThrow(/32 MB/);
    await expect(addPdfVisualSignature(new TextEncoder().encode('%PDF-invalid'),mark))
      .rejects.toThrow();
  });
});
