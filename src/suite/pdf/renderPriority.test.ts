import { describe, expect, it } from 'vitest';
import {
  pdfCriticalPageOrder,
  pdfCriticalPassReady,
  pdfPageSchedule,
} from './renderPriority';

describe('PDF central-canvas render priority', () => {
  it('orders the visible page before next and previous pages', () => {
    expect(pdfCriticalPageOrder(1, 6)).toEqual([1, 2]);
    expect(pdfCriticalPageOrder(4, 6)).toEqual([4, 5, 3]);
    expect(pdfCriticalPageOrder(6, 6)).toEqual([6, 5]);
  });

  it('blocks adjacent pages until the focus page has rendered', () => {
    const none = new Set<number>();
    expect(pdfPageSchedule(4, 4, 8, none)).toMatchObject({ allowed: true, eager: true, phase: 'focus' });
    expect(pdfPageSchedule(5, 4, 8, none)).toMatchObject({ allowed: false, phase: 'adjacent' });

    const focusReady = new Set([4]);
    expect(pdfPageSchedule(5, 4, 8, focusReady)).toMatchObject({ allowed: true, eager: true, phase: 'adjacent' });
    expect(pdfPageSchedule(3, 4, 8, focusReady)).toMatchObject({ allowed: true, eager: true, phase: 'adjacent' });
  });

  it('keeps background pages and thumbnails gated until the critical pass is ready', () => {
    const focusOnly = new Set([4]);
    expect(pdfPageSchedule(8, 4, 8, focusOnly)).toMatchObject({ allowed: false, eager: false, phase: 'lazy' });
    expect(pdfCriticalPassReady(4, 8, focusOnly)).toBe(false);

    const criticalReady = new Set([3, 4, 5]);
    expect(pdfCriticalPassReady(4, 8, criticalReady)).toBe(true);
    expect(pdfPageSchedule(8, 4, 8, criticalReady)).toMatchObject({ allowed: true, eager: false, phase: 'lazy' });
  });
});
