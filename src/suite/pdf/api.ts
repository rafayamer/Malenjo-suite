import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

export async function readPdfDocumentBytes(documentId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_pdf_document', { documentId });
}

export async function exportPdfJsonText(name:string,contents:string):Promise<boolean>{
  const encoded=new TextEncoder().encode(contents);
  if(encoded.byteLength>1024*1024)throw new Error('PDF JSON export exceeds the 1 MB safety limit.');
  if(!isTauri()){
    const blob=new Blob([encoded],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=name;
    anchor.rel='noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  const destination=await save({
    title:'Export PDF form data',
    defaultPath:name,
    filters:[{name:'JSON',extensions:['json']}],
  });
  if(!destination)return false;
  return invoke<boolean>('write_pdf_tool_output',{destination,bytes:Array.from(encoded)});
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
