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
  if (!Number.isFinite(pageCount) || pageCount < 1 ||
      !Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount)
    return { allowed: false, eager: false, phase: 'lazy' };
  // This executes once per page on every reader state update. Avoid allocating
  // a new critical-page array for each of hundreds of page placeholders.
  const focus = Math.min(Math.max(1, Math.trunc(currentPage) || 1), Math.trunc(pageCount));
  if (pageNumber === focus) return { allowed: true, eager: true, phase: 'focus' };
  const focusReady = renderedPages.has(focus);
  if (pageNumber === focus + 1 || pageNumber === focus - 1)
    return { allowed: focusReady, eager: focusReady, phase: 'adjacent' };
  return {
    allowed: focusReady &&
      (focus >= pageCount || renderedPages.has(focus + 1)) &&
      (focus <= 1 || renderedPages.has(focus - 1)),
    eager: false,
    phase: 'lazy',
  };
}
