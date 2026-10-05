import type { LibraryDocument, LibraryDocumentKind } from './types';

interface BrowserEntry {
  document: LibraryDocument;
  file: File;
}

const entries = new Map<string, BrowserEntry>();

function kindFromExtension(extension: string): LibraryDocumentKind {
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

function token(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function registerBrowserFiles(files: FileList | File[]): LibraryDocument[] {
  return Array.from(files).map((file) => {
    const id = token();
    const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
    const document: LibraryDocument = {
      id: `browser-${id}`,
      name: file.name,
      extension,
      kind: kindFromExtension(extension),
      sizeBytes: file.size,
      modifiedMs: file.lastModified || Date.now(),
      addedMs: Date.now(),
      lastOpenedMs: null,
      available: true,
      locationLabel: 'Codespaces/browser session',
      runtimeSource: 'browser-session',
      runtimeToken: id,
    };
    entries.set(id, { document, file });
    return document;
  });
}

export function listBrowserDocuments(): LibraryDocument[] {
  return Array.from(entries.values())
    .map((entry) => entry.document)
    .sort((a, b) => b.addedMs - a.addedMs);
}

export function getBrowserFile(runtimeToken: string | undefined): File | null {
  if (!runtimeToken) return null;
  return entries.get(runtimeToken)?.file ?? null;
}

export function markBrowserDocumentOpened(document: LibraryDocument): LibraryDocument {
  if (document.runtimeSource !== 'browser-session' || !document.runtimeToken) return document;
  const entry = entries.get(document.runtimeToken);
  if (!entry) return document;
  const next = { ...entry.document, lastOpenedMs: Date.now() };
  entries.set(document.runtimeToken, { ...entry, document: next });
  return next;
}

export function removeBrowserDocument(document: LibraryDocument): boolean {
  if (document.runtimeSource !== 'browser-session' || !document.runtimeToken) return false;
  return entries.delete(document.runtimeToken);
}
