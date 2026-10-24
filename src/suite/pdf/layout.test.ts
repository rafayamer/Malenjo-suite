import { describe, expect, it } from 'vitest';
import {
  clampPdfPage,
  clampPdfZoom,
  effectivePdfScale,
  parsePdfPageDraft,
  rotatePdfClockwise,
  stepPdfZoom,
} from './layout';

describe('PDF workspace layout', () => {
  it('parses typed page drafts without jumping to page 1 on empty or invalid input', () => {
    expect(parsePdfPageDraft('57', 57)).toBe(57);
    expect(parsePdfPageDraft(' 12 ', 57)).toBe(12);
    expect(parsePdfPageDraft('999', 57)).toBe(57);
    expect(parsePdfPageDraft('0', 57)).toBe(1);
    expect(parsePdfPageDraft('', 57)).toBeNull();
    expect(parsePdfPageDraft('abc', 57)).toBeNull();
    expect(parsePdfPageDraft('-3', 57)).toBeNull();
    expect(parsePdfPageDraft('2.5', 57)).toBeNull();
    expect(parsePdfPageDraft('5', 0)).toBeNull();
  });
  it('clamps pages and zoom safely', () => {
    expect(clampPdfPage(0, 10)).toBe(1);
    expect(clampPdfPage(99, 10)).toBe(10);
    expect(clampPdfPage(4.6, 10)).toBe(5);
    expect(clampPdfZoom(0.01)).toBe(0.25);
    expect(clampPdfZoom(9)).toBe(4);
  });

  it('steps zoom in predictable 10 percent increments', () => {
    expect(stepPdfZoom(1, 1)).toBe(1.1);
    expect(stepPdfZoom(1, -1)).toBe(0.9);
  });

  it('computes fit-width and fit-page scales', () => {
    expect(effectivePdfScale(600, 800, 656, 900, 'width', 1)).toBe(1);
    expect(effectivePdfScale(600, 800, 656, 456, 'page', 1)).toBe(0.5);
  });

  it('normalizes clockwise rotation', () => {
    expect(rotatePdfClockwise(0)).toBe(90);
    expect(rotatePdfClockwise(270)).toBe(0);
    expect(rotatePdfClockwise(-90)).toBe(0);
  });
});
