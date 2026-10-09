import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName,degrees} from 'pdf-lib';
import {
  planPdfBooklet,imposePdfBooklet,
  PDF_BOOKLET_MAX_INPUT_BYTES,PDF_BOOKLET_MAX_PAGES,
} from './pdfBooklet';
async function sample(count:number){
  const pdf=await PDFDocument.create();
  for(let i=0;i<count;i++){
    const page=pdf.addPage([200+i*10,300]);
    page.drawRectangle({x:10,y:10,width:30+i,height:40});
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
describe('offline saddle-stitched PDF booklet',()=>{
  it('plans correct two-sided, left-to-right sheet imposition with blank padding',()=>{
    expect(planPdfBooklet(8)).toEqual([
      {sheet:1,side:'front',left:8,right:1},
      {sheet:1,side:'back',left:2,right:7},
      {sheet:2,side:'front',left:6,right:3},
      {sheet:2,side:'back',left:4,right:5},
    ]);
    expect(planPdfBooklet(5)).toEqual([
      {sheet:1,side:'front',left:null,right:1},
      {sheet:1,side:'back',left:2,right:null},
      {sheet:2,side:'front',left:null,right:3},
      {sheet:2,side:'back',left:4,right:5},
    ]);
  });
  it('embeds actual vector pages in a reopenable two-up landscape PDF without changing the input',async()=>{
    const bytes=await sample(5),original=Uint8Array.from(bytes);
    const booklet=await imposePdfBooklet(bytes);
    const pdf=await PDFDocument.load(booklet);
    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.getPage(0).getWidth()).toBe(480);
    expect(pdf.getPage(0).getHeight()).toBe(300);
    expect(bytes).toEqual(original);
    const resources=pdf.getPage(0).node.Resources();
    expect(resources?.toString()).toBeTruthy();
  });
  it('refuses interactive fields and annotations before dropping widgets or links',async()=>{
    const pdf=await PDFDocument.create();
    const page=pdf.addPage([200,300]);
    pdf.getForm().createTextField('name').addToPage(page,{x:20,y:20,width:80,height:20});
    await expect(imposePdfBooklet(Uint8Array.from(await pdf.save())))
      .rejects.toThrow(/forms, signatures/);
    const plain=await PDFDocument.create();
    const linkPage=plain.addPage([200,300]);
    const link=plain.context.obj({Subtype:PDFName.of('Link'),Rect:[0,0,20,20]});
    linkPage.node.set(PDFName.of('Annots'),plain.context.obj([link]));
    await expect(imposePdfBooklet(Uint8Array.from(await plain.save())))
      .rejects.toThrow(/annotations/);
  });
  it('rejects rotated page boxes and improper dimensions',async()=>{
    const doc=await PDFDocument.create();
    doc.addPage([200,300]).setRotation(degrees(90));
    await expect(imposePdfBooklet(Uint8Array.from(await doc.save())))
      .rejects.toThrow(/rotated/);
    const wrong=await PDFDocument.create();
    wrong.addPage([7500,300]);
    await expect(imposePdfBooklet(Uint8Array.from(await wrong.save())))
      .rejects.toThrow(/dimensions/);
  });
  it('enforces page/input bounds and malformed PDF refusal',async()=>{
    expect(()=>planPdfBooklet(0)).toThrow(/1–200/);
    expect(()=>planPdfBooklet(PDF_BOOKLET_MAX_PAGES+1)).toThrow(/1–200/);
    await expect(imposePdfBooklet(new Uint8Array(PDF_BOOKLET_MAX_INPUT_BYTES+1)))
      .rejects.toThrow(/32 MB/);
    await expect(imposePdfBooklet(new Uint8Array([37,80,68,70,45])))
      .rejects.toThrow();
  });
});
