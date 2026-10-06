import type { LibraryDocument, LibraryDocumentKind } from './types';

export function kindFromFilename(name: string): LibraryDocumentKind {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
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

function browserId(file: File): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `browser:${file.name}:${file.size}:${file.lastModified}:${random}`;
}

export function documentFromBrowserFile(file: File): LibraryDocument {
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? '' : '';
  return {
    id: browserId(file),
    name: file.name,
    extension,
    kind: kindFromFilename(file.name),
    sizeBytes: file.size,
    modifiedMs: file.lastModified || Date.now(),
    addedMs: Date.now(),
    lastOpenedMs: Date.now(),
    available: true,
    locationLabel: 'Browser / Codespaces session',
  };
}
