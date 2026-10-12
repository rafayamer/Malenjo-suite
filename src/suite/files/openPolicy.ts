import type { LibraryDocumentKind } from './types';

/** Only native MALENJO PDF/CAD/DICOM document types are directly openable.
 * DOCX/XLSX/PPTX are editor output surfaces reached AFTER successful PDF
 * conversion, not independent imports or Windows default-open associations.
 */
export const MALENJO_DIRECT_OPEN_EXTENSIONS = ['pdf','dxf','dwg','dcm','dicom'] as const;

const allowed = new Set<string>(MALENJO_DIRECT_OPEN_EXTENSIONS);
export function isMalenjoDirectOpenExtension(nameOrExtension: string): boolean {
  const extension = nameOrExtension.includes('.')
    ? nameOrExtension.split('.').at(-1) ?? ''
    : nameOrExtension;
  return allowed.has(extension.trim().toLowerCase());
}

export function isMalenjoDirectOpenKind(kind: LibraryDocumentKind): boolean {
  return kind === 'pdf' || kind === 'cad' || kind === 'dicom';
}
