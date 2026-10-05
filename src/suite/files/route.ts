import type { ModuleId } from '../core/types';
import type { LibraryDocumentKind } from './types';

export function workspaceForDocument(kind: LibraryDocumentKind): ModuleId {
  switch (kind) {
    case 'pdf': return 'pdf';
    case 'docx': return 'word';
    case 'xlsx': return 'spreadsheet';
    case 'pptx': return 'presentation';
    case 'cad': return 'cad';
    case 'dicom': return 'dicom';
    case 'image':
    case 'other':
    default:
      return 'files';
  }
}
