import {describe,expect,it} from 'vitest';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFNumber} from 'pdf-lib';
import {
  clearPdfPageLabelRanges,listPdfPageLabelRanges,setPdfPageLabelRange,
} from './pageLabels';

async function sample(pages=5):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  for(let i=0;i<pages;i++)pdf.addPage([300,400]);
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

describe('PDF-native logical page labels',()=>{
  it('creates multiple sorted ranges with exact Unicode prefixes and PDF spec values',async()=>{
    let bytes=await sample(5);
    bytes=await setPdfPageLabelRange(bytes,{startPage:4,style:'D',prefix:'Chapter – ',startNumber:1});
    bytes=await setPdfPageLabelRange(bytes,{startPage:1,style:'r',prefix:'',startNumber:1});
    const ranges=await listPdfPageLabelRanges(bytes);
    expect(ranges).toEqual([
      {startPage:1,style:'r',prefix:'',startNumber:1},
      {startPage:4,style:'D',prefix:'Chapter – ',startNumber:1},
    ]);
    const pdf=await PDFDocument.load(bytes);
    const nums=pdf.catalog.lookup(PDFName.of('PageLabels'),PDFDict).lookup(PDFName.of('Nums'),PDFArray);
    expect(nums.size()).toBe(4);
    expect(nums.lookup(0,PDFNumber).asNumber()).toBe(0);
    expect(nums.lookup(2,PDFNumber).asNumber()).toBe(3);
  });

  it('overwrites only the matching start-page range and can clear all labels',async()=>{
    const original=await sample();
    let bytes=await setPdfPageLabelRange(original,{startPage:2,style:'R',prefix:'Preface ',startNumber:4});
    bytes=await setPdfPageLabelRange(bytes,{startPage:2,style:'A',prefix:'Appendix ',startNumber:1});
    expect(await listPdfPageLabelRanges(bytes)).toEqual([
      {startPage:2,style:'A',prefix:'Appendix ',startNumber:1},
    ]);
    const cleared=await clearPdfPageLabelRanges(bytes);
    expect(await listPdfPageLabelRanges(cleared)).toEqual([]);
    expect(await listPdfPageLabelRanges(original)).toEqual([]);
  });

  it('rejects invalid pages, prefixes and styles without modifying input',async()=>{
    const original=await sample();
    await expect(setPdfPageLabelRange(original,{startPage:6,style:'D',prefix:'',startNumber:1}))
      .rejects.toThrow(/page/i);
    await expect(setPdfPageLabelRange(original,{startPage:1,style:'D',prefix:'\u0000',startNumber:1}))
      .rejects.toThrow(/prefix/i);
    await expect(setPdfPageLabelRange(original,{startPage:1,style:'D',prefix:'',startNumber:0}))
      .rejects.toThrow(/first number/i);
    expect(await listPdfPageLabelRanges(original)).toEqual([]);
  });

  it('refuses to destroy nested or unsupported imported number trees',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const root=pdf.context.obj({Kids:[]});
    pdf.catalog.set(PDFName.of('PageLabels'),pdf.context.register(root));
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    await expect(setPdfPageLabelRange(bytes,{startPage:1,style:'D',prefix:'',startNumber:1}))
      .rejects.toThrow(/read-only/i);
    await expect(clearPdfPageLabelRanges(bytes)).rejects.toThrow(/read-only/i);
  });

  it('supports prefix-only labels with no numeric suffix',async()=>{
    const bytes=await setPdfPageLabelRange(await sample(),{
      startPage:1,style:'none',prefix:'Cover',startNumber:1,
    });
    expect((await listPdfPageLabelRanges(bytes))[0]).toMatchObject({style:'none',prefix:'Cover'});
  });
});
