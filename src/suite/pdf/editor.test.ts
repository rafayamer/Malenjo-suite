import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  addPdfRectangleOverlay, addPdfTextOverlay, appendPdf, deletePdfPage, deletePdfPages, duplicatePdfPage, extractPdfPage, extractPdfPages,
  insertBlankPdfPage, insertPdfAfter, movePdfPage, rotatePdfPagePermanent, rotatePdfPagesPermanent, splitPdfAtPage,
} from './editor';

async function sample(pages=3):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  for(let i=0;i<pages;i+=1)pdf.addPage([300+i,400+i]);
  return Uint8Array.from(await pdf.save());
}

async function count(bytes:Uint8Array):Promise<number>{
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('PDF mutation core',()=>{
  it('deletes while preserving at least one page',async()=>{
    const bytes=await sample(3);
    expect(await count(await deletePdfPage(bytes,2))).toBe(2);
    await expect(deletePdfPage(await sample(1),1)).rejects.toThrow(/at least one page/i);
  });

  it('duplicates, extracts, appends and inserts blank pages',async()=>{
    const bytes=await sample(2);
    expect(await count(await duplicatePdfPage(bytes,1))).toBe(3);
    expect(await count(await extractPdfPage(bytes,2))).toBe(1);
    expect(await count(await appendPdf(bytes,await sample(3)))).toBe(5);
    expect(await count(await insertBlankPdfPage(bytes,1))).toBe(3);
  });

  it('batch deletes, rotates and extracts selected pages',async()=>{
    const source=await sample(4);
    expect(await count(await deletePdfPages(source,[2,4]))).toBe(2);
    await expect(deletePdfPages(source,[1,2,3,4])).rejects.toThrow(/at least one page/i);

    const rotated=await rotatePdfPagesPermanent(source,[1,3]);
    const rotatedPdf=await PDFDocument.load(rotated);
    expect(rotatedPdf.getPage(0).getRotation().angle).toBe(90);
    expect(rotatedPdf.getPage(1).getRotation().angle).toBe(0);
    expect(rotatedPdf.getPage(2).getRotation().angle).toBe(90);

    const extracted=await extractPdfPages(source,[4,2]);
    const extractedPdf=await PDFDocument.load(extracted);
    expect(extractedPdf.getPageCount()).toBe(2);
    expect(extractedPdf.getPage(0).getSize().width).toBe(301);
    expect(extractedPdf.getPage(1).getSize().width).toBe(303);
  });

  it('inserts another PDF at the active location and splits at a page boundary',async()=>{
    const source=await sample(3);
    const inserted=await insertPdfAfter(source,await sample(2),1);
    const insertedPdf=await PDFDocument.load(inserted);
    expect(insertedPdf.getPageCount()).toBe(5);
    expect(insertedPdf.getPage(0).getSize().width).toBe(300);
    expect(insertedPdf.getPage(1).getSize().width).toBe(300);
    expect(insertedPdf.getPage(3).getSize().width).toBe(301);

    const [left,right]=await splitPdfAtPage(source,2);
    expect(await count(left)).toBe(2);
    expect(await count(right)).toBe(1);
    await expect(splitPdfAtPage(source,3)).rejects.toThrow(/before the last/i);
  });

  it('moves pages and permanently rotates a page',async()=>{
    const bytes=await sample(3);
    const moved=await movePdfPage(bytes,1,3);
    const movedPdf=await PDFDocument.load(moved);
    expect(movedPdf.getPage(2).getSize().width).toBe(300);

    const rotated=await rotatePdfPagePermanent(bytes,1);
    const rotatedPdf=await PDFDocument.load(rotated);
    expect(rotatedPdf.getPage(0).getRotation().angle).toBe(90);
  });
  it('adds permanent text and rectangle overlays without changing page count',async()=>{
    const bytes=await sample(2);
    const withText=await addPdfTextOverlay(bytes,{pageNumber:1,text:'MALENJO note',x:0.1,y:0.8,size:12});
    expect(await count(withText)).toBe(2);
    const withHighlight=await addPdfRectangleOverlay(withText,{pageNumber:1,x:0.1,y:0.7,width:0.3,height:0.08,mode:'highlight'});
    expect(await count(withHighlight)).toBe(2);
  });

  it('rejects overlay coordinates outside the page',async()=>{
    const bytes=await sample(1);
    await expect(addPdfRectangleOverlay(bytes,{pageNumber:1,x:0.9,y:0.1,width:0.2,height:0.2})).rejects.toThrow(/inside the page/i);
    await expect(addPdfTextOverlay(bytes,{pageNumber:1,text:'x',x:1.1,y:0.2,size:12})).rejects.toThrow(/between 0 and 1/i);
  });
});
