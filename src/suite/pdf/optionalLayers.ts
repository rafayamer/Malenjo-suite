import type { PDFDocumentProxy } from 'pdfjs-dist';

export type PdfOptionalContentConfig =
  Awaited<ReturnType<PDFDocumentProxy['getOptionalContentConfig']>>;

export interface PdfOptionalLayer {
  id: string;
  name: string;
  visible: boolean;
}

export const MAX_PDF_OPTIONAL_LAYERS = 500;

/**
 * Inventory optional-content groups from PDF.js 6's Map-based display config.
 * A flat, bounded list is intentional: the PDF's nested display /Order and
 * usage intent requirements are not rewritten or simplified on export.
 */
export function listPdfOptionalLayers(config: PdfOptionalContentConfig): PdfOptionalLayer[] {
  const groups = config.getGroups();
  if (!groups) return [];
  const entries = groups instanceof Map
    ? [...groups.entries()]
    : Object.entries(groups as Record<string, unknown>);
  if (entries.length > MAX_PDF_OPTIONAL_LAYERS) {
    throw new Error('The PDF has over 500 layers. No incomplete list or visibility controls were returned.');
  }
  return entries.map(([id, raw]) => {
    if (typeof id !== 'string' || !id) {
      throw new Error('Invalid PDF optional-content group identity.');
    }
    const group = raw as {name?: unknown} | null;
    const name = typeof group?.name === 'string' && group.name.trim()
      ? group.name.slice(0, 250) : 'Unnamed layer';
    return {id, name, visible: Boolean(config.isVisible({type:'OCG',id}))};
  });
}

/** Mutate only the PDF.js *viewer* configuration; never modify PDF file bytes. */
export function setPdfOptionalLayerVisibility(
  config: PdfOptionalContentConfig,
  id: string,
  visible: boolean,
): PdfOptionalLayer[] {
  const list = listPdfOptionalLayers(config);
  if (!list.some(layer=>layer.id===id)) {
    throw new Error('Layer no longer exists in the active PDF.');
  }
  if (typeof visible!=='boolean') throw new Error('Layer visibility must be a boolean.');
  config.setVisibility(id,visible,true);
  return listPdfOptionalLayers(config);
}

/** Restore original per-document visibility choices without replacing the PDF. */
export function restorePdfOptionalLayerVisibility(
  config: PdfOptionalContentConfig,
  original: readonly PdfOptionalLayer[],
): PdfOptionalLayer[] {
  const current = listPdfOptionalLayers(config);
  if (current.length!==original.length ||
      current.some(item=>!original.some(initial=>initial.id===item.id))) {
    throw new Error('Layer identities changed; reopen the PDF to reset visibility.');
  }
  for (const item of original) config.setVisibility(item.id,item.visible,true);
  return listPdfOptionalLayers(config);
}
