import { describe, expect, it } from 'vitest';
import { compareReportHtml, comparePageTexts, comparePixels, diffWords, tokenize } from './pdfCompare';

describe('Compare PDF revisions (MAL-059)', () => {
  it('finds word-level additions and removals', () => {
    expect(diffWords(tokenize('Statement for March 2024 total 10'), tokenize('Statement for April 2024 total 10 paid'))).toEqual([
      { kind: 'same', text: 'Statement for' }, { kind: 'removed', text: 'March' }, { kind: 'added', text: 'April' },
      { kind: 'same', text: '2024 total 10' }, { kind: 'added', text: 'paid' }]);
    expect(diffWords([], [])).toEqual([]);
    expect(diffWords(['a'], [])).toEqual([{ kind: 'removed', text: 'a' }]);
    // Random edits always rebuild both sides.
    for (let t = 0; t < 50; t++) {
      const a = Array.from({ length: 30 }, () => 'abcde'[Math.floor(Math.random() * 5)]);
      const b = a.filter(() => Math.random() > 0.2).map((w) => (Math.random() > 0.9 ? 'x' : w));
      const parts = diffWords(a, b);
      expect(parts.filter((p) => p.kind !== 'added').flatMap((p) => tokenize(p.text))).toEqual(a);
      expect(parts.filter((p) => p.kind !== 'removed').flatMap((p) => tokenize(p.text))).toEqual(b);
    }
  });

  it('compares page by page, counting extra pages as added or removed', () => {
    const pages = comparePageTexts(['one two', 'same page'], ['one three', 'same page', 'new page']);
    expect(pages.map((p) => [p.added, p.removed])).toEqual([[1, 1], [0, 0], [2, 0]]);
    expect(compareReportHtml('v1.pdf', 'v2.pdf', pages, [0.01, 0, null])).toMatch(/1\.00% of the page looks different.<\/p><p>one <del>two<\/del> <ins>three<\/ins>/);
  });

  it('finds changed pixels and marks added and removed ink in the overlay', () => {
    const w = 32, h = 32; const white = () => new Uint8ClampedArray(w * h * 4).fill(255);
    const before = white(), after = white();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = (y * w + x) * 4; before[i] = before[i + 1] = before[i + 2] = 0; }
    for (let y = 20; y < 24; y++) for (let x = 20; x < 30; x++) { const i = (y * w + x) * 4; after[i] = after[i + 1] = after[i + 2] = 0; }
    const out = new Uint8ClampedArray(w * h * 4);
    const diff = comparePixels(before, after, w, h, out);
    expect(diff.changed).toBe(64 + 40);
    expect(diff.regions).toEqual([{ x: 0, y: 0, width: 16, height: 16 }, { x: 16, y: 16, width: 16, height: 16 }]);
    expect(Array.from(out.subarray(0, 3))).toEqual([30, 90, 230]); // removed: blue
    expect(Array.from(out.subarray((20 * w + 20) * 4, (20 * w + 20) * 4 + 3))).toEqual([220, 30, 30]); // added: red
    expect(comparePixels(before, before, w, h).changed).toBe(0);
  });
});
