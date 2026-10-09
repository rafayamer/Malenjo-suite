import {describe,expect,it,vi} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {unzipSync} from 'fflate';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PdfStructuredJson} from './pdfToJson';
import {inspectPdfDocumentInfo} from './pdfInfo';
import {
  serializePdfDocx,serializePdfRtf,serializePdfOfficeText,
  inspectPdfTextDocx,exportPdfOfficeText,PDF_OFFICE_TEXT_MAX_BYTES,
} from './pdfOfficeText';

type Reader=Pick<PDFDocumentProxy,'numPages'|'getPage'|'getOutline'>;
function reader(pages:Array<Array<{str:string;hasEOL:boolean}>>):Reader{
  return {numPages:pages.length,
    getPage:vi.fn(async(number:number)=>({getTextContent:async()=>({items:pages[number-1]})})),
    getOutline:vi.fn(async()=>null),
  } as unknown as Reader;
}
function sample(texts:string[]):PdfStructuredJson{
  return {schemaVersion:1,extraction:'local-selectable-text',pageCount:texts.length,
    metadata:{title:'MALENJO',author:null,subject:null,keywords:null,creator:null,
      producer:null,createdAt:null,modifiedAt:null},
    pages:texts.map((text,index)=>({
      page:index+1,widthPt:612,heightPt:792,rotationDegrees:0,text,
      selectableTextItems:text?1:0,
    })),
    bookmarks:[],warning:'Selectable text only',
  };
}
function decode(bytes:Uint8Array){return new TextDecoder('utf-8').decode(bytes);}
async function info(count=2){
  const document=await PDFDocument.create();
  for(let index=0;index<count;index++)document.addPage([612,792]);
  return inspectPdfDocumentInfo(Uint8Array.from(await document.save()));
}
describe('offline Word DOCX and RTF text conversions',()=>{
  it('writes valid, inspectable OpenXML DOCX parts with multiple page boundaries',()=>{
    const bytes=serializePdfDocx(sample(['First <tag> & 😀','Second\nParagraph']));
    expect(bytes.slice(0,2)).toEqual(Uint8Array.from([80,75]));
    const parts=unzipSync(bytes);
    expect(Object.keys(parts).sort()).toEqual([
      '[Content_Types].xml','_rels/.rels','word/document.xml',
    ].sort());
    const word=decode(parts['word/document.xml']);
    expect(word).toContain('First &lt;tag&gt; &amp; 😀');
    expect(word).toContain('Second');
    expect(word).toContain('Paragraph');
    expect(word).toContain('<w:br w:type="page"/>');
    expect(inspectPdfTextDocx(bytes)).toEqual({paragraphCount:4,hasPageBreak:true});
  });
  it('escapes hostile XML text and replaces forbidden XML characters',()=>{
    const data=sample(['<w:r><w:t>INJECTED</w:t></w:r> & \u0001 \uD800']);
    const text=decode(unzipSync(serializePdfDocx(data))['word/document.xml']);
    expect(text).toContain('&lt;w:r&gt;&lt;w:t&gt;INJECTED');
    expect(text).toContain('\uFFFD');
    expect(text).not.toContain('\u0001');
    expect(text).not.toContain('<w:t>INJECTED</w:t>');
  });
  it('writes escaped ASCII-compatible RTF with signed UTF-16 for Unicode',()=>{
    const text=decode(serializePdfRtf(sample(['Text {a} \\server\nEmoji 😀'])));
    expect(text).toMatch(/^\{\\rtf1\\ansi/);
    expect(text).toContain('\\{a\\}');
    expect(text).toContain('\\\\server');
    expect(text).toContain('\\par');
    expect(text).toContain('\\u-10179?\\u-8704?');
    expect(text.trimEnd().endsWith('}')).toBe(true);
  });
  it('uses actual PDF text extraction and reports progress',async()=>{
    const document=reader([
      [{str:'First',hasEOL:false}],
      [{str:'Last & valid',hasEOL:false}],
    ]);
    const progress:number[]=[];
    const pdfInfo=await info();
    const docx=await exportPdfOfficeText(document,pdfInfo,'docx',{
      onProgress:(done)=>progress.push(done),
    });
    const rtf=await exportPdfOfficeText(document,pdfInfo,'rtf');
    expect(decode(unzipSync(docx)['word/document.xml'])).toContain('Last &amp; valid');
    expect(decode(rtf)).toContain('Last & valid');
    expect(progress).toEqual([1,2]);
  });
  it('rejects scanned/textless input, metadata mismatch and already-cancelled jobs',async()=>{
    const pdfInfo=await info(1);
    await expect(exportPdfOfficeText(reader([[]]),pdfInfo,'docx'))
      .rejects.toThrow(/No selectable PDF text/);
    await expect(exportPdfOfficeText(reader([
      [{str:'A',hasEOL:false}],[{str:'B',hasEOL:false}],
    ]),pdfInfo,'rtf')).rejects.toThrow(/disagree on page count/);
    const controller=new AbortController();controller.abort();
    await expect(exportPdfOfficeText(reader([[{str:'A',hasEOL:false}]]),
      pdfInfo,'docx',{signal:controller.signal}))
      .rejects.toMatchObject({name:'AbortError'});
  });
  it('refuses oversized DOCX/RTF output and false page sequences',()=>{
    expect(()=>serializePdfDocx(sample(['&'.repeat(PDF_OFFICE_TEXT_MAX_BYTES)])))
      .toThrow(/16 MB/);
    expect(()=>serializePdfRtf(sample(['x'.repeat(PDF_OFFICE_TEXT_MAX_BYTES)])))
      .toThrow(/16 MB/);
    const data=sample(['Test']);data.pages[0].page=10;
    expect(()=>serializePdfOfficeText(data,'docx')).toThrow(/page sequence/);
  });
  it('rejects malformed or incomplete DOCX output during inspection',()=>{
    expect(()=>inspectPdfTextDocx(Uint8Array.from([80,75,3,4])))
      .toThrow();
  });
});
