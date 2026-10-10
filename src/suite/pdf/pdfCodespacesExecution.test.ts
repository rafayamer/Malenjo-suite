/* Real, on-disk Codespaces execution. No mocked PDF providers or outputs.
   Run npm run test:pdf-execution. This does not certify 90/90 parity. */
import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import {PDFDocument,StandardFonts} from 'pdf-lib';
// PDF.js recommends its compatibility build for Node/Codespaces.
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {unzipSync} from 'fflate';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {convertMarkdownToPdf} from './markdownToPdf';
import {convertHtmlToPdf} from './htmlToPdf';
import {convertPlainTextToPdf} from './plainTextToPdf';
import {convertJsonToPdf} from './jsonToPdf';
import {convertEmlToPdf} from './emlToPdf';
import {updatePdfBasicMetadata} from './pdfMetadataEdit';
import {inspectPdfDocumentInfo} from './pdfInfo';
import {fitPdfToPaper} from './pdfPaperResize';
import {imposePdfBooklet} from './pdfBooklet';
import {splitPdfByPageCount} from './splitByPageCount';
import {addPdfOutlineTreeEntry} from './pdfOutlineTree';
import {splitPdfByChapters} from './pdfChapterSplit';
import {addPdfVisualSignature} from './pdfVisualSignature';
import {runOfflinePdfPipeline,parseOfflinePdfPipeline} from './pdfOfflinePipeline';
import {LOCAL_PDF_PIPELINE_PROTOCOL,handleLocalPdfPipelineData} from './pdfPipelineHandler';
import {exportPdfStructuredJson} from './pdfToJson';
import {exportPdfStructuredXml} from './pdfToXml';
import {exportPdfEpub,inspectPdfEpubArchive} from './pdfToEpub';

