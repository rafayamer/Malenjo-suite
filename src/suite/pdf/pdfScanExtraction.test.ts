import {describe,expect,it,vi} from 'vitest';
import {unzipSync} from 'fflate';
import {OPS} from 'pdfjs-dist';
import {findPdfScanPageNumbers,extractPdfImageScanPages} from './pdfScanExtraction';

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

describe('scan export ZIP with actual PNG bytes',()=>{
  it('saves only image-only PDF pages under their original source page numbers',async()=>{
    // A known one-pixel PNG with corrected IDAT CRC (the common minimal
    // fixture has a corrupt CRC and is intentionally NOT reused here).
    const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    const png=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const canvas={
      width:0,height:0,
      getContext:()=>({}),
      toBlob:(done:(value:Blob)=>void)=>{
        const safe=new Uint8Array(new ArrayBuffer(png.byteLength));safe.set(png);
        done(new Blob([safe],{type:'image/png'}));
      },
    };
    vi.stubGlobal('document',{createElement:()=>canvas});
    try{
      const scanPage={
        ...page('',[imageOp]),
        getViewport:()=>({width:1,height:1}),
        render:()=>({promise:Promise.resolve(),cancel:()=>{}}),
      };
      const mixed=documentWithPages([page('title',[]),scanPage,page('caption',[imageOp])]);
      const result=await extractPdfImageScanPages(mixed);
      expect(result.originalPages).toEqual([2]);
      const files=unzipSync(result.archive);
      expect(Object.keys(files)).toEqual(['scan-original-page-0002.png']);
      expect(files['scan-original-page-0002.png']).toEqual(png);
      expect(canvas.width).toBe(0);expect(canvas.height).toBe(0);
    }finally{vi.unstubAllGlobals();}
  });
});
