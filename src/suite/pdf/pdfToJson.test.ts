import {describe,expect,it,vi} from 'vitest';
import {PDFDocument,degrees} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {inspectPdfDocumentInfo} from './pdfInfo';
import {exportPdfStructuredJson,PDF_JSON_MAX_PAGES} from './pdfToJson';

type Reader=Pick<PDFDocumentProxy,'numPages'|'getPage'|'getOutline'>;
type Fragment={str:string;hasEOL:boolean};
function fakeReader(textByPage:Fragment[][],outline:unknown=null):Reader{
  return {
    numPages:textByPage.length,
    getPage:vi.fn(async(page:number)=>({
      getTextContent:async()=>({items:textByPage[page-1]}),
    })),
    getOutline:vi.fn(async()=>outline),
  } as unknown as Reader;
}
async function sampleInfo(pages=2){
  const pdf=await PDFDocument.create();
  for(let i=0;i<pages;i++)pdf.addPage([595.28,841.89]);
  pdf.getPage(0).setRotation(degrees(90));
  pdf.setTitle('A4 research paper');
  pdf.setAuthor('MALENJO Tester');
  const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
  return {bytes,info:await inspectPdfDocumentInfo(bytes)};
}

describe('offline semantic PDF to JSON conversion',()=>{
  it('emits structured page content, A4 geometry, metadata and nested bookmark titles',async()=>{
    const {bytes,info}=await sampleInfo();
    const original=Uint8Array.from(bytes);
    const doc=fakeReader([
      [{str:'First line',hasEOL:true},{str:'next line',hasEOL:false}],
      [{str:'Second page',hasEOL:false}],
    ],[{title:'Overview',items:[{title:'Details',items:[]}]}]);
    const progress:number[]=[];
    const result=await exportPdfStructuredJson(doc,info,{
      onProgress:(done)=>progress.push(done),
    });
    const json=JSON.parse(new TextDecoder().decode(result));
    expect(json).toMatchObject({
      schemaVersion:1,extraction:'local-selectable-text',pageCount:2,
      metadata:{title:'A4 research paper',author:'MALENJO Tester'},
      pages:[
        {page:1,rotationDegrees:90,selectableTextItems:2,text:'First line\nnext line'},
        {page:2,rotationDegrees:0,selectableTextItems:1,text:'Second page'},
      ],
      bookmarks:[{title:'Overview',depth:0},{title:'Details',depth:1}],
    });
    expect(json.pages[0].widthPt).toBeCloseTo(595.28);
    expect(json.pages[1].heightPt).toBeCloseTo(841.89);
    expect(progress).toEqual([1,2]);
    expect(bytes).toEqual(original);
  });

  it('fails closed for image-only PDF pages without inventing text',async()=>{
    const {info}=await sampleInfo(1);
    await expect(exportPdfStructuredJson(fakeReader([[]]),info))
      .rejects.toThrow(/No selectable PDF text/);
  });

  it('rejects page-count mismatch, out-of-range documents and cancellation',async()=>{
    const {info}=await sampleInfo(2);
    const doc=fakeReader([[{str:'abc',hasEOL:false}]]);
    await expect(exportPdfStructuredJson(doc,info))
      .rejects.toThrow(/disagree on page count/);
    const invalid={...doc,numPages:PDF_JSON_MAX_PAGES+1};
    await expect(exportPdfStructuredJson(invalid,info))
      .rejects.toThrow(/1–2,000 pages/);
    const controller=new AbortController();
    controller.abort();
    await expect(exportPdfStructuredJson(fakeReader([
      [{str:'abc',hasEOL:false}],[{str:'def',hasEOL:false}],
    ]),info,{signal:controller.signal}))
      .rejects.toMatchObject({name:'AbortError'});
  });

  it('rejects an unbounded number of selectable text fragments',async()=>{
    const {info}=await sampleInfo(1);
    const many=Array.from({length:200_001},()=>({str:'a',hasEOL:false}));
    await expect(exportPdfStructuredJson(fakeReader([many]),info))
      .rejects.toThrow(/200,000 selectable text fragments/);
  });

  it('bounds bookmark recursion and stops on invalid titles',async()=>{
    const {info}=await sampleInfo(1);
    const content=[[{str:'abc',hasEOL:false}]];
    await expect(exportPdfStructuredJson(fakeReader(content,[{title:'x'.repeat(4097),items:[]}]),info))
      .rejects.toThrow(/bookmark title is invalid/);
    let nested={title:'Bottom',items:[] as unknown[]};
    for(let depth=0;depth<35;depth++)nested={title:'Parent',items:[nested]};
    await expect(exportPdfStructuredJson(fakeReader(content,[nested]),info))
      .rejects.toThrow(/hierarchy exceeds 32 levels/);
  });
});
