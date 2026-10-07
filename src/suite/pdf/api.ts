import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

export async function readPdfDocumentBytes(documentId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_pdf_document', { documentId });
}

export async function exportPdfDataText(name:string,text:string):Promise<boolean>{
  const bytes=new TextEncoder().encode(text);
  if(!bytes.length)throw new Error('PDF data export is empty.');
  if(bytes.length>8*1024*1024)throw new Error('PDF data export exceeds the 8 MB safety limit.');

  if(!isTauri()){
    const blob=new Blob([bytes.buffer],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=name;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  }

  const destination=await save({
    title:'Export PDF form data',
    defaultPath:name,
    filters:[{name:'JSON',extensions:['json']}],
  });
  if(!destination)return false;
  return invoke<boolean>('write_pdf_tool_output',{destination,bytes:Array.from(bytes)});
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
