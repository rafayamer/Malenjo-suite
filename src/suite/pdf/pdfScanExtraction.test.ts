import {describe,expect,it} from 'vitest';
import {OPS} from 'pdfjs-dist';
import {findPdfScanPageNumbers} from './pdfScanExtraction';

const imageOp=(OPS as Record<string,number>).paintImageXObject;
function page(text:string,ops:number[]){
  return {
    getTextContent:async()=>({items:text?[{str:text}]:[]}),
    getOperatorList:async()=>({fnArray:ops}),
  };
}
function documentWithPages(pages:ReturnType<typeof page>[]){
  return {
    numPages:pages.length,
    getPage:async(number:number)=>pages[number-1],
  } as never;
}

describe('image-only PDF scan page detection',()=>{
  it('finds real image paint operations only on pages without selectable text',async()=>{
    expect(Number.isInteger(imageOp)).toBe(true);
    const pdf=documentWithPages([
      page('',[imageOp]),
      page('OCR recognized words',[imageOp]),
      page('',[]),
      page('',[imageOp]),
    ]);
    expect(await findPdfScanPageNumbers(pdf)).toEqual([1,4]);
  });
  it('never classifies text-only, blank, or vector-only pages as image scans',async()=>{
    const pdf=documentWithPages([page('Words',[]),page('',[]),page('Figure',[imageOp])]);
    await expect(findPdfScanPageNumbers(pdf)).rejects.toThrow(/No image-painted pages/);
  });
  it('checks page inventory and operator count bounds',async()=>{
    await expect(findPdfScanPageNumbers(documentWithPages([]))).rejects.toThrow(/1 to 50/);
    await expect(findPdfScanPageNumbers({numPages:51,getPage:()=>{throw Error('unexpected');}} as never))
      .rejects.toThrow(/1 to 50/);
    await expect(findPdfScanPageNumbers(documentWithPages([page('',Array(500_001).fill(imageOp))])))
      .rejects.toThrow(/500,000/);
  });
  it('honors user cancellation before reading the first PDF page',async()=>{
    const controller=new AbortController();
    controller.abort();
    await expect(findPdfScanPageNumbers(documentWithPages([page('',[imageOp])]),
      {signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  });
});
