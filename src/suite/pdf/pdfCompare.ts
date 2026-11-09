/**
 * Compare PDF revisions (MAL-059): word-level text differences per page (Myers' algorithm) and a pixel comparison of
 * two renderings for the visual overlay. Rendering itself happens in the dialog (PDF.js on a canvas); everything here
 * is pure so it can be tested directly.
 */

export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string };
export interface PageTextDiff { pageNumber: number; parts: DiffPart[]; added: number; removed: number }

export const tokenize = (text: string) => text.split(/\s+/).filter(Boolean);
const MAX_TOKENS = 60_000;

/** Myers' O(ND) shortest edit script over two token lists, merged into runs. */
export function diffWords(before: string[], after: string[]): DiffPart[] {
  if (before.length + after.length > MAX_TOKENS) throw new Error('These pages hold too much text to compare word by word.');
  const n = before.length, m = after.length, max = n + m;
  const v = new Int32Array(2 * max + 2); const trace: Int32Array[] = [];
  let found = n === 0 && m === 0;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) { x++; y++; }
      v[max + k] = x;
      if (x >= n && y >= m) { found = true; trace.push(v.slice()); break; }
    }
  }
  // Walk back through the trace.
  const ops: DiffPart['kind'][] = []; const words: string[] = [];
  let x = n, y = m;
  for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d]; const k = x - y;
    const prevK = k === -d || (k !== d && vv[max + k - 1] < vv[max + k + 1]) ? k + 1 : k - 1;
    const prevX = vv[max + prevK]; const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push('same'); words.push(before[x - 1]); x--; y--; }
    if (d === 0) break;
    if (x === prevX) { ops.push('added'); words.push(after[y - 1]); y--; } else { ops.push('removed'); words.push(before[x - 1]); x--; }
  }
  while (x > 0 && y > 0) { ops.push('same'); words.push(before[x - 1]); x--; y--; }
  while (x > 0) { ops.push('removed'); words.push(before[--x]); }
  while (y > 0) { ops.push('added'); words.push(after[--y]); }
  const parts: DiffPart[] = [];
  for (let i = ops.length - 1; i >= 0; i--) {
    const last = parts[parts.length - 1];
    if (last?.kind === ops[i]) last.text += ' ' + words[i]; else parts.push({ kind: ops[i], text: words[i] });
  }
  // Within one change, what went away reads before what replaced it.
  for (let i = 0; i + 1 < parts.length; i++) if (parts[i].kind === 'added' && parts[i + 1].kind === 'removed') [parts[i], parts[i + 1]] = [parts[i + 1], parts[i]];
  return parts;
}

/** Page-by-page text differences (pages are paired by position; extra pages count as wholly added or removed). */
export function comparePageTexts(before: string[], after: string[]): PageTextDiff[] {
  return Array.from({ length: Math.max(before.length, after.length) }, (_, i) => {
    const parts = diffWords(tokenize(before[i] ?? ''), tokenize(after[i] ?? ''));
    const count = (kind: DiffPart['kind']) => parts.filter((p) => p.kind === kind).reduce((n, p) => n + tokenize(p.text).length, 0);
    return { pageNumber: i + 1, parts, added: count('added'), removed: count('removed') };
  });
}

export interface PixelDiff { changed: number; total: number; regions: { x: number; y: number; width: number; height: number }[] }
/**
 * Compares two RGBA renderings of the same size. A pixel differs when any channel moves by more than `tolerance`.
 * Writes the overlay into `out` when given: unchanged pixels faded, removed ink (dark only before) blue, added ink red.
 */
export function comparePixels(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number, out?: Uint8ClampedArray, tolerance = 40, cell = 16): PixelDiff {
  if (before.length !== width * height * 4 || after.length !== before.length) throw new Error('The renderings must be the same size.');
  let changed = 0;
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  const hit = new Uint8Array(cols * rows);
  for (let p = 0, i = 0; p < width * height; p++, i += 4) {
    const differs = Math.abs(before[i] - after[i]) > tolerance || Math.abs(before[i + 1] - after[i + 1]) > tolerance || Math.abs(before[i + 2] - after[i + 2]) > tolerance;
    if (differs) { changed++; hit[Math.floor(p / width / cell) * cols + Math.floor((p % width) / cell)] = 1; }
    if (out) {
      const lb = (before[i] + before[i + 1] + before[i + 2]) / 3, la = (after[i] + after[i + 1] + after[i + 2]) / 3;
      if (!differs) { const g = 255 - (255 - la) * 0.35; out[i] = out[i + 1] = out[i + 2] = g; }
      else if (la < lb) { out[i] = 220; out[i + 1] = 30; out[i + 2] = 30; } // ink that is new
      else { out[i] = 30; out[i + 1] = 90; out[i + 2] = 230; } // ink that went away
      out[i + 3] = 255;
    }
  }
  // Merge touching cells row by row into rectangles.
  const regions: PixelDiff['regions'] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!hit[r * cols + c]) continue;
    let w = 1; while (c + w < cols && hit[r * cols + c + w]) w++;
    const prev = regions.find((g) => g.x === c * cell && g.width === w * cell && g.y + g.height === r * cell);
    if (prev) prev.height += cell; else regions.push({ x: c * cell, y: r * cell, width: w * cell, height: cell });
    c += w - 1;
  }
  return { changed, total: width * height, regions: regions.map((g) => ({ ...g, width: Math.min(g.width, width - g.x), height: Math.min(g.height, height - g.y) })) };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** A self-contained HTML report of the text differences and the per-page visual change. */
export function compareReportHtml(beforeName: string, afterName: string, pages: PageTextDiff[], visual: (number | null)[]): string {
  const rows = pages.map((p) => {
    const share = visual[p.pageNumber - 1];
    const body = p.parts.map((part) => part.kind === 'same' ? esc(part.text) : part.kind === 'added' ? `<ins>${esc(part.text)}</ins>` : `<del>${esc(part.text)}</del>`).join(' ');
    return `<section><h2>Page ${p.pageNumber}</h2><p>${p.added} word(s) added, ${p.removed} removed${share === null || share === undefined ? '' : `; ${(share * 100).toFixed(2)}% of the page looks different`}.</p><p>${body || '<em>No text.</em>'}</p></section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Comparison of ${esc(beforeName)} and ${esc(afterName)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#111}ins{background:#d1fadf;text-decoration:none}del{background:#fde2e1}h2{margin-top:2rem}</style></head>
<body><h1>Comparison</h1><p>Before: ${esc(beforeName)}<br>After: ${esc(afterName)}</p>${rows}</body></html>`;
}
