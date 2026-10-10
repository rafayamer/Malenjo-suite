/* Real user-supplied local PDF execution for Linux Codespaces.
   Fronted by scripts/pdf-codespaces-process.mjs, never exposed to browser URLs.
   This executes production PDF modules, not fabricated responses. */
import {describe,it,expect} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {unzipSync} from 'fflate';
import {lstatSync,realpathSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {appendPdf,deletePdfPages,movePdfPage,rotatePdfPagePermanent,extractPdfPages} from '../src/suite/pdf/editor';
import {fitPdfToPaper} from '../src/suite/pdf/pdfPaperResize';
import {imposePdfBooklet} from '../src/suite/pdf/pdfBooklet';
import {splitPdfByPageCount} from '../src/suite/pdf/splitByPageCount';
import {splitPdfByChapters} from '../src/suite/pdf/pdfChapterSplit';
import {parseOfflinePdfPipeline,runOfflinePdfPipeline} from '../src/suite/pdf/pdfOfflinePipeline';
import {LOCAL_PDF_PIPELINE_PROTOCOL,handleLocalPdfPipelineData} from '../src/suite/pdf/pdfPipelineHandler';
import {convertMarkdownToPdf} from '../src/suite/pdf/markdownToPdf';
import {convertHtmlToPdf} from '../src/suite/pdf/htmlToPdf';
import {convertPlainTextToPdf} from '../src/suite/pdf/plainTextToPdf';
import {convertJsonToPdf} from '../src/suite/pdf/jsonToPdf';
import {convertEmlToPdf} from '../src/suite/pdf/emlToPdf';
import {inspectPdfDocumentInfo} from '../src/suite/pdf/pdfInfo';
import {exportPdfStructuredJson} from '../src/suite/pdf/pdfToJson';
import {exportPdfStructuredXml} from '../src/suite/pdf/pdfToXml';
import {exportPdfEpub,inspectPdfEpubArchive} from '../src/suite/pdf/pdfToEpub';
import {exportPdfTextFormat} from '../src/suite/pdf/pdfTextFormats';
import {exportPdfTextOnlySvgZip} from '../src/suite/pdf/pdfTextVector';

interface Command{
  operation:string;input:string;output:string;
  page?:number;to?:number;pages?:string;
  second?:string;paper?:string;plan?:string;
}
type Kind='pdf'|'zip-pdf'|'zip-svg'|'epub'|'json'|'xml'|'text';
const MAX_INPUT=32*1024*1024;
function sourceBytes(path:string):Uint8Array{
  const resolved=realpathSync(resolve(path));
  if(lstatSync(resolve(path)).isSymbolicLink())throw new Error('Input may not be a symlink.');
  const bytes=Uint8Array.from(readFileSync(resolved));
  if(bytes.length<1||bytes.length>MAX_INPUT)throw new Error('Input must be between 1 byte and 32 MB.');
  return bytes;
}
function validatedPages(value:string|undefined):number[]{
  if(!value||!/^([1-9][0-9]*)(,[1-9][0-9]*)*$/.test(value)||value.length>400){
    throw new Error('Use --pages 1,3,5 with positive page numbers.');
  }
  const numbers=value.split(',').map(Number);
  if(numbers.some(x=>!Number.isSafeInteger(x))||new Set(numbers).size!==numbers.length)
    throw new Error('Page indices must be unique safe positive integers.');
  return numbers;
}
function requiredPage(value:number|undefined):number{
  if(!Number.isSafeInteger(value)||(value??0)<1)throw new Error('Use --page with a positive integer.');
  return value!;
}
function outputFor(operation:string):Kind{
  if(['merge-pdfs','remove-pages','rearrange-pages','rotate-pdf','extract-pages',
    'scale-pages','booklet-imposition','pipeline','handleData',
    'markdown-to-pdf','html-to-pdf','file-to-pdf','json-to-pdf','eml-to-pdf'].includes(operation))return 'pdf';
  if(['split-by-size-or-count','split-pdf-by-chapters'].includes(operation))return 'zip-pdf';
  if(operation==='pdf-to-vector')return 'zip-svg';
  if(operation==='pdf-to-epub')return 'epub';
  if(operation==='pdf-to-json')return 'json';
  if(operation==='pdf-to-xml')return 'xml';
  if(['pdf-to-markdown','pdf-to-html','pdf-to-csv'].includes(operation))return 'text';
  throw new Error('Unsupported Codespaces operation: '+operation);
}
async function execute(command:Command,input:Uint8Array):Promise<{bytes:Uint8Array;kind:Kind}>{
  const op=command.operation,kind=outputFor(op);
  const checkedPdf=(bytes:Uint8Array)=>{
    if(bytes.length<5||new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-'){
      throw new Error('Operation requires an input PDF document.');
    }
  };
  if(['markdown-to-pdf','html-to-pdf','file-to-pdf','json-to-pdf','eml-to-pdf'].includes(op)){
    const fns={
      'markdown-to-pdf':convertMarkdownToPdf,
      'html-to-pdf':convertHtmlToPdf,
      'file-to-pdf':convertPlainTextToPdf,
      'json-to-pdf':convertJsonToPdf,
      'eml-to-pdf':convertEmlToPdf,
    };
    return {bytes:await fns[op as keyof typeof fns](input),kind};
  }
  checkedPdf(input);
  if(op==='merge-pdfs')return {bytes:await appendPdf(input,sourceBytes(command.second??'')),kind};
  if(op==='remove-pages')return {bytes:await deletePdfPages(input,validatedPages(command.pages)),kind};
  if(op==='rearrange-pages')return {bytes:await movePdfPage(input,requiredPage(command.page),requiredPage(command.to)),kind};
  if(op==='rotate-pdf')return {bytes:await rotatePdfPagePermanent(input,requiredPage(command.page)),kind};
  if(op==='extract-pages')return {bytes:await extractPdfPages(input,validatedPages(command.pages)),kind};
  if(op==='scale-pages'){
    const paper=command.paper??'A4';
    if(!['A4','A5','Letter','Legal'].includes(paper))throw new Error('Unsupported --paper value.');
    return {bytes:await fitPdfToPaper(input,{paper:paper as 'A4'|'A5'|'Letter'|'Legal',orientation:'portrait',marginPt:12}),kind};
  }
  if(op==='booklet-imposition')return {bytes:await imposePdfBooklet(input),kind};
  if(op==='split-by-size-or-count')return {bytes:(await splitPdfByPageCount(input,requiredPage(command.page))).archive,kind};
  if(op==='split-pdf-by-chapters')return {bytes:(await splitPdfByChapters(input)).archive,kind};
  if(op==='pipeline')return {bytes:await runOfflinePdfPipeline(input,parseOfflinePdfPipeline(command.plan??'')),kind};
  if(op==='handleData'){
    const output=await handleLocalPdfPipelineData({
      protocol:LOCAL_PDF_PIPELINE_PROTOCOL,contentType:'application/pdf',
      filename:basename(command.input).replace(/[^a-zA-Z0-9._-]/g,'_'),
      bytes:input,planJson:command.plan??'',
    });
    return {bytes:output.bytes,kind};
  }
  // Read-only text/graphics exports need real PDF.js page extraction.
  const info=await inspectPdfDocumentInfo(input);
  const loading=getDocument({data:Uint8Array.from(input),useSystemFonts:true,disableFontFace:true});
  try{
    const pdf=await loading.promise;
    if(op==='pdf-to-json')return {bytes:await exportPdfStructuredJson(pdf,info),kind};
    if(op==='pdf-to-xml')return {bytes:await exportPdfStructuredXml(pdf,info),kind};
    if(op==='pdf-to-epub')return {bytes:await exportPdfEpub(pdf,info),kind};
    if(op==='pdf-to-vector')return {bytes:(await exportPdfTextOnlySvgZip(pdf)).archive,kind};
    if(op.startsWith('pdf-to-')){
      const suffix=op.slice('pdf-to-'.length);
      if(suffix==='markdown'||suffix==='html'||suffix==='csv'){
        return {bytes:await exportPdfTextFormat(pdf,info,suffix),kind};
      }
    }
    throw new Error('Unsupported PDF text format.');
  }finally{
    await loading.destroy();
  }
}
async function verifySaved(kind:Kind,bytes:Uint8Array):Promise<string>{
  if(kind==='pdf'){
    const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
    if(pdf.getPageCount()<1)throw new Error('Saved PDF has no pages.');
    return 'Saved/reopened PDF: '+pdf.getPageCount()+' pages';
  }
  if(kind==='zip-pdf'||kind==='zip-svg'){
    const files=unzipSync(bytes);
    if(Object.keys(files).length<1||Object.keys(files).length>200)
      throw new Error('ZIP archive has no members or too many members.');
    for(const [name,content] of Object.entries(files)){
      if(!/^[a-zA-Z0-9._-]+[.](pdf|svg)$/.test(name))
        throw new Error('Archive contains an unsafe filename.');
      if(kind==='zip-pdf'){
        const p=await PDFDocument.load(content);
        if(p.getPageCount()<1)throw new Error('An archived PDF is blank.');
      }else if(!new TextDecoder().decode(content).includes('<svg ')){
        throw new Error('ZIP member is not an SVG document.');
      }
    }
    return 'Saved/reopened archive: '+Object.keys(files).length+' members';
  }
  if(kind==='epub'){
    const info=inspectPdfEpubArchive(bytes);
    if(info.pageLinks<1||!info.hasText)throw new Error('Saved EPUB has no text navigation.');
    return 'Saved/reopened EPUB: '+info.pageLinks+' pages';
  }
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!text.trim())throw new Error('Saved text export is empty.');
  if(kind==='json')JSON.parse(text);
  if(kind==='xml'&&!text.includes('<malenjo-pdf'))throw new Error('Saved XML has invalid root.');
  return 'Saved/reopened '+kind+' export';
}
const active=process.env.MALENJO_PDF_SINGLE_COMMAND;
describe.skipIf(!active).sequential('Execute a requested native Codespaces operation',()=>{
  it('runs one explicit operation and verifies the resulting output on disk',async()=>{
    const job=JSON.parse(active??'{}') as Command;
    const kind=outputFor(job.operation);
    const out=resolve(job.output),input=resolve(job.input);
    if(out===input)throw new Error('Output cannot overwrite the source PDF.');
    const directory=realpathSync(dirname(out));
    if(directory!==dirname(out))throw new Error('Output directory contains unresolved symlinks.');
    const receipt=out+'.execution.json';
    if(existsSync(out)||existsSync(receipt))throw new Error('Output or receipt exists; overwriting is prohibited.');
    const source=sourceBytes(input);
    const prior=Uint8Array.from(source);
    const result=await execute(job,source);
    expect(result.kind).toBe(kind);
    expect(source).toEqual(prior);
    if(result.bytes.length<10||result.bytes.length>128*1024*1024)
      throw new Error('Operation produced an empty or oversized output.');
    writeFileSync(out,result.bytes,{flag:'wx'});
    const disk=Uint8Array.from(readFileSync(out));
    expect(disk).toEqual(result.bytes);
    const checked=await verifySaved(kind,disk);
    const sha256=createHash('sha256').update(disk).digest('hex');
    const manifest={
      schemaVersion:1,scope:'Real Linux/Codespaces execution only; not Windows release acceptance',
      operation:job.operation,input:basename(input),output:basename(out),
      bytes:disk.length,sha256,checked,
    };
    writeFileSync(receipt,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    console.log('PDF CODESPACES EXECUTED: '+JSON.stringify(manifest));
  },30000);
});
