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
