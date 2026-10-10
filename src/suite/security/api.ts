import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type {
  AdapterStatus,
  AuditEvent,
  MalwareScanResult,
  SignatureValidationResult,
} from './types';

export function canUseNativeSecurity(): boolean {
  return isTauri();
}

export async function recordAuditEvent(action: string, severity: string, target: string, detail: string): Promise<AuditEvent | null> {
  if (!isTauri()) return null;
  return invoke<AuditEvent>('record_audit_event', { action, severity, target, detail });
}

export async function listAuditEvents(): Promise<AuditEvent[]> {
  if (!isTauri()) return [];
  return invoke<AuditEvent[]>('list_audit_events');
}

export async function clamavStatus(): Promise<AdapterStatus> {
  return invoke<AdapterStatus>('clamav_status');
}

export async function scanLibraryDocument(documentId: string): Promise<MalwareScanResult> {
  return invoke<MalwareScanResult>('clamav_scan_document', { documentId });
}

export async function pyhankoStatus(): Promise<AdapterStatus> {
  return invoke<AdapterStatus>('pyhanko_status');
}

export async function validateSignedPdf(documentId: string): Promise<SignatureValidationResult> {
  return invoke<SignatureValidationResult>('pyhanko_validate_document', { documentId });
}

export async function signPdfCopy(documentId: string, defaultName: string, passphrase: string): Promise<boolean> {
  const identity = await open({
    multiple:false,
    directory:false,
    title:'Choose PKCS#12 signing identity',
    filters:[{ name:'PKCS#12', extensions:['p12','pfx'] }],
  });
  if (!identity || Array.isArray(identity)) return false;

  const destination = await save({
    title:'Save signed PDF copy',
    defaultPath:defaultName.replace(/\.pdf$/i, '-signed.pdf'),
    filters:[{ name:'PDF', extensions:['pdf'] }],
  });
  if (!destination) return false;

  const token = await invoke<string>('store_ephemeral_secret', { secret:passphrase });
  try {
    return await invoke<boolean>('pyhanko_sign_copy', {
      documentId,
      pkcs12Path:identity,
      secretToken:token,
      destination,
    });
  } finally {
    await invoke<boolean>('clear_ephemeral_secret', { token }).catch(() => false);
  }
}

export interface PdfPermissionSettings{
  printing:'none'|'low'|'full';
  modification:'none'|'assembly'|'form'|'annotate'|'all';
  allowCopy:boolean;
  allowAnnotate:boolean;
  allowFormFill:boolean;
}
/** Encrypt a separate saved library document via reviewed local qpdf.
 * Passwords go to one-shot Rust secret tokens and then qpdf stdin @-,
 * never to a process-command-line argument. */
export async function changePdfPermissionsCopy(
  documentId:string,defaultName:string,
  ownerPassword:string,userPassword:string,
  options:PdfPermissionSettings,
):Promise<boolean>{
  if(!isTauri())throw new Error('PDF permission changes require the native desktop qpdf provider.');
  if(ownerPassword.length<10||ownerPassword.length>128||
     userPassword.length>128||
     (userPassword.length>0&&ownerPassword===userPassword)||
     /[\r\n\u0000]/.test(ownerPassword+userPassword)){
    throw new Error('Use a 10–128-character owner password distinct from the optional user password; line breaks are forbidden.');
  }
  const destination=await save({
    title:'Save separate permissions-protected PDF',
    defaultPath:defaultName.replace(/\.pdf$/i,'-restricted.pdf'),
    filters:[{name:'PDF',extensions:['pdf']}],
  });
  if(!destination)return false;
  let userToken:string|null=null,ownerToken:string|null=null;
  try{
    userToken=await invoke<string>('store_ephemeral_secret',{secret:userPassword});
    ownerToken=await invoke<string>('store_ephemeral_secret',{secret:ownerPassword});
    return await invoke<boolean>('qpdf_change_permissions_copy',{
      documentId,userSecretToken:userToken,ownerSecretToken:ownerToken,
      destination,options,
    });
  }finally{
    if(userToken)await invoke('clear_ephemeral_secret',{token:userToken}).catch(()=>false);
    if(ownerToken)await invoke('clear_ephemeral_secret',{token:ownerToken}).catch(()=>false);
  }
}
