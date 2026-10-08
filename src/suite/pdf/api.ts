import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { safePdfAttachmentExportName } from './navigation';

export async function readPdfDocumentBytes(documentId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_pdf_document', { documentId });
}

export async function exportPdfBytes(name:string,bytes:Uint8Array):Promise<boolean>{
  const copy=Uint8Array.from(bytes);
  if(!isTauri()){
    const blob=new Blob([copy.buffer],{type:'application/pdf'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=name;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  }

  const destination=await save({
    title:'Export PDF',
    defaultPath:name,
    filters:[{name:'PDF',extensions:['pdf']}],
  });
  if(!destination)return false;
  return invoke<boolean>('write_pdf_copy',{destination,bytes:Array.from(copy)});
}


/** Save extracted selectable text; never mislabel the output as a PDF. */
export async function exportPdfPlainText(name:string,text:string):Promise<boolean>{
  const bytes=new TextEncoder().encode(text);
  if(!bytes.byteLength)throw new Error('No PDF text to export.');
  if(!/\.txt$/i.test(name))throw new Error('PDF text exports require a .txt filename.');

  if(!isTauri()){
    const blob=new Blob([bytes.buffer],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=name;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  }

  const destination=await save({
    title:'Export PDF text',
    defaultPath:name,
    filters:[{name:'Plain text',extensions:['txt']}],
  });
  if(!destination)return false;
  if(!/\.txt$/i.test(destination))throw new Error('PDF text exports require a .txt destination.');
  return invoke<boolean>('write_pdf_tool_output',{destination,bytes:Array.from(bytes)});
}


/**
 * Save an embedded PDF file as an untrusted local artifact. Never auto-open or
 * preview attachment contents. Unknown/executable extensions become .bin.
 */
export async function exportPdfEmbeddedAttachment(name:string,bytes:Uint8Array):Promise<boolean>{
  if(!bytes.byteLength)throw new Error('Embedded attachment has no data.');
  if(bytes.byteLength>32*1024*1024)throw new Error('Embedded attachment exceeds the 32 MB extraction safety limit.');
  const safeName=safePdfAttachmentExportName(name);
  const copy=Uint8Array.from(bytes);

  if(!isTauri()){
    const blob=new Blob([copy.buffer],{type:'application/octet-stream'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=safeName;
    anchor.rel='noopener';
    anchor.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    return true;
  }

  const destination=await save({title:'Extract PDF attachment',defaultPath:safeName});
  if(!destination)return false;
  const expectedExtension=safeName.split('.').pop()?.toLowerCase();
  const destinationExtension=destination.split('.').pop()?.toLowerCase();
  if(!expectedExtension||expectedExtension!==destinationExtension){
    throw new Error('Attachment destination extension must match the safely exported filename.');
  }
  return invoke<boolean>('write_pdf_tool_output',{destination,bytes:Array.from(copy)});
}
