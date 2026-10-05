import { describe, expect, it } from 'vitest';
import {
  clampPdfPage,
  clampPdfZoom,
  effectivePdfScale,
  rotatePdfClockwise,
  stepPdfZoom,
} from './layout';

describe('PDF workspace layout', () => {
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
