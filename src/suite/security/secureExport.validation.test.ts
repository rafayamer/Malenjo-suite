import { describe, expect, it } from 'vitest';
import { assertValidRedactionPlan } from './secureExport';

describe('Security Center redaction input must fail closed', () => {
  const valid = { page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
  it('accepts in-bounds rectangles on an existing page', () => {
    expect(() => assertValidRedactionPlan([valid], 2)).not.toThrow();
  });
  it('refuses pages outside the PDF', () => {
    expect(() => assertValidRedactionPlan([{ ...valid, page: 3 }], 2)).toThrow(/Invalid redaction/);
  });
  it('refuses non-finite, negative and out-of-bounds input', () => {
    for (const invalid of [{ ...valid, x: Number.NaN }, { ...valid, width: 0.95 },
      { ...valid, page: 0 }, { ...valid, height: -1 }]) {
      expect(() => assertValidRedactionPlan([invalid], 2)).toThrow(/Invalid redaction/);
    }
  });
  it('limits excessive redaction requests before rendering', () => {
    expect(() => assertValidRedactionPlan(Array(501).fill(valid), 2)).toThrow(/500/);
  });
});
