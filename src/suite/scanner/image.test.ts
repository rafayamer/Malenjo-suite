import { describe, expect, it } from 'vitest';
import {
  MAX_SCAN_FILE_BYTES,
  bilinearSource,
  normalizePerspective,
  validateImageMetadata,
} from './image';
import { DEFAULT_PERSPECTIVE } from './types';

describe('scanner resource and perspective helpers', () => {
  it('enforces image type, byte and pixel bounds', () => {
    expect(validateImageMetadata('image/png', 1000, 100, 100)).toBeNull();
    expect(validateImageMetadata('application/pdf', 1000, 100, 100)).not.toBeNull();
    expect(validateImageMetadata('image/jpeg', MAX_SCAN_FILE_BYTES + 1, 100, 100)).not.toBeNull();
    expect(validateImageMetadata('image/jpeg', 1000, 6000, 6000)).not.toBeNull();
  });

  it('maps identity quadrilateral corners correctly', () => {
    expect(bilinearSource(0, 0, DEFAULT_PERSPECTIVE)).toEqual({ x: 0, y: 0 });
    expect(bilinearSource(1, 1, DEFAULT_PERSPECTIVE)).toEqual({ x: 1, y: 1 });
    expect(bilinearSource(0.5, 0.5, DEFAULT_PERSPECTIVE)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('clamps perspective points into the image domain', () => {
    const value = normalizePerspective({ tlx: -1, tly: 0, trx: 2, try: 0, brx: 1, bry: 3, blx: 0, bly: 1 });
    expect(value.tlx).toBe(0);
    expect(value.trx).toBe(1);
    expect(value.bry).toBe(1);
  });
});
