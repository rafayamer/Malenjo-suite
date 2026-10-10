import {useState} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import type {PdfToolProvider} from './backend';
import {loadPdfBytes,disposePdf} from './engine';
import {exportPdfCbz} from './pdfToCbz';

interface WriterStatus{available:boolean;message:string}
const MAX_INPUT=16*1024*1024;
export default function PdfCbrPanel({
  sourceBytes,sourceName,provider,
}:{
  sourceBytes:Uint8Array;
  sourceName:string;
  provider:PdfToolProvider;
}){
  const [status,setStatus]=useState<WriterStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  async function check(){
    if(!isTauri()){setError('CBR archive writing requires native Windows and a user-configured licensed RAR writer.');return;}
    try{setStatus(await invoke<WriterStatus>('rar_cbr_status'));setError('');}
    catch(e){setError(e instanceof Error?e.message:String(e));}
  }
  async function convert(){
    if(busy||!status?.available||!isTauri())return;
    if(!window.confirm('Export a NEW genuine CBR (RAR) comic archive using your independently licensed Rar.exe? The PDF pages will be rasterized as PNG and stored temporarily until the native RAR writer finishes. No RAR executable is bundled. Continue?'))return;
    setBusy(true);setError('');setMessage('');
    let loaded:Awaited<ReturnType<typeof loadPdfBytes>>|null=null;
    try{
      if(sourceBytes.length<5||sourceBytes.length>MAX_INPUT)throw new Error('CBR source PDF must be at most 16 MB.');
      loaded=await loadPdfBytes(sourceBytes);
      if(loaded.document.numPages<1||loaded.document.numPages>20)throw new Error('CBR supports 1 to 20 PDF pages.');
      const pngArchive=await exportPdfCbz(loaded.document);
      if(pngArchive.length>32*1024*1024)throw new Error('PNG pages exceed the 32 MB RAR staging limit.');
      const encoded=await invoke<number[]>('rar_create_cbr_from_png_zip',{zipBytes:Array.from(pngArchive)});
      const bytes=Uint8Array.from(encoded);
      const rar4=bytes.length>=7&&[82,97,114,33,26,7,0].every((value,i)=>bytes[i]===value);
      const rar5=bytes.length>=8&&[82,97,114,33,26,7,1,0].every((value,i)=>bytes[i]===value);
      if(!rar4&&!rar5)throw new Error('Local provider returned a non-RAR archive; CBR export refused.');
      const stem=sourceName.replace(/\.pdf$/i,'').replace(/[^a-z0-9._-]/gi,'_').slice(0,80)||'document';
      const saved=await provider.saveResponse({status:200,
        contentType:'application/vnd.comicbook-rar',bytes:Array.from(bytes),
      },stem+'-comic');
      setMessage(saved?'Saved genuine RAR comic-book CBR: '+saved+'. The source PDF is unchanged.':
        'CBR export cancelled; source unchanged.');
    }catch(e){setError(e instanceof Error?e.message:String(e));setMessage('');}
    finally{await disposePdf(loaded);setBusy(false);}
  }
  return <details className="stirling-component-details" aria-label="PDF to genuine licensed RAR comic-book CBR archive">
    <summary>PDF pages to CBR comic archive (external licensed RAR writer)</summary>
    <p>Produce a real RAR4/RAR5 comic archive from rasterized PNG pages. This is NOT a renamed CBZ ZIP. A separately licensed, user-configured Rar.exe via MALENJO_RAR_BIN is required and not redistributed by MALENJO. No selectable PDF text or interactive objects survive image conversion.</p>
    <button type="button" disabled={busy||!isTauri()} onClick={()=>void check()}>Check configured RAR writer</button>
    <p>{status?.message??'No RAR provider has been verified.'}</p>
    <button type="button" disabled={busy||!status?.available} onClick={()=>void convert()}>Export PNG page images as genuine CBR</button>
    {error&&<p role="alert">{error}</p>}
    {message&&<p>{message}</p>}
  </details>;
}