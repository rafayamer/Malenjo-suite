import { invoke } from '@tauri-apps/api/core';

export async function readPdfDocumentBytes(documentId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_pdf_document', { documentId });
}
