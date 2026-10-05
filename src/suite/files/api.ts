import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { ImportResult, LibraryDocument, StagedDocument } from './types';

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function listLibraryDocuments(): Promise<LibraryDocument[]> {
  return invoke<LibraryDocument[]>('list_library_documents');
}

export async function chooseAndAddDocuments(): Promise<ImportResult | null> {
  const selected = await open({
    multiple: true,
    directory: false,
    title: 'Add documents to MALENJO',
  });

  if (selected === null) return null;
  const paths = Array.isArray(selected) ? selected : [selected];
  return invoke<ImportResult>('add_library_documents', { paths });
}

export async function openLibraryDocument(documentId: string): Promise<LibraryDocument> {
  return invoke<LibraryDocument>('open_library_document', { document_id: documentId });
}

export async function refreshLibraryDocument(documentId: string): Promise<LibraryDocument> {
  return invoke<LibraryDocument>('refresh_library_document', { document_id: documentId });
}

export async function removeLibraryDocument(documentId: string): Promise<boolean> {
  return invoke<boolean>('remove_library_document', { document_id: documentId });
}

export async function saveAsLibraryDocument(document: LibraryDocument): Promise<LibraryDocument | null> {
  const destination = await save({
    title: 'Save a copy',
    defaultPath: document.name,
    filters: document.extension
      ? [{ name: document.extension.toUpperCase(), extensions: [document.extension] }]
      : undefined,
  });

  if (!destination) return null;
  return invoke<LibraryDocument>('save_as_library_document', {
    document_id: document.id,
    destination,
  });
}

export async function stageLibraryDocument(documentId: string): Promise<StagedDocument> {
  return invoke<StagedDocument>('stage_library_document', { document_id: documentId });
}

export async function commitStagedDocument(documentId: string, stagingToken: string): Promise<LibraryDocument> {
  return invoke<LibraryDocument>('commit_staged_document', {
    document_id: documentId,
    staging_token: stagingToken,
  });
}

export async function discardStagedDocument(stagingToken: string): Promise<boolean> {
  return invoke<boolean>('discard_staged_document', { staging_token: stagingToken });
}
