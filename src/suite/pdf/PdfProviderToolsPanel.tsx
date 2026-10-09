import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, ChevronDown, FileOutput, Play, RefreshCw, Search,
  ServerCog, Square, TriangleAlert,
} from 'lucide-react';
import type {
  PdfProviderComponentStatus,
  PdfProviderInputFile,
  PdfProviderOperation,
  PdfProviderOperationField,
  PdfProviderStatus,
  PdfProviderToolCategory,
  PdfToolProvider,
} from './backend';
import { fieldAcceptsActivePdf } from './providerFileInputs';
import { computePdfParityCoverage } from './parityCoverage';
import { inspectPdfDocumentInfo } from './pdfInfo';
import { updatePdfBasicMetadata,type PdfBasicMetadataUpdate } from './pdfMetadataEdit';
import { removePdfReviewMarkup } from './pdfAnnotationCleanup';
import { classifyPdfProviderResult,safePdfCopyResponse } from './providerResultGuard';
import { ensurePdfProviderRunning } from './providerLifecycle';
import { isDesktopRuntime } from '../files/api';
import { loadPdfBytes,disposePdf } from './engine';
import { extractPdfDocumentText } from './textExport';
import { exportPdfStructuredJson } from './pdfToJson';
import { exportPdfStructuredXml } from './pdfToXml';
import {exportPdfTextFormat,type PdfTextFormat} from './pdfTextFormats';
import {exportPdfCbz} from './pdfToCbz';
import {exportPdfRasterPptx} from './pdfToPresentation';
import {addPdfOutlineTreeEntry,deletePdfOutlineTreeEntry,listPdfOutlineTree,movePdfOutlineTreeEntry,renamePdfOutlineTreeEntry,type PdfOutlineTreeEntry} from './pdfOutlineTree';
import {exportPdfOfficeText,inspectPdfTextDocx,inspectPdfTextOdt,type PdfOfficeTextFormat} from './pdfOfficeText';
import {exportPdfEpub,inspectPdfEpubArchive} from './pdfToEpub';
import {proposePdfMetadataFilename} from './pdfAutoRename';
import {unlockReadOnlyPdfFormFields} from './formUnlock';
import {inspectPdfStructuralSafety,serializePdfPreflightJson} from './pdfPreflight';
import {buildLocalPdfApiManual} from './pdfApiManual';
import {addPdfVisualSignature} from './pdfVisualSignature';
import {imposePdfBooklet,PDF_BOOKLET_MAX_INPUT_BYTES} from './pdfBooklet';
import {convertJsonToPdf,JSON_TO_PDF_MAX_INPUT_BYTES} from './jsonToPdf';
import {convertMarkdownToPdf,MARKDOWN_TO_PDF_MAX_INPUT_BYTES} from './markdownToPdf';
import {convertPlainTextToPdf,TEXT_TO_PDF_MAX_INPUT_BYTES} from './plainTextToPdf';
import {convertEmlToPdf,EML_TO_PDF_MAX_BYTES} from './emlToPdf';
import {convertCbzToPdf,CBZ_TO_PDF_MAX_SOURCE_BYTES} from './cbzToPdf';
import { splitPdfByPageCount } from './splitByPageCount';
import {PDF_TWENTY_WORKFLOWS,findPdfBatchOperation,classifyPdfBatchOutput} from './pdfTwentyWorkflows';
import {verifyProviderCompletion} from './pdfProviderCompletion';
import {fitPdfToPaper,type PdfPaperSize,type PdfPaperOrientation} from './pdfPaperResize';
import {validatePdfUploadPlan,validatePdfOperationValue} from './providerRequestGuard';

interface Props{
  provider:PdfToolProvider;
  sourceBytes:Uint8Array|null;
  sourceName:string;
  category:PdfProviderToolCategory;
  onApplyPdf(label:string,bytes:Uint8Array,expectedSource:Uint8Array):boolean|Promise<boolean>;
}

function defaultFieldValue(field:PdfProviderOperationField):string{
  if(field.defaultValue===undefined)return field.kind==='boolean'?'false':'';
  if(typeof field.defaultValue==='boolean')return field.defaultValue?'true':'false';
  return String(field.defaultValue);
}

function operationHaystack(operation:PdfProviderOperation):string{
  return [
    operation.summary,operation.description,operation.id,operation.path,...operation.tags,
    operation.capability.implementation,operation.capability.providerId,
    operation.capability.disabledReason??'',operation.capability.fallback??'',
    ...operation.fields.flatMap((field)=>[field.name,field.label,field.description??'']),
  ].join(' ').toLowerCase();
}

function localExportStem(name:string):string{
  const stem=name.replace(/\.pdf$/i,'').replace(/[^A-Za-z0-9._-]/g,'_').replace(/^\.+/,'').slice(0,100);
  return stem||'MALENJO-document';
}

function providerFilename(name:string):string{
  const trimmed=name.trim()||'document.pdf';
  return trimmed.toLowerCase().endsWith('.pdf')?trimmed:trimmed+'.pdf';
}

