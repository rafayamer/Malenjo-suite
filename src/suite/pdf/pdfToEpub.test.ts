import {describe,expect,it,vi} from 'vitest';
import {unzipSync,zipSync} from 'fflate';
import {PDFDocument} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PdfStructuredJson} from './pdfToJson';
import {inspectPdfDocumentInfo} from './pdfInfo';
import {serializePdfEpub,inspectPdfEpubArchive,exportPdfEpub,PDF_EPUB_MAX_BYTES} from './pdfToEpub';

function fixture(pages:string[]):PdfStructuredJson{
  return {schemaVersion:1,extraction:'local-selectable-text',pageCount:pages.length,
    metadata:{title:'Title & <script>',author:null,subject:null,keywords:null,
      creator:null,producer:null,createdAt:null,modifiedAt:null},
    pages:pages.map((text,index)=>({page:index+1,widthPt:612,heightPt:792,
      rotationDegrees:0,selectableTextItems:1,text})),bookmarks:[],warning:'Text only',
  };
}
const decode=(bytes:Uint8Array)=>new TextDecoder().decode(bytes);
function reader(items:string[][]):Pick<PDFDocumentProxy,'numPages'|'getPage'|'getOutline'>{
  return {numPages:items.length,
    getPage:vi.fn(async(n:number)=>({getTextContent:async()=>({
      items:items[n-1].map(str=>({str,hasEOL:false})),
    })})),
    getOutline:vi.fn(async()=>null),
  } as unknown as Pick<PDFDocumentProxy,'numPages'|'getPage'|'getOutline'>;
}
async function info(count=2){
  const pdf=await PDFDocument.create();
  for(let i=0;i<count;i++)pdf.addPage([612,792]);
  return inspectPdfDocumentInfo(Uint8Array.from(await pdf.save()));
}
describe('offline selectable PDF text to EPUB 3',()=>{
  it('builds spec-compatible uncompressed first mimetype, package spine and navigable XHTML',()=>{
    const result=serializePdfEpub(fixture(['Alpha & <script>alert(1)</script>','Second 😀']));
    expect(result.slice(0,4)).toEqual(Uint8Array.from([80,75,3,4]));
    expect(result[8]).toBe(0);expect(result[9]).toBe(0);
    const files=unzipSync(result);
    expect(decode(files.mimetype)).toBe('application/epub+zip');
    expect(decode(files['OEBPS/content.opf'])).toContain('version="3.0"');
    expect(decode(files['OEBPS/content.opf'])).toContain('href="nav.xhtml"');
    expect(decode(files['OEBPS/text.xhtml'])).toContain('Alpha &amp; &lt;script&gt;');
    expect(decode(files['OEBPS/text.xhtml'])).not.toContain('<script>');
    expect(decode(files['OEBPS/text.xhtml'])).toContain('Second 😀');
    expect(inspectPdfEpubArchive(result)).toEqual({pageLinks:2,hasText:true});
  });
  it('preserves line breaks as separate paragraphs and neutralizes XML-invalid controls',()=>{
    const out=serializePdfEpub(fixture(['First\nSecond & \u0001']));
    const text=decode(unzipSync(out)['OEBPS/text.xhtml']);
    expect(text).toContain('<p>First</p><p>Second &amp; \uFFFD</p>');
    expect(text).not.toContain('\u0001');
  });
  it('exports actual PDF page text offline, retains progress and never modifies source',async()=>{
    const meta=await info();
    const seen:number[]=[];
    const result=await exportPdfEpub(reader([['Page A'],['Page B']]),meta,{
      onProgress:(done)=>seen.push(done),
    });
    expect(inspectPdfEpubArchive(result).pageLinks).toBe(2);
    expect(decode(unzipSync(result)['OEBPS/text.xhtml'])).toContain('Page B');
    expect(seen).toEqual([1,2]);
  });
  it('rejects scanned PDFs, wrong page counts and cancellation',async()=>{
    const meta=await info(1);
    await expect(exportPdfEpub(reader([[]]),meta)).rejects.toThrow(/No selectable PDF text/);
    await expect(exportPdfEpub(reader([['a'],['b']]),meta)).rejects.toThrow(/disagree on page count/);
    const controller=new AbortController();controller.abort();
    await expect(exportPdfEpub(reader([['valid']]),meta,{signal:controller.signal}))
      .rejects.toMatchObject({name:'AbortError'});
  });
  it('refuses excessive XHTML and forged first EPUB member',()=>{
    expect(()=>serializePdfEpub(fixture(['&'.repeat(3_300_000)])))
      .toThrow(/16 MB/);
    expect(()=>inspectPdfEpubArchive(zipSync({
      'fake.txt':[new TextEncoder().encode('bad'),{level:0}],
      'mimetype':new TextEncoder().encode('application/epub+zip'),
    }))).toThrow(/first archive member/);
  });
});
