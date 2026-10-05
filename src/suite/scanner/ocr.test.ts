import { describe, expect, it } from 'vitest';
import { levenshteinDistance, ocrAccuracy } from './ocr';

describe('OCR benchmark helpers', () => {
  it('computes edit distance after whitespace normalization', () => {
    expect(levenshteinDistance('Hello world', 'hello   world')).toBe(0);
    expect(levenshteinDistance('cat', 'cut')).toBe(1);
  });

  it('reports normalized OCR accuracy', () => {
    expect(ocrAccuracy('hello world', 'hello world')).toBe(100);
    expect(ocrAccuracy('', '')).toBe(100);
    expect(ocrAccuracy('', 'unexpected')).toBe(0);
  });
});
