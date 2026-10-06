export type PdfPageSchedulePhase = 'focus' | 'adjacent' | 'lazy';

export interface PdfPageSchedule {
  allowed: boolean;
  eager: boolean;
  phase: PdfPageSchedulePhase;
}

export function pdfCriticalPageOrder(currentPage: number, pageCount: number): number[] {
  if (!Number.isFinite(pageCount) || pageCount < 1) return [];
  const current = Math.min(Math.max(1, Math.trunc(currentPage) || 1), Math.trunc(pageCount));
  const pages = [current];
  if (current < pageCount) pages.push(current + 1);
  if (current > 1) pages.push(current - 1);
  return pages;
}

export function pdfCriticalPassReady(
  currentPage: number,
  pageCount: number,
  renderedPages: ReadonlySet<number>,
): boolean {
  const critical = pdfCriticalPageOrder(currentPage, pageCount);
  return critical.length > 0 && critical.every((page) => renderedPages.has(page));
}

export function pdfPageSchedule(
  pageNumber: number,
  currentPage: number,
  pageCount: number,
  renderedPages: ReadonlySet<number>,
): PdfPageSchedule {
  const critical = pdfCriticalPageOrder(currentPage, pageCount);
  if (!critical.length) return { allowed: false, eager: false, phase: 'lazy' };

  const focus = critical[0];
  if (pageNumber === focus) return { allowed: true, eager: true, phase: 'focus' };

  const adjacent = critical.slice(1);
  if (adjacent.includes(pageNumber)) {
    const focusReady = renderedPages.has(focus);
    return { allowed: focusReady, eager: focusReady, phase: 'adjacent' };
  }

  return {
    allowed: critical.every((page) => renderedPages.has(page)),
    eager: false,
    phase: 'lazy',
  };
}
