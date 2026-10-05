import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  appendPdf, deletePdfPage, duplicatePdfPage, extractPdfPage,
  insertBlankPdfPage, movePdfPage, rotatePdfPagePermanent,
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

  it('moves pages and permanently rotates a page',async()=>{
    const bytes=await sample(3);
    const moved=await movePdfPage(bytes,1,3);
    const movedPdf=await PDFDocument.load(moved);
    expect(movedPdf.getPage(2).getSize().width).toBe(300);

    const rotated=await rotatePdfPagePermanent(bytes,1);
    const rotatedPdf=await PDFDocument.load(rotated);
    expect(rotatedPdf.getPage(0).getRotation().angle).toBe(90);
  });
});
