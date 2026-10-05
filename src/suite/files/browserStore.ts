import type { LibraryDocument, LibraryDocumentKind } from './types';

const entries = new Map<string, LibraryDocument>();

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
    const id = `browser-${token()}`;
    const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
    const document: LibraryDocument = {
      id,
      name: file.name,
      extension,
      kind: kindFromExtension(extension),
      sizeBytes: file.size,
      modifiedMs: file.lastModified || Date.now(),
      addedMs: Date.now(),
      lastOpenedMs: null,
      available: true,
      locationLabel: 'Codespaces/browser session',
      browserFile: file,
      ephemeral: true,
    };
    entries.set(id, document);
    return document;
  });
}

export function listBrowserDocuments(): LibraryDocument[] {
  return Array.from(entries.values()).sort((a, b) => b.addedMs - a.addedMs);
}

export function markBrowserDocumentOpened(document: LibraryDocument): LibraryDocument {
  const current = entries.get(document.id);
  if (!current) return document;
  const next = { ...current, lastOpenedMs: Date.now() };
  entries.set(document.id, next);
  return next;
}

export function removeBrowserDocument(document: LibraryDocument): boolean {
  return entries.delete(document.id);
}
