import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

export async function readOfficeDocument(documentId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_office_document', { documentId });
}

export async function exportOfficeCopy(name: string, bytes: Uint8Array): Promise<boolean> {
  if (!isTauri()) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  }

  const extension = name.split('.').pop() || 'docx';
  const destination = await save({
    title: 'Export Office document',
    defaultPath: name,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  if (!destination) return false;

  return invoke<boolean>('write_office_copy', {
    destination,
    bytes: Array.from(bytes),
  });
}
