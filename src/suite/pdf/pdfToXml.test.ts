import {describe,expect,it,vi} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {inspectPdfDocumentInfo} from './pdfInfo';
import type {PdfStructuredJson} from './pdfToJson';
import {exportPdfStructuredXml,serializePdfStructuredXml,PDF_XML_MAX_OUTPUT_BYTES} from './pdfToXml';

type Reader=Pick<PDFDocumentProxy,'numPages'|'getPage'|'getOutline'>;
function fakeReader(items:Array<Array<{str:string;hasEOL:boolean}>>,outline:unknown=null):Reader{
  return {
    numPages:items.length,
    getPage:vi.fn(async(page:number)=>({
      getTextContent:async()=>({items:items[page-1]}),
    })),
    getOutline:vi.fn(async()=>outline),
  } as unknown as Reader;
}

function structured(text:string):PdfStructuredJson{
  return {
    schemaVersion:1,extraction:'local-selectable-text',pageCount:1,
    metadata:{
      title:'R&D <summary> "beta"',author:'O\'Malley',subject:null,
      keywords:null,creator:null,producer:null,createdAt:null,modifiedAt:null,
    },
    pages:[{page:1,widthPt:595,heightPt:842,rotationDegrees:0,selectableTextItems:1,text}],
    bookmarks:[{title:'Chapter & introduction',depth:0}],
    warning:'Selectable text only; not a full PDF representation.',
  };
}

async function info(){
  const pdf=await PDFDocument.create();
  pdf.addPage([595,842]);
  pdf.setTitle('Local document');
  const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
  return {bytes,metadata:await inspectPdfDocumentInfo(bytes)};
}

describe('offline PDF to structured XML',()=>{
  it('escapes text, metadata and bookmark attributes without corrupting Unicode',()=>{
    const xml=new TextDecoder().decode(serializePdfStructuredXml(structured(
      'A & B < C > D "quote" O\'Malley\nEmoji 😀 \u0001',
    )));
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<title>R&amp;D &lt;summary&gt; &quot;beta&quot;</title>');
    expect(xml).toContain('<author>O&apos;Malley</author>');
    expect(xml).toContain('title="Chapter &amp; introduction"');
    expect(xml).toContain('width-pt="595" height-pt="842"');
    expect(xml).toContain('A &amp; B &lt; C &gt; D &quot;quote&quot; O&apos;Malley&#10;Emoji 😀 \uFFFD');
    expect(xml).not.toContain('\u0001');
    expect(xml).toContain('</malenjo-pdf>');
  });

  it('reads actual PDF metadata and emits one XML page per selectable-text page without altering the input',async()=>{
    const {bytes,metadata}=await info();
    const snapshot=Uint8Array.from(bytes);
    const doc=fakeReader([[{str:'First <page> & content',hasEOL:false}]],[{
      title:'Start',items:[],
    }]);
    const progress:number[]=[];
    const result=await exportPdfStructuredXml(doc,metadata,{
      onProgress:(done)=>progress.push(done),
    });
    const xml=new TextDecoder().decode(result);
    expect(xml).toContain('page-count="1"');
    expect(xml).toContain('<title>Local document</title>');
    expect(xml).toContain('First &lt;page&gt; &amp; content');
    expect(xml).toContain('<bookmark depth="0" title="Start"/>');
    expect(progress).toEqual([1]);
    expect(bytes).toEqual(snapshot);
  });

  it('refuses image-only PDFs, mismatched page counts and cancellation',async()=>{
    const {metadata}=await info();
    await expect(exportPdfStructuredXml(fakeReader([[]]),metadata))
      .rejects.toThrow(/No selectable PDF text/);
    await expect(exportPdfStructuredXml(fakeReader([
      [{str:'one',hasEOL:false}],[{str:'two',hasEOL:false}],
    ]),metadata)).rejects.toThrow(/disagree on page count/);
    const controller=new AbortController();
    controller.abort();
    await expect(exportPdfStructuredXml(fakeReader([
      [{str:'text',hasEOL:false}],
    ]),metadata,{signal:controller.signal}))
      .rejects.toMatchObject({name:'AbortError'});
  });

  it('rejects excessive escaped output rather than creating unbounded XML',()=>{
    expect(PDF_XML_MAX_OUTPUT_BYTES).toBe(16_000_000);
    expect(()=>serializePdfStructuredXml(structured('&'.repeat(3_300_000))))
      .toThrow(/16 MB safety limit/);
  });
});
