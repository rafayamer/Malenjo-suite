import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName,StandardFonts,degrees} from 'pdf-lib';
import {fitPdfToPaper,PDF_PAPER_SIZES} from './pdfPaperResize';

async function sample(pages=2):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=0;i<pages;i++){
    const page=pdf.addPage([612,792]);
    page.drawText('MALENJO page '+(i+1),{x:48,y:700,font,size:14});
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
const read=(bytes:Uint8Array)=>PDFDocument.load(bytes,{updateMetadata:false});
describe('native PDF paper-size fitting',()=>{
  it('resizes every page to portrait A4 with independently reopenable output',async()=>{
    const original=await sample();
    const output=await fitPdfToPaper(original,{paper:'A4',orientation:'portrait',marginPt:18});
    const reopened=await read(output);
    expect(reopened.getPageCount()).toBe(2);
    for(const page of reopened.getPages()){
      expect(page.getWidth()).toBeCloseTo(PDF_PAPER_SIZES.A4[0],2);
      expect(page.getHeight()).toBeCloseTo(PDF_PAPER_SIZES.A4[1],2);
      expect(page.node.Contents()).toBeDefined();
    }
    expect(Array.from(original)).not.toEqual(Array.from(output));
    const untouched=await read(original);
    expect(untouched.getPage(0).getWidth()).toBe(612);
  });
  it('scales portrait source onto landscape Letter and legal sheets',async()=>{
    const input=await sample(1);
    for(const paper of ['Letter','Legal'] as const){
      const output=await fitPdfToPaper(input,{paper,orientation:'landscape',marginPt:24});
      const doc=await read(output);
      expect(doc.getPage(0).getWidth()).toBe(PDF_PAPER_SIZES[paper][1]);
      expect(doc.getPage(0).getHeight()).toBe(PDF_PAPER_SIZES[paper][0]);
    }
  });
  it('refuses invalid options and unreadable inputs',async()=>{
    const bytes=await sample(1);
    await expect(fitPdfToPaper(bytes,{paper:'A4',orientation:'portrait',marginPt:-1})).rejects.toThrow(/Margin/);
    await expect(fitPdfToPaper(bytes,{paper:'A4',orientation:'portrait',marginPt:Infinity})).rejects.toThrow(/Margin/);
    await expect(fitPdfToPaper(bytes,{paper:'A4',orientation:'sideways' as 'portrait',marginPt:0})).rejects.toThrow(/size and orientation/);
    await expect(fitPdfToPaper(new Uint8Array(),{paper:'A4',orientation:'portrait',marginPt:0})).rejects.toThrow(/512 MB/);
    await expect(fitPdfToPaper(new Uint8Array([1,2,3,4]),{paper:'A4',orientation:'portrait',marginPt:0})).rejects.toThrow();
  });
  it('refuses any AcroForm because moving widgets could invalidate user data',async()=>{
    const doc=await read(await sample(1));
    const field=doc.getForm().createTextField('member');
    field.addToPage(doc.getPage(0),{x:20,y:20,width:100,height:20});
    await expect(fitPdfToPaper(Uint8Array.from(await doc.save()),{
      paper:'A4',orientation:'portrait',marginPt:0,
    })).rejects.toThrow(/form or signature/);
  });
  it('refuses annotations and custom crop boxes instead of dropping geometry',async()=>{
    const doc=await read(await sample(1));
    doc.getPage(0).node.set(PDFName.of('Annots'),doc.context.obj([]));
    await expect(fitPdfToPaper(Uint8Array.from(await doc.save()),{
      paper:'A4',orientation:'portrait',marginPt:0,
    })).rejects.toThrow(/annotations or links/);
    const crop=await read(await sample(1));
    crop.getPage(0).setCropBox(5,5,100,120);
    await expect(fitPdfToPaper(Uint8Array.from(await crop.save()),{
      paper:'A4',orientation:'portrait',marginPt:0,
    })).rejects.toThrow(/custom page boxes/);
  });
  it('refuses rotated pages to avoid changing visual orientation',async()=>{
    const doc=await read(await sample(1));
    doc.getPage(0).setRotation(degrees(90));
    await expect(fitPdfToPaper(Uint8Array.from(await doc.save()),{
      paper:'A4',orientation:'portrait',marginPt:0,
    })).rejects.toThrow(/rotated/);
  });
});
