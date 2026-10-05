import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { ImportResult, LibraryDocument } from './types';

const documentFilters = [{
  name: 'Documents',
  extensions: [
    'pdf', 'doc', 'docx', 'odt', 'rtf',
    'xls', 'xlsx', 'xlsm', 'csv', 'ods',
    'ppt', 'pptx', 'odp',
    'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif', 'webp', 'heic',
    'dxf', 'dwg', 'dcm', 'dicom'
  ],
}];

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
    filters: documentFilters,
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
