export type PdfFitMode = 'custom' | 'width' | 'page';

export const MIN_PDF_ZOOM = 0.25;
export const MAX_PDF_ZOOM = 4;

export function clampPdfPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page) || pageCount <= 0) return 1;
  return Math.min(pageCount, Math.max(1, Math.round(page)));
}

export function clampPdfZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_PDF_ZOOM, Math.max(MIN_PDF_ZOOM, zoom));
}

export function stepPdfZoom(zoom: number, direction: -1 | 1): number {
  const next = zoom + direction * 0.1;
  return Math.round(clampPdfZoom(next) * 100) / 100;
}

export function effectivePdfScale(
  pageWidth: number,
  pageHeight: number,
  availableWidth: number,
  availableHeight: number,
  fitMode: PdfFitMode,
  customZoom: number,
): number {
  if (fitMode === 'custom') return clampPdfZoom(customZoom);

  const safeWidth = Math.max(160, availableWidth - 56);
  const safeHeight = Math.max(180, availableHeight - 56);
  const widthScale = safeWidth / Math.max(1, pageWidth);

  if (fitMode === 'width') return clampPdfZoom(widthScale);

  const heightScale = safeHeight / Math.max(1, pageHeight);
  return clampPdfZoom(Math.min(widthScale, heightScale));
}

export function rotatePdfClockwise(rotation: number): number {
  const normalized = ((rotation % 360) + 360) % 360;
  return (normalized + 90) % 360;
}
