import type { LibraryDocument, LibraryDocumentKind } from './types';

const browserFiles = new Map<string, File>();
const browserDocuments = new Map<string, LibraryDocument>();

function extensionOf(name: string): string {
  const match = name.toLowerCase().match(/\.([^.]+)$/);
  return match?.[1] ?? '';
}

function kindOf(extension: string): LibraryDocumentKind {
  switch (extension) {
    case 'pdf': return 'pdf';
    case 'docx': return 'docx';
    case 'xlsx': return 'xlsx';
    case 'pptx': return 'pptx';
    case 'dxf':
    case 'dwg': return 'cad';
    case 'dcm':
    case 'dicom': return 'dicom';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'tif':
    case 'tiff':
    case 'bmp': return 'image';
    default: return 'other';
  }
}

function documentId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `browser-${Date.now().toString(36)}-${random}`;
}

export function addBrowserDocuments(files: Iterable<File>): LibraryDocument[] {
  const added: LibraryDocument[] = [];
  for (const file of files) {
    if (!file.size) continue;
    const extension = extensionOf(file.name);
    const id = documentId();
    const document: LibraryDocument = {
      id,
      name: file.name,
      extension,
      kind: kindOf(extension),
      sizeBytes: file.size,
      modifiedMs: file.lastModified || Date.now(),
      addedMs: Date.now(),
      lastOpenedMs: null,
      available: true,
      locationLabel: 'Codespaces / browser session',
      runtimeSource: 'browser-session',
    };
    browserFiles.set(id, file);
    browserDocuments.set(id, document);
    added.push(document);
  }
  return added;
}

export function listBrowserDocuments(): LibraryDocument[] {
  return [...browserDocuments.values()]
    .sort((a, b) => (b.lastOpenedMs ?? b.addedMs) - (a.lastOpenedMs ?? a.addedMs));
}

export function openBrowserDocument(documentId: string): LibraryDocument {
  const current = browserDocuments.get(documentId);
  if (!current || !browserFiles.has(documentId)) {
    throw new Error('The browser-session document is no longer available. Re-add it from Files.');
  }
  const next = { ...current, lastOpenedMs: Date.now(), available: true };
  browserDocuments.set(documentId, next);
  return next;
}

export function removeBrowserDocument(documentId: string): boolean {
  const had = browserDocuments.delete(documentId);
  browserFiles.delete(documentId);
  return had;
}

export function getBrowserDocumentFile(documentId: string): File {
  const file = browserFiles.get(documentId);
  if (!file) throw new Error('The browser-session file is no longer available. Re-add it from Files.');
  return file;
}

export async function readBrowserDocumentBytes(documentId: string): Promise<ArrayBuffer> {
  return getBrowserDocumentFile(documentId).arrayBuffer();
}

export function downloadBrowserDocument(documentId: string, name?: string): void {
  const file = getBrowserDocumentFile(documentId);
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name || file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}
