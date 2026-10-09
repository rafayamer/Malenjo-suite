import {describe,expect,it,vi} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PdfStructuredJson} from './pdfToJson';
import {inspectPdfDocumentInfo} from './pdfInfo';
import {exportPdfTextFormat,serializePdfTextFormat,PDF_TEXT_FORMAT_MAX_BYTES} from './pdfTextFormats';

type Reader=Pick<PDFDocumentProxy,'numPages'|'getPage'|'getOutline'>;
function reader(pages:Array<Array<{str:string;hasEOL:boolean}>>):Reader{
  return {
    numPages:pages.length,
    getPage:vi.fn(async(number:number)=>({
      getTextContent:async()=>({items:pages[number-1]}),
    })),
    getOutline:vi.fn(async()=>null),
  } as unknown as Reader;
}
function fixture(text:string,heading='PDF demo'):PdfStructuredJson{
  return {
    schemaVersion:1,extraction:'local-selectable-text',pageCount:1,
    metadata:{title:heading,author:null,subject:null,keywords:null,
      creator:null,producer:null,createdAt:null,modifiedAt:null},
    pages:[{page:1,widthPt:612,heightPt:792,rotationDegrees:0,
      selectableTextItems:1,text}],bookmarks:[],warning:'Text only',
  };
}
async function metadata(){
  const pdf=await PDFDocument.create();
  pdf.addPage([612,792]);pdf.setTitle('Source PDF');
  return inspectPdfDocumentInfo(Uint8Array.from(await pdf.save()));
}
const decode=(bytes:Uint8Array)=>new TextDecoder().decode(bytes);
describe('offline PDF Markdown HTML and CSV export',()=>{
  it('preserves Unicode but neutralizes HTML/script payloads and disallows remote resources',()=>{
    const html=decode(serializePdfTextFormat(fixture('<script>alert("XSS")</script> & 😀'),'html'));
    expect(html).toContain('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt; &amp; 😀');
    expect(html).not.toContain('<script>');
    expect(html).toContain('default-src &#39;none&#39;');
    expect(html).toContain('<pre>');
  });
  it('escapes Markdown control characters rather than interpreting PDF text as markup',()=>{
    const md=decode(serializePdfTextFormat(fixture('# heading\n<script>**bold** [link](url)'),'markdown'));
    expect(md).toContain('## Page 1');
    expect(md).toContain('\\# heading');
    expect(md).toContain('\\*\\*bold\\*\\*');
    expect(md).toContain('\\[link\\]\\(url\\)');
    expect(md).toContain('<script>');
  });
  it('preserves multiline CSV text and blocks spreadsheet formulas in any cell',()=>{
    const csv=decode(serializePdfTextFormat(fixture(' \t=HYPERLINK("evil")\nnext'),'csv'));
    expect(csv).toContain('"page","text"');
    expect(csv).toContain('"\' \t=HYPERLINK(""evil"")\nnext"');
    expect(csv).toMatch(/^\uFEFF/);
  });
  it('exports actual PDF info with page-indexed local text and progress',async()=>{
    const info=await metadata(),seen:number[]=[];
    const doc=reader([[{str:'First page',hasEOL:false}]]);
    for(const format of ['markdown','html','csv'] as const){
      const bytes=await exportPdfTextFormat(doc,info,format,{
        onProgress:(done)=>seen.push(done),
      });
      const output=decode(bytes);
      expect(output).toContain('First page');
      expect(output).toContain('Source PDF');
      expect(bytes.length).toBeLessThan(PDF_TEXT_FORMAT_MAX_BYTES);
    }
    expect(seen).toEqual([1,1,1]);
  });
  it('refuses textless scanned pages, inconsistent source and aborted requests',async()=>{
    const info=await metadata();
    await expect(exportPdfTextFormat(reader([[]]),info,'markdown')).rejects.toThrow(/No selectable PDF text/);
    await expect(exportPdfTextFormat(reader([[{str:'A',hasEOL:false}],[{str:'B',hasEOL:false}]]),info,'html'))
      .rejects.toThrow(/disagree on page count/);
    const controller=new AbortController();controller.abort();
    await expect(exportPdfTextFormat(reader([[{str:'A',hasEOL:false}]]),info,'csv',{
      signal:controller.signal,
    })).rejects.toMatchObject({name:'AbortError'});
  });
  it('refuses oversized results and incorrect page order without writing partial exports',()=>{
    expect(()=>serializePdfTextFormat(fixture('x'.repeat(PDF_TEXT_FORMAT_MAX_BYTES)),'html'))
      .toThrow(/16 MB/);
    const wrong=fixture('valid');
    wrong.pages[0].page=2;
    expect(()=>serializePdfTextFormat(wrong,'markdown')).toThrow(/page order/);
  });
});