const enc=(value:string)=>new TextEncoder().encode(value);
const dec=(value:Uint8Array)=>new TextDecoder('utf-8',{fatal:true}).decode(value);
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
type Evidence={operationId:string;file:string;bytes:number;sha256:string;verified:string};
const evidence:Evidence[]=[];
let directory='';
let source:Uint8Array;
let smallSource:Uint8Array;
async function fixture(count:number):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle('MALENJO Codespaces execution fixture');
  for(let p=1;p<=count;p++){
    const page=pdf.addPage([400+p*10,600]);
    page.drawText('MALENJO EXECUTION PAGE '+p,{x:20,y:500,font,size:16});
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}
function persist(id:string,name:string,bytes:Uint8Array,verified:string):Uint8Array{
  writeFileSync(join(directory,name),bytes,{flag:'wx'});
  const disk=Uint8Array.from(readFileSync(join(directory,name)));
  expect(disk).toEqual(bytes);
  evidence.push({operationId:id,file:name,bytes:disk.length,sha256:hash(disk),verified});
  return disk;
}
async function savedPdf(id:string,name:string,bytes:Uint8Array,count:number):Promise<PDFDocument>{
  const disk=persist(id,name,bytes,'written, read from disk and reopened as PDF');
  expect(dec(disk.slice(0,5))).toBe('%PDF-');
  const reopened=await PDFDocument.load(disk,{ignoreEncryption:false,updateMetadata:false});
  expect(reopened.getPageCount()).toBe(count);
  return reopened;
}
async function savedPdfZip(id:string,name:string,bytes:Uint8Array,counts:number[]){
  const archive=unzipSync(persist(id,name,bytes,'ZIP reread; every member extracted and reopened'));
  const names=Object.keys(archive).sort();
  expect(names).toHaveLength(counts.length);
  for(let i=0;i<names.length;i++){
    expect(names[i]).toMatch(/^[a-zA-Z0-9._-]+\.pdf$/);
    const opened=await PDFDocument.load(archive[names[i]]);
    expect(opened.getPageCount()).toBe(counts[i]);
    writeFileSync(join(directory,names[i]),archive[names[i]],{flag:'wx'});
  }
}
describe.skipIf(process.env.MALENJO_PDF_EXECUTION!=='1').sequential('Codespaces real PDF artifact execution',()=>{
  beforeAll(async()=>{
    const home=resolve(process.cwd(),'.build/pdf-codespaces-execution');
    mkdirSync(home,{recursive:true});
    directory=mkdtempSync(join(home,'run-'));
    source=await fixture(4);
    smallSource=await fixture(2);
    writeFileSync(join(directory,'source-four.pdf'),source,{flag:'wx'});
    writeFileSync(join(directory,'source-text.pdf'),smallSource,{flag:'wx'});
    expect((await PDFDocument.load(Uint8Array.from(readFileSync(join(directory,'source-four.pdf'))))).getPageCount()).toBe(4);
  });
  afterAll(()=>{
    if(!directory)return;
    const report={
      schemaVersion:1,
      scope:'Real Codespaces/Linux disk artifacts only; not Windows/Tauri/full Stirling parity',
      generatedUtc:new Date().toISOString(),
      inputSha256:hash(source),
      executedOperationIds:[...new Set(evidence.map(x=>x.operationId))],
      artifacts:evidence,
      notExecutedHere:[
        'Browser canvas rasterization, Stirling Java localhost routes, Tauri native dialogs',
        'qpdf permissions, PKCS12 pyHanko signing, PaddleOCR local models',
        'independent PDF/A + veraPDF, licensed RAR, RFC3161 local TSA',
        'network-opt-in URL capture, folder watcher, enterprise SSO',
      ],
    };
    writeFileSync(join(directory,'manifest.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log('Codespaces real PDF output evidence: '+directory);
    console.log('Unique real operation entry points: '+report.executedOperationIds.length);
  });
  it('converts five actual source formats to saved, reopenable PDF files',async()=>{
    const inputs=[
      ['markdown-to-pdf','markdown.pdf',()=>convertMarkdownToPdf(enc('# Real Markdown\n\nMALENJO execution text'))],
      ['html-to-pdf','html.pdf',()=>convertHtmlToPdf(enc('<h1>Real HTML</h1><p>MALENJO execution text</p>'))],
      ['file-to-pdf','plain-text.pdf',()=>convertPlainTextToPdf(enc('Real plain text\nMALENJO execution text'))],
      ['json-to-pdf','json.pdf',()=>convertJsonToPdf(enc('{"codespaces":true,"source":"actual JSON"}'))],
      ['eml-to-pdf','email.pdf',()=>convertEmlToPdf(enc('From: alice@example.org\r\nTo: bob@example.org\r\nSubject: Codespace test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nReal email body'))],
    ] as const;
    for(const [id,name,call] of inputs){
      await savedPdf(id,name,await call(),1);
    }
  });
  it('edits actual document metadata while preserving original input bytes',async()=>{
    const before=Uint8Array.from(source);
    const changed=await updatePdfBasicMetadata(source,{
      title:'Codespaces Metadata Executed',author:'MALENJO',
      subject:'Generated and reopened',keywords:'real,artifact',
    });
    const reopened=await savedPdf('update-metadata','metadata.pdf',changed,4);
    expect(reopened.getTitle()).toBe('Codespaces Metadata Executed');
    expect(source).toEqual(before);
  });
  it('resizes four actual pages to A4 paper geometry',async()=>{
    const changed=await fitPdfToPaper(source,{paper:'A4',orientation:'portrait',marginPt:12});
    const opened=await savedPdf('scale-pages','a4-resize.pdf',changed,4);
    expect(opened.getPages().every(p=>Math.abs(p.getWidth()-595.28)<0.1)).toBe(true);
  });
  it('generates and reopens a two-spread booklet PDF',async()=>{
    const changed=await imposePdfBooklet(source);
    const reopened=await savedPdf('booklet-imposition','booklet.pdf',changed,2);
    expect(reopened.getPage(0).getWidth()).toBeGreaterThan(800);
  });
  it('splits a PDF by page count and reopens both actual ZIP members',async()=>{
    const output=await splitPdfByPageCount(source,2);
    expect(output.pageCounts).toEqual([2,2]);
    await savedPdfZip('split-by-size-or-count','page-count-split.zip',output.archive,[2,2]);
  });
  it('uses actual top-level bookmarks to export two standalone chapter PDFs',async()=>{
    let bookmarked=await addPdfOutlineTreeEntry(source,'First chapter',1);
    bookmarked=await addPdfOutlineTreeEntry(bookmarked,'Second chapter',3);
    const output=await splitPdfByChapters(bookmarked);
    expect(output.chapters.map(x=>[x.firstPage,x.lastPage])).toEqual([[1,2],[3,4]]);
    await savedPdfZip('split-pdf-by-chapters','chapter-split.zip',output.archive,[2,2]);
  });
  it('adds an actual visible signature mark to a separate PDF',async()=>{
    const changed=await addPdfVisualSignature(source,{
      name:'Executed Visual Mark',pageNumber:2,x:0.2,y:0.25,
    });
    await savedPdf('sign','visual-signature.pdf',changed,4);
  });
  it('runs a multi-step move/rotate/delete PDF pipeline and checks new geometry',async()=>{
    const plan=parseOfflinePdfPipeline('[{"action":"move","from":4,"to":1},{"action":"rotate","pages":[1],"angle":90},{"action":"delete","pages":[3]}]');
    const output=await runOfflinePdfPipeline(source,plan);
    const reopened=await savedPdf('pipeline','page-pipeline.pdf',output,3);
    expect(reopened.getPage(0).getWidth()).toBe(440);
    expect(reopened.getPage(0).getRotation().angle).toBe(90);
  });
  it('executes the typed handleData substitute with actual PDF bytes',async()=>{
    const result=await handleLocalPdfPipelineData({
      protocol:LOCAL_PDF_PIPELINE_PROTOCOL,contentType:'application/pdf',
      filename:'original.pdf',bytes:source,
      planJson:'[{"action":"delete","pages":[1,2]}]',
    });
    expect(result.resultPageCount).toBe(2);
    await savedPdf('handleData','typed-handleData.pdf',result.bytes,2);
  });
  it('runs PDF.js against a REAL PDF for JSON, XML and EPUB3 output',async()=>{
    const info=await inspectPdfDocumentInfo(smallSource);
    const task=getDocument({data:Uint8Array.from(smallSource),useSystemFonts:true,disableFontFace:true});
    try{
      const pdf=await task.promise;
      expect(pdf.numPages).toBe(2);
      const json=await exportPdfStructuredJson(pdf,info);
      const jsonDisk=persist('pdf-to-json','text.json',json,'real PDF.js selectable text serialized as JSON and parsed');
      expect(JSON.parse(dec(jsonDisk)).pages[0].text).toContain('MALENJO EXECUTION PAGE');
      const xml=await exportPdfStructuredXml(pdf,info);
      expect(dec(persist('pdf-to-xml','text.xml',xml,'real PDF.js selectable text exported as XML'))).toContain('MALENJO EXECUTION PAGE');
      const epub=await exportPdfEpub(pdf,info);
      const fromDisk=persist('pdf-to-epub','text.epub',epub,'saved EPUB reopened and structural navigation checked');
      expect(inspectPdfEpubArchive(fromDisk)).toMatchObject({pageLinks:2,hasText:true});
    }finally{
      await task.destroy();
    }
  },15000);
  it('refuses interactive PDFs and unsupported HTML rather than emitting unsafe files',async()=>{
    const unsafe=await PDFDocument.create();
    unsafe.addPage([200,300]);
    unsafe.addPage([200,300]);
    unsafe.getForm().createTextField('interactive');
    const bytes=Uint8Array.from(await unsafe.save());
    await expect(runOfflinePdfPipeline(bytes,[{action:'delete',pages:[1]}]))
      .rejects.toThrow(/AcroForm/);
    await expect(splitPdfByPageCount(bytes,1)).rejects.toThrow(/form fields/);
    await expect(convertHtmlToPdf(enc('<script>window.alert(1)</script>')))
      .rejects.toThrow();
  });
});