export default function PdfProviderToolsPanel({provider,sourceBytes,sourceName,category,onApplyPdf}:Props){
  const [status,setStatus]=useState<PdfProviderStatus|null>(null);
  const [components,setComponents]=useState<PdfProviderComponentStatus[]>([]);
  const [operations,setOperations]=useState<PdfProviderOperation[]>([]);
  const [catalogLoaded,setCatalogLoaded]=useState(false);
  const [search,setSearch]=useState('');
  const [selectedId,setSelectedId]=useState('');
  const [values,setValues]=useState<Record<string,string>>({});
  const [extraFiles,setExtraFiles]=useState<Record<string,File[]>>({});
  const [useActive,setUseActive]=useState<Record<string,boolean>>({});
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [allCategories,setAllCategories]=useState(false);
  const [metadataEditorOpen,setMetadataEditorOpen]=useState(false);
  const [outlineItems,setOutlineItems]=useState<PdfOutlineTreeEntry[]>([]);
  const [outlineTitle,setOutlineTitle]=useState('');
  const [outlineTarget,setOutlineTarget]=useState('');
  const [outlinePage,setOutlinePage]=useState('1');
  const [outlineDeleteSubtree,setOutlineDeleteSubtree]=useState(false);
  const activeSourceRef=useRef(sourceBytes);
  activeSourceRef.current=sourceBytes;
  const metadataInspectionRef=useRef(0);
  const [splitPagesPerPart,setSplitPagesPerPart]=useState('2');
  const [jsonToPdfFile,setJsonToPdfFile]=useState<File|null>(null);
  const [markdownToPdfFile,setMarkdownToPdfFile]=useState<File|null>(null);
  const [textToPdfFile,setTextToPdfFile]=useState<File|null>(null);
  const [emlToPdfFile,setEmlToPdfFile]=useState<File|null>(null);
  const [visualSigner,setVisualSigner]=useState('');
  const [visualSignPage,setVisualSignPage]=useState('1');
  const [visualSignX,setVisualSignX]=useState('0.06');
  const [visualSignY,setVisualSignY]=useState('0.09');
  const [cbzToPdfFile,setCbzToPdfFile]=useState<File|null>(null);
  const [paperSize,setPaperSize]=useState<PdfPaperSize>('A4');
  const [paperOrientation,setPaperOrientation]=useState<PdfPaperOrientation>('portrait');
  const [paperMargin,setPaperMargin]=useState('18');
  const [metadataDraft,setMetadataDraft]=useState<PdfBasicMetadataUpdate>({
    title:'',author:'',subject:'',keywords:'',
  });

  useEffect(()=>{
    metadataInspectionRef.current++;
    setMetadataEditorOpen(false);
  },[sourceBytes]);
  useEffect(()=>{
    setOutlineItems([]);setOutlineTarget('');setOutlineDeleteSubtree(false);
  },[sourceBytes]);

  const refresh=async(loadCatalog=false)=>{
    setError('');
    try{
      const [next,nextComponents]=await Promise.all([provider.status(),provider.componentStatus()]);
      setStatus(next);setComponents(nextComponents);
      if(next.running&&loadCatalog){
        const catalog=await provider.listOperations();
        setOperations(catalog);setCatalogLoaded(true);
      }else if(!next.running){
        // A sidecar may stop outside this panel. Never display stale
        // catalog entries as live provider availability or runnable tools.
        setOperations([]);setCatalogLoaded(false);setSelectedId('');
      }
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  };

  useEffect(()=>{
    let cancelled=false;
    void (async()=>{
      if(!isDesktopRuntime()){
        await refresh(true);
        return;
      }
      try{
        // When another tab has already begun startup, share that request.
        // Provider tools load only once the owned local engine is healthy.
        await ensurePdfProviderRunning(provider);
        if(!cancelled)await refresh(true);
      }catch(reason){
        if(cancelled)return;
        await refresh(false);
        if(!cancelled)setError(reason instanceof Error?reason.message:String(reason));
      }
    })();
    return()=>{cancelled=true;};
  },[provider]);

  const filtered=useMemo(()=>{
    const terms=search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return operations.filter((operation)=>{
      if(!allCategories&&operation.category!==category)return false;
      if(!terms.length)return true;
      const haystack=operationHaystack(operation);
      return terms.every((term)=>haystack.includes(term));
    });
  },[allCategories,category,operations,search]);

  const selected=useMemo(()=>operations.find((operation)=>operation.id===selectedId)??null,[operations,selectedId]);
  const parity=useMemo(()=>computePdfParityCoverage(operations,catalogLoaded),[operations,catalogLoaded]);

  useEffect(()=>{
    if(selectedId&&filtered.some((operation)=>operation.id===selectedId))return;
    setSelectedId(filtered.find((operation)=>operation.capability.available)?.id??filtered[0]?.id??'');
  },[filtered,selectedId]);

  useEffect(()=>{
    if(!selected){setValues({});setExtraFiles({});setUseActive({});return;}
    const nextValues:Record<string,string>={};
    const nextUseActive:Record<string,boolean>={};
    let activeAssigned=false;
    for(const field of selected.fields){
      if(field.kind==='file'||field.kind==='files'){
        const canUseActive=fieldAcceptsActivePdf(field);
        nextUseActive[field.name]=canUseActive&&!activeAssigned;
        if(canUseActive&&!activeAssigned)activeAssigned=true;
      }else nextValues[field.name]=defaultFieldValue(field);
    }
    setValues(nextValues);setExtraFiles({});setUseActive(nextUseActive);setNotice('');setError('');
  },[selected?.id]);

  async function saveLocalPdfInfo(){
    if(!sourceBytes||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const info=await inspectPdfDocumentInfo(sourceBytes);
      const output=new TextEncoder().encode(JSON.stringify(info,null,2)+'\n');
      const saved=await provider.saveResponse({
        status:200,contentType:'application/json',bytes:Array.from(output),
      },localExportStem(sourceName)+'-info');
      setNotice(saved?`Saved local PDF information: ${saved}`:'PDF information save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy(false);
    }
  }

  async function openLocalMetadataEditor(){
    if(!sourceBytes||busy)return;
    if(metadataEditorOpen){
      setMetadataEditorOpen(false);
      return;
    }
    setBusy(true);setError('');setNotice('');
    const inspectedSource=sourceBytes;
    const requestId=++metadataInspectionRef.current;
    try{
      const inspected=await inspectPdfDocumentInfo(inspectedSource);
      if(activeSourceRef.current!==inspectedSource||metadataInspectionRef.current!==requestId)return;
      setMetadataDraft({
        title:inspected.metadata.title??'',
        author:inspected.metadata.author??'',
        subject:inspected.metadata.subject??'',
        keywords:inspected.metadata.keywords??'',
      });
      setMetadataEditorOpen(true);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy(false);
    }
  }

  async function applyLocalMetadata(){
    if(!sourceBytes||busy)return;
    if(!metadataEditorOpen)throw new Error('The metadata editor is not open for the current PDF.');
    setBusy(true);setError('');setNotice('');
    try{
      const output=await updatePdfBasicMetadata(sourceBytes,metadataDraft);
      const applied=await onApplyPdf('Updated PDF metadata (offline)',output,sourceBytes);
      if(!applied)throw new Error('PDF metadata changes could not be applied; the original working copy was preserved.');
      setMetadataEditorOpen(false);
      setNotice('PDF metadata updated in the working copy. Save or export the document to keep the change.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy(false);
    }
  }

  async function cleanReviewAnnotations(){
    if(!sourceBytes||busy)return;
    if(!window.confirm(
      'Remove all review and markup annotations from this working PDF? Links, form widgets and file attachments will be kept. This is NOT secure redaction or metadata sanitization. You can Undo this edit.'
    ))return;
    setBusy(true);setError('');setNotice('');
    try{
      const result=await removePdfReviewMarkup(sourceBytes);
      const applied=await onApplyPdf(
        'Removed '+result.removed+' review annotations (offline)',result.bytes,sourceBytes,
      );
      if(!applied)throw new Error('Review cleanup could not be applied. The original working copy is unchanged.');
      setNotice('Removed '+result.removed+' review annotations from the working PDF. Save or export to keep the result.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy(false);
    }
  }

  async function saveOfflinePageGroups(){
    if(!sourceBytes||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const count=Number(splitPagesPerPart);
      const result=await splitPdfByPageCount(sourceBytes,count,32*1024*1024);
      // Provider.saveResponse currently bridges bytes as number[]. Keep the
      // small-document fallback bounded until binary streaming IPC is added.
      if(result.archive.byteLength>32*1024*1024){
        throw new Error('This ZIP exceeds the 32 MB in-app export limit. Use the Stirling split tool for larger PDFs.');
      }
      const saved=await provider.saveResponse({
        status:200,contentType:'application/zip',bytes:Array.from(result.archive),
      },localExportStem(sourceName)+'-split');
      setNotice(saved
        ?'Saved '+result.pageCounts.length+' PDF parts ('+result.sourcePageCount+' pages): '+saved
        :'PDF splitting was cancelled; the original document was not changed.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy(false);
    }
  }

  async function saveLocalStructuredJson(){
    if(!sourceBytes||busy)return;
    setBusy(true);setError('');setNotice('');
    let loaded:Awaited<ReturnType<typeof loadPdfBytes>>|null=null;
    try{
      if(!sourceBytes.byteLength||sourceBytes.byteLength>512*1024*1024){
        throw new Error('PDF to JSON conversion requires a document of at most 512 MB.');
      }
      const metadata=await inspectPdfDocumentInfo(sourceBytes);
      loaded=await loadPdfBytes(sourceBytes);
      const output=await exportPdfStructuredJson(loaded.document,metadata,{
        onProgress:(done,total)=>setNotice(`Extracting page text: ${done}/${total}…`),
      });
      const saved=await provider.saveResponse({
        status:200,contentType:'application/json',bytes:Array.from(output),
      },localExportStem(sourceName)+'-structured');
      setNotice(saved
        ?`Saved structured PDF text and metadata: ${saved}`
        :'Structured JSON save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{
      try{await disposePdf(loaded);}
      finally{setBusy(false);}
    }
  }

  async function saveLocalStructuredXml(){
    if(!sourceBytes||busy)return;
    setBusy(true);setError('');setNotice('');
    let loaded:Awaited<ReturnType<typeof loadPdfBytes>>|null=null;
    try{
      if(!sourceBytes.byteLength||sourceBytes.byteLength>512*1024*1024){
        throw new Error('PDF to XML conversion requires a document of at most 512 MB.');
      }
      const metadata=await inspectPdfDocumentInfo(sourceBytes);
      loaded=await loadPdfBytes(sourceBytes);
      const output=await exportPdfStructuredXml(loaded.document,metadata,{
        onProgress:(done,total)=>setNotice(`Extracting XML page text: ${done}/${total}…`),
      });
      const saved=await provider.saveResponse({
        status:200,contentType:'application/xml; charset=utf-8',bytes:Array.from(output),
      },localExportStem(sourceName)+'-structured');
      setNotice(saved
        ?`Saved structured PDF XML: ${saved}`
        :'Structured XML save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{
      try{await disposePdf(loaded);}
      finally{setBusy(false);}
    }
  }

  async function saveNativeTextFormat(format:PdfTextFormat){
    if(!sourceBytes||busy)return;
    setBusy(true);setError('');setNotice('');
    let loaded:Awaited<ReturnType<typeof loadPdfBytes>>|null=null;
    const source=sourceBytes;
    try{
      if(source.byteLength<5||source.byteLength>512*1024*1024){
        throw new Error('PDF text conversion requires a document of at most 512 MB.');
      }
      const info=await inspectPdfDocumentInfo(source);
      loaded=await loadPdfBytes(source);
      const output=await exportPdfTextFormat(loaded.document,info,format,{
        onProgress:(done,total)=>setNotice('Reading PDF text: '+done+'/'+total+'…'),
      });
      if(activeSourceRef.current!==source){
        throw new Error('Working PDF changed while exporting; stale output was not saved.');
      }
      const mime=format==='markdown'?'text/markdown; charset=utf-8':
        format==='html'?'text/html; charset=utf-8':'text/csv; charset=utf-8';
      const saved=await provider.saveResponse({
        status:200,contentType:mime,bytes:Array.from(output),
      },localExportStem(sourceName)+'-selectable-text');
      setNotice(saved?('Saved '+format.toUpperCase()+' selectable-text export: '+saved):
        'PDF text export save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{
      try{await disposePdf(loaded);}finally{setBusy(false);}
    }
  }

  async function saveOfflineComicBook(){
    if(!sourceBytes||busy)return;
    const original=sourceBytes;
    setBusy(true);setError('');setNotice('');
    let loaded:Awaited<ReturnType<typeof loadPdfBytes>>|null=null;
    try{
      if(!original.byteLength||original.byteLength>512*1024*1024){
        throw new Error('PDF to CBZ conversion requires a document of at most 512 MB.');
      }
      loaded=await loadPdfBytes(original);
      const output=await exportPdfCbz(loaded.document,{
        onProgress:(done,total)=>setNotice('Rendering comic-book page '+done+'/'+total+'…'),
      });
      if(activeSourceRef.current!==original){
        throw new Error('PDF changed during CBZ export; stale output was not saved.');
      }
      const saved=await provider.saveResponse({
        status:200,contentType:'application/vnd.comicbook+zip',bytes:Array.from(output),
      },localExportStem(sourceName)+'-pages');
      setNotice(saved?('Saved rasterized CBZ comic: '+saved):'CBZ export save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));setNotice('');
    }finally{
      try{await disposePdf(loaded);}finally{setBusy(false);}
    }
  }

  async function saveOfflinePresentation(){
    if(!sourceBytes||busy)return;
    const revision=sourceBytes;
    setBusy(true);setError('');setNotice('');
    let loaded:Awaited<ReturnType<typeof loadPdfBytes>>|null=null;
    try{
      if(!revision.byteLength||revision.byteLength>32*1024*1024){
        throw new Error('Offline PowerPoint export supports PDFs up to 32 MB.');
      }
      loaded=await loadPdfBytes(revision);
      const output=await exportPdfRasterPptx(loaded.document,{
        onProgress:(done,total)=>setNotice('Rendering PowerPoint slide '+done+'/'+total+'…'),
      });
      if(activeSourceRef.current!==revision){
        throw new Error('PDF changed during PowerPoint export; stale presentation was not saved.');
      }
      const saved=await provider.saveResponse({
        status:200,
        contentType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        bytes:Array.from(output),
      },localExportStem(sourceName)+'-rasterized');
      setNotice(saved?('Saved PowerPoint presentation (rasterized PDF pages): '+saved):
        'PowerPoint export save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{
      try{await disposePdf(loaded);}finally{setBusy(false);}
    }
  }

  async function saveOfflineWordText(format:PdfOfficeTextFormat){
    if(!sourceBytes||busy)return;
    const original=sourceBytes;
    setBusy(true);setError('');setNotice('');
    let loaded:Awaited<ReturnType<typeof loadPdfBytes>>|null=null;
    try{
      if(!original.byteLength||original.byteLength>512*1024*1024){
        throw new Error('Office text export requires a PDF of at most 512 MB.');
      }
      const info=await inspectPdfDocumentInfo(original);
      loaded=await loadPdfBytes(original);
      const output=await exportPdfOfficeText(loaded.document,info,format,{
        onProgress:(done,total)=>setNotice('Reading PDF text '+done+'/'+total+'…'),
      });
      if(format==='docx'){
        const validated=inspectPdfTextDocx(output);
        if(validated.paragraphCount<1)throw new Error('DOCX output contains no paragraphs.');
      }else if(format==='odt'){
        const verified=inspectPdfTextOdt(output);
        if(verified.paragraphCount<1)throw new Error('ODT output contains no paragraphs.');
      }
      if(activeSourceRef.current!==original){
        throw new Error('PDF changed during Office export; stale output was not saved.');
      }
      const type=format==='docx'
        ?'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        :format==='odt'?'application/vnd.oasis.opendocument.text'
        :'application/rtf';
      const saved=await provider.saveResponse({
        status:200,contentType:type,bytes:Array.from(output),
      },localExportStem(sourceName)+'-selectable-text');
      setNotice(saved?('Saved '+format.toUpperCase()+' text conversion: '+saved):
        'Office text export save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{
      try{await disposePdf(loaded);}finally{setBusy(false);}
    }
  }

  async function saveOfflineEpub(){
    if(!sourceBytes||busy)return;
    const original=sourceBytes;
    setBusy(true);setError('');setNotice('');
    let loaded:Awaited<ReturnType<typeof loadPdfBytes>>|null=null;
    try{
      if(!original.byteLength||original.byteLength>512*1024*1024){
        throw new Error('PDF to EPUB requires a document of at most 512 MB.');
      }
      const info=await inspectPdfDocumentInfo(original);
      loaded=await loadPdfBytes(original);
      const output=await exportPdfEpub(loaded.document,info,{
        onProgress:(done,total)=>setNotice('Extracting e-book text '+done+'/'+total+'…'),
      });
      const verified=inspectPdfEpubArchive(output);
      if(verified.pageLinks!==loaded.document.numPages||!verified.hasText){
        throw new Error('EPUB navigation or readable content is missing.');
      }
      if(activeSourceRef.current!==original){
        throw new Error('PDF changed during EPUB conversion; stale output was not saved.');
      }
      const saved=await provider.saveResponse({
        status:200,contentType:'application/epub+zip',bytes:Array.from(output),
      },localExportStem(sourceName)+'-text');
      setNotice(saved?('Saved reflowable EPUB 3 e-book: '+saved):
        'EPUB save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{
      try{await disposePdf(loaded);}finally{setBusy(false);}
    }
  }

  async function saveMetadataNamedPdfCopy(){
    if(!sourceBytes||busy)return;
    const original=sourceBytes;
    setBusy(true);setError('');setNotice('');
    try{
      if(original.byteLength<5||original.byteLength>32*1024*1024){
        throw new Error('Offline metadata auto-rename supports PDFs up to 32 MB.');
      }
      const info=await inspectPdfDocumentInfo(original);
      const name=proposePdfMetadataFilename(info);
      if(activeSourceRef.current!==original){
        throw new Error('PDF changed during filename inspection. No copy was saved.');
      }
      const saved=await provider.saveResponse({
        status:200,contentType:'application/pdf',bytes:Array.from(original),
      },name.replace(/\.pdf$/i,''));
      setNotice(saved?('PDF copy saved under its metadata title: '+saved):
        'Renamed PDF copy save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));setNotice('');
    }finally{setBusy(false);}
  }

  async function saveOfflineJsonPdf(){
    if(!jsonToPdfFile||busy)return;
    const file=jsonToPdfFile;
    setBusy(true);setError('');setNotice('');
    try{
      if(!file.size||file.size>JSON_TO_PDF_MAX_INPUT_BYTES){
        throw new Error('JSON to PDF requires a file of at most 2 MB.');
      }
      const input=new Uint8Array(await file.arrayBuffer());
      const output=await convertJsonToPdf(input);
      if(jsonToPdfFile!==file)throw new Error('JSON source changed during conversion.');
      const saved=await provider.saveResponse({
        status:200,contentType:'application/pdf',bytes:Array.from(output),
      },localExportStem(file.name.replace(/\.json$/i,''))+'-json-report');
      setNotice(saved?('Saved JSON report as PDF: '+saved):
        'JSON to PDF save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));setNotice('');
    }finally{setBusy(false);}
  }

  async function saveOfflinePlainTextPdf(){
    if(!textToPdfFile||busy)return;
    const file=textToPdfFile;
    setBusy(true);setError('');setNotice('');
    try{
      if(!file.size||file.size>TEXT_TO_PDF_MAX_INPUT_BYTES){
        throw new Error('Text to PDF requires a file of at most 2 MB.');
      }
      const output=await convertPlainTextToPdf(new Uint8Array(await file.arrayBuffer()));
      if(textToPdfFile!==file)throw new Error('Text file changed during PDF conversion.');
      const saved=await provider.saveResponse({
        status:200,contentType:'application/pdf',bytes:Array.from(output),
      },localExportStem(file.name.replace(/\.txt$/i,''))+'-text');
      setNotice(saved?('Saved plain-text PDF: '+saved):'Plain-text PDF export cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));setNotice('');
    }finally{setBusy(false);}
  }

  async function saveOfflineEmlPdf(){
    if(!emlToPdfFile||busy)return;
    const file=emlToPdfFile;
    setBusy(true);setError('');setNotice('');
    try{
      if(!file.size||file.size>EML_TO_PDF_MAX_BYTES){
        throw new Error('EML to PDF requires an email file of at most 2 MB.');
      }
      const output=await convertEmlToPdf(new Uint8Array(await file.arrayBuffer()));
      // EML conversion preserves no active PDF mutations.
      const saved=await provider.saveResponse({
        status:200,contentType:'application/pdf',bytes:Array.from(output),
      },localExportStem(file.name.replace(/\.eml$/i,''))+'-mail-text');
      setNotice(saved?('Saved text-only email PDF: '+saved):
        'Email PDF export cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));setNotice('');
    }finally{setBusy(false);}
  }

  async function saveOfflineMarkdownPdf(){
    if(!markdownToPdfFile||busy)return;
    const file=markdownToPdfFile;
    setBusy(true);setError('');setNotice('');
    try{
      if(!file.size||file.size>MARKDOWN_TO_PDF_MAX_INPUT_BYTES){
        throw new Error('Markdown to PDF requires a file of at most 2 MB.');
      }
      const output=await convertMarkdownToPdf(new Uint8Array(await file.arrayBuffer()));
      if(markdownToPdfFile!==file)throw new Error('Markdown source changed during conversion.');
      const saved=await provider.saveResponse({
        status:200,contentType:'application/pdf',bytes:Array.from(output),
      },localExportStem(file.name.replace(/\.(?:md|markdown|txt)$/i,''))+'-markdown');
      setNotice(saved?('Saved Markdown PDF: '+saved):'Markdown PDF export cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{setBusy(false);}
  }

  async function saveOfflineCbzPdf(){
    if(!cbzToPdfFile||busy)return;
    const file=cbzToPdfFile;
    setBusy(true);setError('');setNotice('');
    try{
      if(!file.size||file.size>CBZ_TO_PDF_MAX_SOURCE_BYTES){
        throw new Error('CBZ conversion requires a comic archive of at most 32 MB.');
      }
      const output=await convertCbzToPdf(new Uint8Array(await file.arrayBuffer()));
      if(cbzToPdfFile!==file){
        throw new Error('CBZ source changed during conversion. No stale output saved.');
      }
      const saved=await provider.saveResponse({
        status:200,contentType:'application/pdf',bytes:Array.from(output),
      },localExportStem(file.name.replace(/\.cbz$/i,''))+'-comic');
      setNotice(saved?('Saved comic PDF: '+saved):'CBZ to PDF export save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));setNotice('');
    }finally{setBusy(false);}
  }

  async function applyOfflineFormUnlock(){
    if(!sourceBytes||busy)return;
    const revision=sourceBytes;
    setBusy(true);setError('');setNotice('');
    try{
      const result=await unlockReadOnlyPdfFormFields(revision);
      const applied=await onApplyPdf(
        'Unlock '+result.unlockedFields.length+' read-only AcroForm fields',
        result.bytes,revision,
      );
      if(!applied){
        throw new Error('The working PDF changed; form unlock was not applied.');
      }
      setNotice('Made '+result.unlockedFields.length+
        ' existing AcroForm fields editable. Changes support Undo. Save to retain them.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{setBusy(false);}
  }

  async function saveOfflineBooklet(){
    if(!sourceBytes||busy)return;
    const revision=sourceBytes;
    setBusy(true);setError('');setNotice('');
    try{
      if(!revision.byteLength||revision.byteLength>PDF_BOOKLET_MAX_INPUT_BYTES){
        throw new Error('Booklet conversion supports source PDFs of at most 32 MB.');
      }
      const result=await imposePdfBooklet(revision);
      if(activeSourceRef.current!==revision){
        throw new Error('PDF changed during booklet conversion; stale output was not saved.');
      }
      const saved=await provider.saveResponse({
        status:200,contentType:'application/pdf',bytes:Array.from(result),
      },localExportStem(sourceName)+'-booklet');
      setNotice(saved?('Saved two-up booklet PDF: '+saved):
        'Booklet export save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));setNotice('');
    }finally{setBusy(false);}
  }

  async function saveOfflineSecurityInspection(includeScriptText:boolean){
    if(!sourceBytes||busy)return;
    const revision=sourceBytes;
    setBusy(true);setError('');setNotice('');
    try{
      const report=await inspectPdfStructuralSafety(revision);
      const output=serializePdfPreflightJson(report,includeScriptText);
      if(activeSourceRef.current!==revision){
        throw new Error('Working PDF changed during inspection. Stale report was not exported.');
      }
      const saved=await provider.saveResponse({
        status:200,contentType:'application/json',bytes:Array.from(output),
      },localExportStem(sourceName)+(includeScriptText?'-inert-javascript':'-structural-preflight'));
      setNotice(saved
        ?('Saved '+(includeScriptText?'inert JavaScript inventory':'PDF preflight report')+
          ': '+saved+' ('+report.pageCount+' pages, '+report.embeddedJavaScriptCount+
          ' script entries). This is not signature or PDF/A validation.')
        :'PDF inspection export cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{setBusy(false);}
  }

  async function applyVisualSignature(){
    if(!sourceBytes||busy)return;
    const original=sourceBytes;
    setBusy(true);setError('');setNotice('');
    try{
      if(!visualSignPage.trim()||!visualSignX.trim()||!visualSignY.trim()){
        throw new Error('Enter a page number and signature coordinates.');
      }
      const output=await addPdfVisualSignature(original,{
        name:visualSigner,pageNumber:Number(visualSignPage),
        x:Number(visualSignX),y:Number(visualSignY),
      });
      const applied=await onApplyPdf(
        'Add explicitly non-cryptographic visual signature',output,original,
      );
      if(!applied)throw new Error('The PDF changed during signing; mark was not applied.');
      setNotice('Visual signature mark added to the working PDF (Undo available). '+
        'This is not a cryptographic digital signature, trusted timestamp or legal identity verification.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));setNotice('');
    }finally{setBusy(false);}
  }

  async function refreshOfflineOutline(){
    if(!sourceBytes||busy)return;
    const revision=sourceBytes;
    setBusy(true);setError('');setNotice('');
    try{
      const items=await listPdfOutlineTree(revision);
      if(activeSourceRef.current!==revision){
        throw new Error('The working PDF changed; reload the outline inventory.');
      }
      setOutlineItems(items);
      setOutlineTarget(items[0]?.ref??'');
      setNotice('Read '+items.length+' outline entries with their nesting and destinations.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{setBusy(false);}
  }

  async function editOfflineOutline(kind:'add-root'|'add-child'|'rename'|'move-up'|'move-down'|'delete'){
    if(!sourceBytes||busy)return;
    const revision=sourceBytes;
    setBusy(true);setError('');setNotice('');
    try{
      if(kind!=='add-root'&&!outlineTarget){
        throw new Error('Load the outline and select a bookmark first.');
      }
      const page=Number(outlinePage);
      let next:Uint8Array;
      if(kind==='add-root'||kind==='add-child'){
        if(!outlinePage.trim()||!Number.isSafeInteger(page)){
          throw new Error('Enter an integer destination page number.');
        }
        next=await addPdfOutlineTreeEntry(
          revision,outlineTitle,page,kind==='add-child'?outlineTarget:null,
        );
      }else if(kind==='rename'){
        next=await renamePdfOutlineTreeEntry(revision,outlineTarget,outlineTitle);
      }else if(kind==='move-up'||kind==='move-down'){
        next=await movePdfOutlineTreeEntry(revision,outlineTarget,kind==='move-up'?-1:1);
      }else{
        next=await deletePdfOutlineTreeEntry(revision,outlineTarget,outlineDeleteSubtree);
      }
      if(activeSourceRef.current!==revision){
        throw new Error('The working PDF changed; stale outline edits were not applied.');
      }
      const applied=await onApplyPdf('Edit PDF table of contents ('+kind+')',next,revision);
      if(!applied){
        throw new Error('The PDF changed before this outline edit could be committed.');
      }
      setNotice('PDF table of contents updated. Changes support Undo and save/reopen.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{setBusy(false);}
  }

  async function applyOfflinePaperSize(){
    if(!sourceBytes||busy)return;
    setBusy(true);setError('');setNotice('');
    const revision=sourceBytes;
    try{
      const margin=Number(paperMargin);
      if(!paperMargin.trim()||!Number.isFinite(margin)){
        throw new Error('Enter a finite paper margin in points.');
      }
      const output=await fitPdfToPaper(revision,{
        paper:paperSize,orientation:paperOrientation,marginPt:margin,
      });
      const applied=await onApplyPdf('Fit pages to '+paperSize+' '+paperOrientation,output,revision);
      if(!applied)throw new Error('The working PDF changed during paper-size conversion; output was not applied.');
      setNotice('All pages were fitted to '+paperSize+' '+paperOrientation+'. Save or export to retain the result.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{setBusy(false);}
  }

  async function saveLocalSelectableText(){
    if(!sourceBytes||busy)return;
    setBusy(true);setError('');setNotice('');
    let loaded:Awaited<ReturnType<typeof loadPdfBytes>>|null=null;
    try{
      if(!sourceBytes.byteLength||sourceBytes.byteLength>512*1024*1024){
        throw new Error('Selectable-text export requires a PDF of at most 512 MB.');
      }
      loaded=await loadPdfBytes(sourceBytes);
      const result=await extractPdfDocumentText(loaded.document,{
        onProgress:(done,total)=>setNotice(`Reading selectable text: ${done}/${total} pages…`),
      });
      const output=new TextEncoder().encode(result);
      const saved=await provider.saveResponse({
        status:200,contentType:'text/plain; charset=utf-8',bytes:Array.from(output),
      },localExportStem(sourceName)+'-selectable-text');
      setNotice(saved?`Saved selectable PDF text: ${saved}`:'Text export save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{
      try{
        await disposePdf(loaded);
      }finally{
        setBusy(false);
      }
    }
  }

  async function saveOfflineApiManual(){
    if(!status?.running||!catalogLoaded||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const output=buildLocalPdfApiManual(operations,components,status);
      const saved=await provider.saveResponse({
        status:200,contentType:'application/json',bytes:Array.from(output),
      },'malenjo-local-pdf-api-diagnostics');
      setNotice(saved
        ?'Saved local provider API diagnostics: '+saved+
          '. These are reported capabilities, not verified operation results.'
        :'API diagnostics export cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{setBusy(false);}
  }

  async function startProvider(){
    setBusy(true);setError('');
    try{
      const next=await provider.start();setStatus(next);
      const [catalog,nextComponents]=await Promise.all([provider.listOperations(),provider.componentStatus()]);
      setOperations(catalog);setComponents(nextComponents);setCatalogLoaded(true);
      const available=catalog.filter((operation)=>operation.capability.available).length;
      setNotice(`Loaded ${catalog.length} local PDF API operations; ${available} are available through reviewed providers/fallbacks.`);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));await refresh(false);}
    finally{setBusy(false);}
  }

  async function stopProvider(){
    setBusy(true);setError('');
    try{
      await provider.stop();setOperations([]);setSelectedId('');setCatalogLoaded(false);await refresh(false);
      setNotice('Local PDF provider stopped.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }

  async function runSelected(){
    if(!selected||busy)return;
    if(!selected.capability.available){
      setError(selected.capability.disabledReason??'This PDF operation has no reviewed local provider.');
      return;
    }
    setBusy(true);setError('');setNotice('');
    try{
      const fields:Array<{name:string;value:string}>=[];
      const files:PdfProviderInputFile[]=[];
      const sourceRevision=sourceBytes;
      const batchWorkflow=PDF_TWENTY_WORKFLOWS.find(item=>item.path===selected.path);
      // Reject oversized uploads BEFORE materializing file bytes as JS number[].
      const uploadFields=selected.fields.filter(field=>field.kind==='file'||field.kind==='files');
      const activeTotal=uploadFields.reduce((total,field)=>
        total+(useActive[field.name]&&fieldAcceptsActivePdf(field)?sourceRevision?.byteLength??0:0),0);
      const chosen=uploadFields.flatMap(field=>extraFiles[field.name]??[]);
      validatePdfUploadPlan(chosen,activeTotal);
      for(const field of selected.fields){
        if(field.kind==='file'||field.kind==='files'){
          const picked=extraFiles[field.name]??[];
          const usingActive=Boolean(useActive[field.name]&&fieldAcceptsActivePdf(field)&&sourceRevision);
          if(field.kind==='file'&&usingActive&&picked.length){
            throw new Error('Use the current PDF OR one uploaded file for '+field.label+'.');
          }
          const active=usingActive&&sourceRevision?[{
            field:field.name,filename:providerFilename(sourceName),contentType:'application/pdf',bytes:Array.from(sourceRevision),
          }]:[];
          const extras=await Promise.all(picked.map(async(file)=>({
            field:field.name,filename:file.name,contentType:file.type||undefined,bytes:Array.from(new Uint8Array(await file.arrayBuffer())),
          })));
          const combined=[...active,...extras];
          if(field.kind==='file'&&combined.length>1)throw new Error('Use the current PDF OR one uploaded file for '+field.label+'.');
          if(field.required&&!combined.length)throw new Error(`${field.label} is required.`);
          files.push(...combined);continue;
        }
        const value=values[field.name]??'';
        validatePdfOperationValue(field,value);
        if(value.trim()||field.kind==='boolean')fields.push({name:field.name,value});
      }
      const response=await provider.run(selected,fields,files);
      const action=batchWorkflow
        ?await classifyPdfBatchOutput(batchWorkflow,response,provider.responseIsPdf)
        :classifyPdfProviderResult(response,selected.path,provider.responseIsPdf);
      await verifyProviderCompletion(selected.path,action,response,Boolean(sourceRevision));
      if(action==='apply-pdf'&&sourceRevision){
        const applied=await onApplyPdf(`Local PDF core: ${selected.summary}`,Uint8Array.from(response.bytes),sourceRevision);
        if(!applied){
          throw new Error('The generated PDF could not be applied. The original working document was preserved.');
        }
        setNotice(`${selected.summary} completed and was applied to the current MALENJO working copy.`);
      }else{
        const stem=localExportStem(sourceName);
        const saved=await provider.saveResponse(
          action==='save-pdf-copy'?safePdfCopyResponse(response):response,
          action==='save-pdf-copy'?stem+(batchWorkflow?.id==='sanitize-pdf'?'-sanitized-copy':'-protected'):stem,
        );
        setNotice(action==='save-pdf-copy'
          ?saved?'PDF copy saved; original remains unchanged.':'PDF copy export cancelled; original unchanged.'
          :saved?`${selected.summary} completed. Output saved.`:`${selected.summary} completed; output save was cancelled.`);
      }
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }

  function renderField(field:PdfProviderOperationField){
    if(field.kind==='file'||field.kind==='files'){
      const selectedFiles=extraFiles[field.name]??[];
      return <div className="stirling-field" key={field.name}>
        <label><span>{field.label}{field.required?' *':''}</span>
          <input type="file" accept={field.accept} multiple={field.kind==='files'} onChange={(event)=>setExtraFiles((current)=>({...current,[field.name]:Array.from(event.target.files??[])}))}/>
        </label>
        <label className="stirling-active-file">
          <input type="checkbox" checked={Boolean(useActive[field.name])} disabled={!sourceBytes||!fieldAcceptsActivePdf(field)} onChange={(event)=>setUseActive((current)=>({...current,[field.name]:event.target.checked}))}/>
          {fieldAcceptsActivePdf(field)?<>Use current PDF{sourceBytes?` (${sourceName})`:' — no PDF loaded'}</>:'Select a compatible local file'}
        </label>
        <small>{selectedFiles.length?`${selectedFiles.length} additional file(s) selected.`:(field.description??'')}</small>
      </div>;
    }
    if(field.kind==='boolean'){
      return <label className="stirling-field stirling-checkbox" key={field.name}>
        <input type="checkbox" checked={(values[field.name]??'false')==='true'} onChange={(event)=>setValues((current)=>({...current,[field.name]:event.target.checked?'true':'false'}))}/>
        <span>{field.label}{field.required?' *':''}</span>
        {field.description&&<small>{field.description}</small>}
      </label>;
    }
    if(field.enumValues?.length){
      return <label className="stirling-field" key={field.name}>
        <span>{field.label}{field.required?' *':''}</span>
        <select value={values[field.name]??''} onChange={(event)=>setValues((current)=>({...current,[field.name]:event.target.value}))}>
          {!field.required&&<option value="">Default</option>}
          {field.enumValues.map((value)=><option key={value} value={value}>{value}</option>)}
        </select>
        {field.description&&<small>{field.description}</small>}
      </label>;
    }
    if(field.kind==='json'){
      return <label className="stirling-field" key={field.name}>
        <span>{field.label}{field.required?' *':''}</span>
        <textarea rows={4} value={values[field.name]??''} placeholder="JSON" onChange={(event)=>setValues((current)=>({...current,[field.name]:event.target.value}))}/>
        {field.description&&<small>{field.description}</small>}
      </label>;
    }
    return <label className="stirling-field" key={field.name}>
      <span>{field.label}{field.required?' *':''}</span>
      <input type={field.kind==='number'||field.kind==='integer'?'number':'text'} step={field.kind==='integer'?'1':'any'} value={values[field.name]??''} onChange={(event)=>setValues((current)=>({...current,[field.name]:event.target.value}))}/>
      {field.description&&<small>{field.description}</small>}
    </label>;
  }

  return <section className="stirling-tools-panel" aria-label="Local PDF provider tools">
    <header className="stirling-tools-head">
      <div><p className="eyebrow">LOCAL PDF CORE</p><h3>Provider-backed PDF tools</h3><span>{provider.reviewedToolCount} reviewed open-core tool surfaces · runtime API catalog loads from the local provider.</span></div>
      <div className={status?.running?'stirling-provider-state ready':'stirling-provider-state'}>
        {status?.running?<CheckCircle2 size={15}/>:status?.installed?<ServerCog size={15}/>:<TriangleAlert size={15}/>}<span>{status?.running?'Ready':status?.installed?'Installed / stopped':'Provider pack missing'}</span>
      </div>
    </header>
    <div className="stirling-provider-actions">
      <button disabled={busy||Boolean(status?.running)} onClick={()=>void startProvider()}><Play size={14}/>Start local provider</button>
      <button disabled={busy||!status?.running} onClick={()=>void stopProvider()}><Square size={14}/>Stop</button>
      <button disabled={busy} onClick={()=>void refresh(Boolean(status?.running))}><RefreshCw size={14}/>Refresh</button>
      <button disabled={busy||!status?.running||!catalogLoaded}
        onClick={()=>void saveOfflineApiManual()}>
        <FileOutput size={14}/>Export local PDF API contract diagnostics
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveLocalPdfInfo()}>
        <FileOutput size={14}/>Export PDF information (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveOfflineSecurityInspection(false)}>
        <FileOutput size={14}/>Inspect PDF structure and security warnings (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveOfflineSecurityInspection(true)}>
        <FileOutput size={14}/>List embedded PDF JavaScript as inert text (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveMetadataNamedPdfCopy()}>
        <FileOutput size={14}/>Save PDF copy named from metadata title (offline)
      </button>
      <button disabled={busy||!sourceBytes} aria-expanded={metadataEditorOpen}
        onClick={()=>void openLocalMetadataEditor()}>
        <FileOutput size={14}/>{metadataEditorOpen?'Close metadata editor':'Edit PDF metadata (offline)'}
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveLocalSelectableText()}>
        <FileOutput size={14}/>Export selectable text (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveLocalStructuredJson()}>
        <FileOutput size={14}/>Export structured PDF text to JSON (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveLocalStructuredXml()}>
        <FileOutput size={14}/>Export structured PDF text to XML (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveNativeTextFormat('markdown')}>
        <FileOutput size={14}/>Export PDF selectable text to Markdown (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveNativeTextFormat('html')}>
        <FileOutput size={14}/>Export PDF selectable text to HTML (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveNativeTextFormat('csv')}>
        <FileOutput size={14}/>Export page-indexed PDF text to CSV (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveOfflineComicBook()}>
        <FileOutput size={14}/>Export rasterized PDF pages to CBZ comic (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveOfflinePresentation()}>
        <FileOutput size={14}/>Export PDF pages to PowerPoint PPTX slides (offline, rasterized)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveOfflineWordText('docx')}>
        <FileOutput size={14}/>Export selectable PDF text to Word DOCX (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveOfflineWordText('odt')}>
        <FileOutput size={14}/>Export selectable PDF text to OpenDocument ODT (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveOfflineWordText('rtf')}>
        <FileOutput size={14}/>Export selectable PDF text to RTF (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveOfflineEpub()}>
        <FileOutput size={14}/>Export selectable PDF text to EPUB 3 e-book (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void cleanReviewAnnotations()}>
        <FileOutput size={14}/>Remove review annotations (offline)
      </button>
    </div>
    {category==='convert'&&<details className="stirling-component-details" aria-label="Offline CBZ to PDF conversion">
      <summary>CBZ comic images to PDF (offline)</summary>
      <p>Convert up to 50 PNG/JPEG comic pages, naturally ordered by filename, into a real reopenable PDF. Malformed images, archive traversal paths, oversized files and unsupported image types are refused. This raster conversion does not reconstruct searchable text.</p>
      <label className="stirling-field"><span>CBZ comic archive</span>
        <input type="file" accept=".cbz,application/vnd.comicbook+zip" disabled={busy}
          onChange={event=>setCbzToPdfFile(event.target.files?.[0]??null)}/>
      </label>
      <button type="button" disabled={busy||!cbzToPdfFile}
        onClick={()=>void saveOfflineCbzPdf()}>
        <FileOutput size={14}/>Convert CBZ comic to PDF (offline)
      </button>
    </details>}
    {category==='convert'&&<details className="stirling-component-details" aria-label="Offline JSON to PDF conversion">
      <summary>JSON to PDF text report (offline)</summary>
      <p>Choose a valid UTF-8 JSON document to create a paginated, searchable PDF report. This text-only conversion retains the JSON structure and renders non-ASCII characters as reversible JSON Unicode escapes. It does not infer tables, graphical layouts or PDF forms; maximum JSON source is 2 MB.</p>
      <label className="stirling-field"><span>JSON document</span>
        <input type="file" accept=".json,application/json" disabled={busy}
          onChange={event=>setJsonToPdfFile(event.target.files?.[0]??null)}/>
      </label>
      <button type="button" disabled={busy||!jsonToPdfFile}
        onClick={()=>void saveOfflineJsonPdf()}>
        <FileOutput size={14}/>Convert JSON file to PDF (offline)
      </button>
    </details>}
    {category==='convert'&&<details className="stirling-component-details" aria-label="Offline EML email to PDF conversion">
      <summary>EML plain-text email to PDF (offline)</summary>
      <p>Convert a local text/plain email or multipart/alternative MIME message to a searchable PDF, displaying headers and body as inert text. HTML-only messages, attachments, malformed encodings, and unsupported MIME parts are refused rather than fetching remote content or dropping attachments.</p>
      <label className="stirling-field"><span>EML mail file</span>
        <input type="file" accept=".eml,message/rfc822" disabled={busy}
          onChange={event=>setEmlToPdfFile(event.target.files?.[0]??null)}/>
      </label>
      <button type="button" disabled={busy||!emlToPdfFile} onClick={()=>void saveOfflineEmlPdf()}>
        <FileOutput size={14}/>Convert plain-text EML email to PDF (offline)
      </button>
    </details>}
    {category==='convert'&&<details className="stirling-component-details" aria-label="Offline plain-text to PDF conversion">
      <summary>Plain text file to PDF (offline)</summary>
      <p>Convert a literal UTF-8 .txt file into a selectable-text, paginated PDF. Embedded markup is displayed as text, not interpreted. Other Office formats still require a reviewed local provider. Non-WinAnsi Unicode is shown using readable escapes.</p>
      <label className="stirling-field"><span>Plain-text file</span>
        <input type="file" accept=".txt,text/plain" disabled={busy}
          onChange={event=>setTextToPdfFile(event.target.files?.[0]??null)}/>
      </label>
      <button type="button" disabled={busy||!textToPdfFile}
        onClick={()=>void saveOfflinePlainTextPdf()}>
        <FileOutput size={14}/>Convert text file to PDF (offline)
      </button>
    </details>}
    {category==='convert'&&<details className="stirling-component-details" aria-label="Offline Markdown to PDF conversion">
      <summary>Markdown to PDF report (offline)</summary>
      <p>Render UTF-8 Markdown headings, paragraphs, lists, quotes and code to a paginated PDF. No embedded HTML execution or network access. Complex tables, images and Unicode fonts are not reconstructed; characters outside bundled WinAnsi fonts become visible escape sequences.</p>
      <label className="stirling-field"><span>Markdown document</span>
        <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" disabled={busy}
          onChange={event=>setMarkdownToPdfFile(event.target.files?.[0]??null)}/>
      </label>
      <button type="button" disabled={busy||!markdownToPdfFile}
        onClick={()=>void saveOfflineMarkdownPdf()}>
        <FileOutput size={14}/>Convert Markdown file to PDF (offline)
      </button>
    </details>}
    {category==='sign'&&sourceBytes&&<details className="stirling-component-details" aria-label="Add a clearly labeled visual PDF signature">
      <summary>Place a visual signature mark (offline)</summary>
      <p>Draws a name stamp visibly onto the selected PDF page and supports Undo. This is only a graphical name mark; it does not authenticate identity, use a certificate, or cryptographically sign a PDF. Existing signed or certified PDFs are refused.</p>
      <div className="stirling-fields">
        <label className="stirling-field"><span>Name shown on the mark</span>
          <input maxLength={80} value={visualSigner}
            onChange={event=>setVisualSigner(event.target.value)}/>
        </label>
        <label className="stirling-field"><span>Page (1-based)</span>
          <input type="number" min="1" step="1" value={visualSignPage}
            onChange={event=>setVisualSignPage(event.target.value)}/>
        </label>
        <label className="stirling-field"><span>Horizontal position (0–1)</span>
          <input type="number" min="0" max="1" step="0.01" value={visualSignX}
            onChange={event=>setVisualSignX(event.target.value)}/>
        </label>
        <label className="stirling-field"><span>Vertical position (0–1, from bottom)</span>
          <input type="number" min="0" max="1" step="0.01" value={visualSignY}
            onChange={event=>setVisualSignY(event.target.value)}/>
        </label>
      </div>
      <button disabled={busy||!visualSigner.trim()} type="button"
        onClick={()=>void applyVisualSignature()}>
        <FileOutput size={14}/>Apply non-cryptographic visual mark
      </button>
    </details>}
    {category==='forms'&&sourceBytes&&<div className="stirling-provider-actions">
      <button disabled={busy} type="button" onClick={()=>void applyOfflineFormUnlock()}>
        <FileOutput size={14}/>Unlock read-only form fields (offline)
      </button>
      <small>Clears AcroForm read-only flags only. Refuses encrypted, signed or XFA PDFs and never removes password permissions.</small>
    </div>}
    {category==='organize'&&sourceBytes&&<details className="stirling-component-details" aria-label="Offline nested PDF table of contents">
      <summary>Edit nested PDF table of contents (offline)</summary>
      <p>Add top-level or nested bookmarks targeting real pages; rename, reorder siblings, or remove entries. Preserve imported named destinations and hidden branches. This modifies the working PDF with Undo; certified, XFA and signed PDFs are refused.</p>
      <div className="stirling-provider-actions">
        <button type="button" disabled={busy} onClick={()=>void refreshOfflineOutline()}>Load / refresh PDF outline</button>
        <label>Bookmark title <input type="text" maxLength={200} value={outlineTitle}
          onChange={event=>setOutlineTitle(event.target.value)} placeholder="Chapter name"/></label>
        <label>Target page <input type="number" min="1" step="1" value={outlinePage}
          onChange={event=>setOutlinePage(event.target.value)}/></label>
        <label>Selected bookmark
          <select value={outlineTarget} onChange={event=>setOutlineTarget(event.target.value)}>
            <option value="">Choose an existing bookmark</option>
            {outlineItems.map(item=><option key={item.ref} value={item.ref}>
              {'\u00A0'.repeat(Math.min(2*item.depth,30))}{item.title}{item.pageNumber?' (p.'+item.pageNumber+')':''}
            </option>)}
          </select>
        </label>
        <button type="button" disabled={busy||!outlineTitle.trim()}
          onClick={()=>void editOfflineOutline('add-root')}>Add top-level bookmark</button>
        <button type="button" disabled={busy||!outlineTarget||!outlineTitle.trim()}
          onClick={()=>void editOfflineOutline('add-child')}>Add nested bookmark</button>
        <button type="button" disabled={busy||!outlineTarget||!outlineTitle.trim()}
          onClick={()=>void editOfflineOutline('rename')}>Rename selected</button>
        <button type="button" disabled={busy||!outlineTarget}
          onClick={()=>void editOfflineOutline('move-up')}>Move up among siblings</button>
        <button type="button" disabled={busy||!outlineTarget}
          onClick={()=>void editOfflineOutline('move-down')}>Move down among siblings</button>
        <label><input type="checkbox" checked={outlineDeleteSubtree}
          onChange={event=>setOutlineDeleteSubtree(event.target.checked)}/>
          Permit deleting selected bookmark and all descendants
        </label>
        <button type="button" disabled={busy||!outlineTarget}
          onClick={()=>void editOfflineOutline('delete')}>Delete selected bookmark</button>
      </div>
      <small>Loaded {outlineItems.length} bookmarks. After applying an edit, refresh the list for updated PDF object references. Nested subtree deletion requires the explicit checkbox.</small>
    </details>}
    {category==='organize'&&sourceBytes&&<details className="stirling-component-details" aria-label="Offline PDF booklet imposition">
      <summary>Arrange PDF pages as a saddle-stitch booklet (offline)</summary>
      <p>Create double-page landscape spreads ordered for left-to-right duplex booklet printing, with blank pages added when necessary. PDF vector content is preserved; interactive fields, annotations, signed documents, links, bookmarks and rotated pages are refused rather than silently lost. Exported booklet is a separate PDF copy.</p>
      <button type="button" disabled={busy} onClick={()=>void saveOfflineBooklet()}>
        <FileOutput size={14}/>Export two-up booklet PDF
      </button>
    </details>}
    {category==='organize'&&sourceBytes&&<details className="stirling-component-details" aria-label="Native PDF paper size">
      <summary>Fit pages to A4 / Letter / Legal / A5 (offline)</summary>
      <p>Resize all pages while fitting existing page content inside the chosen paper size. This does not reflow paragraphs. For safety, documents with forms, signatures, links, annotations, rotated pages, or custom page boxes are refused instead of losing interactive content. This edit supports Undo.</p>
      <div className="stirling-provider-actions">
        <label>Paper <select value={paperSize} onChange={event=>setPaperSize(event.target.value as PdfPaperSize)}>
          <option value="A4">A4</option><option value="Letter">Letter</option><option value="Legal">Legal</option><option value="A5">A5</option>
        </select></label>
        <label>Orientation <select value={paperOrientation} onChange={event=>setPaperOrientation(event.target.value as PdfPaperOrientation)}>
          <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
        </select></label>
        <label>Margin (pt) <input type="number" min="0" max="72" step="1" value={paperMargin}
          onChange={event=>setPaperMargin(event.target.value)} /></label>
        <button type="button" disabled={busy} onClick={()=>void applyOfflinePaperSize()}>Fit current PDF pages</button>
      </div>
    </details>}
    {category==='organize'&&sourceBytes&&<details className="stirling-component-details" aria-label="Offline PDF split by page count">
      <summary>Split into page groups (offline)</summary>
      <p>Save a ZIP of consecutive PDFs, each containing the selected number of pages. The original PDF is unchanged. Interactive forms and signed files are not supported by this fallback; use the provider for larger documents.</p>
      <label className="stirling-field"><span>Pages per PDF</span>
        <input type="number" min={1} max={1000} step={1}
          value={splitPagesPerPart}
          onChange={event=>setSplitPagesPerPart(event.target.value)}/>
      </label>
      <button disabled={busy} onClick={()=>void saveOfflinePageGroups()}>
        <FileOutput size={14}/>Export separate PDFs as ZIP
      </button>
    </details>}
    {metadataEditorOpen&&sourceBytes&&<div className="stirling-operation" aria-label="Edit PDF metadata offline">
      <b>Edit standard PDF metadata</b>
      <p>Changes the PDF Info title, author, subject and keywords locally. This is not privacy sanitization or XMP removal. Signed PDFs are refused because rewriting may invalidate signatures.</p>
      <div className="stirling-fields">
        {(['title','author','subject','keywords'] as const).map(field=><label className="stirling-field" key={field}>
          <span>{field==='title'?'Title':field==='author'?'Author':field==='subject'?'Subject':'Keywords (comma-separated)'}</span>
          <input value={metadataDraft[field]} maxLength={4096}
            onChange={event=>setMetadataDraft(current=>({...current,[field]:event.target.value}))}/>
        </label>)}
      </div>
      <button className="stirling-run" disabled={busy} onClick={()=>void applyLocalMetadata()}>
        Apply metadata to working PDF
      </button>
    </div>}
    <p className="stirling-provider-message">{status?.message??'Checking local provider…'}</p>
    {!!components.length&&<details className="stirling-component-details">
      <summary>{components.filter((component)=>component.available).length}/{components.length} reviewed provider components available</summary>
      <div className="stirling-components" aria-label="Local PDF component status">
        {components.map((component)=><div key={component.id} className={component.available?'stirling-component ready':'stirling-component'}>
          {component.available?<CheckCircle2 size={13}/>:<TriangleAlert size={13}/>}
          <span><b>{component.id}</b><small>{component.version??component.message}</small></span>
        </div>)}
      </div>
    </details>}
    <details className="stirling-component-details" aria-label="Stirling PDF parity inventory">
      <summary>
        Stirling 90-tool parity register: {parity.upstreamFixtureMatched} tested API matches, {parity.pinnedControllerOnlyRouteMatches} additional Java controller matches, {parity.frontendOnlyRouteMatches} frontend-only matches, {parity.configurationOnlyMatches} configuration-only entries; {parity.sourceClassificationPending} unclassified;
        {catalogLoaded?` ${parity.liveRoutes} live routes / ${parity.providerEnabled} provider-enabled (unverified)`:' load local provider to check runtime'}
      </summary>
      <p className="stirling-provider-message">
        {parity.locallySourceAuditedPartial} local MALENJO operations have partial source/test evidence; {parity.total-parity.locallySourceAuditedPartial} still need a full implementation-source audit. A provider reporting an available endpoint is
        NOT proof of functional correctness, offline Windows operation, safe licensing,
        or export/reopen fidelity. {parity.functionallyVerified} of {parity.total} operations have passed the complete parity acceptance gate.
      </p>
      <div style={{maxHeight:340,overflowY:'auto'}}>
        <table aria-label="Stirling PDF tool parity by requirement">
          <thead><tr><th scope="col"># / Tool</th><th scope="col">Pinned API</th><th scope="col">Local provider</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {parity.rows.map((row)=><tr key={row.id}>
              <th scope="row">{row.order}. {row.id}</th>
              <td>{row.expectedEndpoint?`${row.expectedEndpoint}${row.controllerOnly?' (controller only)':''}`:(row.frontendRoute?`${row.frontendRoute} (frontend only)`:'No pinned route identified')}</td>
              <td>{row.functionallyVerified?'Release accepted; ':row.locallySourceAuditedPartial?'Local foundation partial; ':''}{row.state==='provider-reports-available'?'Reported enabled; unverified'
                :row.state==='provider-disabled'?'Provider disabled'
                :row.state==='not-in-live-openapi'?'Missing from loaded OpenAPI'
                :row.state==='provider-not-loaded'?'Start local provider'
                :row.frontendCoreToolId?`Frontend ${row.frontendCoreToolId}; provider route unverified`:row.configurationOnly?'Configured upstream, no verified handler':'Needs upstream source investigation'}</td>
              <td><button type="button"
                disabled={!row.operation?.capability.available}
                onClick={()=>{if(row.operation){setAllCategories(true);setSearch('');setSelectedId(row.operation.id);}}}>
                Open
              </button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </details>
    <details className="stirling-component-details" aria-label="20 PDF processing workflows">
      <summary>20-operation PDF batch · source-pinned local workflows</summary>
      <p className="stirling-provider-message">Open a workflow's live provider form to configure its inputs. Operations are enabled only when present and capability-approved in the local runtime. Source-pinning and type checks do not establish clean Windows offline or export/reopen parity.</p>
      <div className="stirling-provider-actions" role="group" aria-label="PDF processing workflow selector">
        {PDF_TWENTY_WORKFLOWS.map(workflow=>{
          const operation=findPdfBatchOperation(workflow,operations);
          return <button type="button" key={workflow.id} disabled={busy||!operation?.capability.available}
            title={operation?.capability.available?workflow.path:operation?.capability.disabledReason??'Unavailable in live local API'}
            onClick={()=>{if(operation){setAllCategories(true);setSearch('');setSelectedId(operation.id);}}}>
            {workflow.label}
          </button>;
        })}
      </div>
    </details>
    {!status?.installed&&<p className="stirling-provider-help">Windows development pack: <code>powershell -ExecutionPolicy Bypass -File scripts/build-stirling-core.ps1</code>. The provider runs on 127.0.0.1 only and never starts at MALENJO launch.</p>}
    {status?.running&&<div className="stirling-catalog">
      <div className="stirling-catalog-filter">
        <label><Search size={14}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search local PDF API tools"/></label>
        <label className="stirling-all-categories"><input type="checkbox" checked={allCategories} onChange={(event)=>setAllCategories(event.target.checked)}/>All categories</label>
        <span>{filtered.length} operation{filtered.length===1?'':'s'}</span>
      </div>
      <label className="stirling-operation-select"><span>Tool</span><span className="select-wrap"><select value={selectedId} onChange={(event)=>setSelectedId(event.target.value)}>{filtered.map((operation)=><option key={operation.id} value={operation.id} disabled={!operation.capability.available}>{operation.summary}{operation.capability.available?'':' — unavailable'}</option>)}</select><ChevronDown size={13}/></span></label>
      {selected&&<div className="stirling-operation">
        <div className="stirling-operation-title"><div><b>{selected.summary}</b><small>{selected.method} {selected.path}</small></div><span>{selected.category}</span></div>
        {selected.description&&<p>{selected.description}</p>}
        <p className={selected.capability.available?'stirling-provider-message':'stirling-error'}>
          <b>{selected.capability.available?'Implementation':'Unavailable'}:</b> {selected.capability.implementation}
          {selected.capability.providerVersion?` · ${selected.capability.providerVersion}`:''}
          {selected.capability.componentPack?` · ${selected.capability.componentPack}`:''}
          {!selected.capability.available&&selected.capability.disabledReason?` — ${selected.capability.disabledReason}`:''}
          {selected.capability.fallback?` · Fallback: ${selected.capability.fallback}`:''}
        </p>
        <div className="stirling-fields">{selected.fields.map(renderField)}</div>
        <button className="stirling-run" disabled={busy||!selected.capability.available} onClick={()=>void runSelected()}><FileOutput size={15}/>{busy?'Running locally…':selected.capability.available?`Run ${selected.summary}`:'Provider unavailable'}</button>
      </div>}
      {!filtered.length&&<div className="stirling-empty">No local provider operation matches this task category/search.</div>}
    </div>}
    {notice&&<div className="stirling-notice" role="status">{notice}</div>}
    {error&&<div className="stirling-error" role="alert">{error}</div>}
  </section>;
}