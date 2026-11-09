/* Excel to PDF (MAL-033): worksheets, or their print areas, as PDF pages.
 *
 * Supported: shared and inline strings, cached formula results, number formats (general, fixed
 * decimals, thousands, percent, dates and common custom patterns), bold/italic/size/colour,
 * solid fills, horizontal alignment, column widths, row heights, merged cells, gridlines, page
 * orientation, print areas, and pagination across and down (columns that do not fit continue on
 * following pages). Charts, images, conditional formats and comments are reported.
 */
import { rgb } from 'pdf-lib';
import { DEFAULT_STYLE, FlowWriter, type RunStyle } from './flowLayout';
import { PAGE_SIZES, type PageSizeName } from './imagesToPdf';
import { hexColor, relationships, unzipOffice, xml, type DocumentPdf } from './docxToPdf';
import { all, child, kids, textOf, type XNode } from './xmlTree';

export interface SheetPdfOptions { pageSize: Exclude<PageSizeName, 'image'>; orientation: 'sheet' | 'portrait' | 'landscape'; gridlines: 'sheet' | 'on' | 'off'; sheets: 'all' | 'visible' }
const colIndex = (ref: string) => [...(ref.match(/[A-Z]+/)?.[0] ?? 'A')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const rowIndex = (ref: string) => Number(ref.match(/\d+/)?.[0] ?? '1') - 1;
/** A1-style range. Whole columns (A:B) and whole rows (2:4) span the sheet's used extent on the missing axis. */
const rangeOf = (ref: string, used = { maxC: 0, maxR: 0 }) => {
  const [a, b = a] = ref.replace(/\$/g, '').split(':');
  const wholeColumns = /^[A-Z]+$/i.test(a) && /^[A-Z]+$/i.test(b), wholeRows = /^\d+$/.test(a) && /^\d+$/.test(b);
  return {
    c1: wholeRows ? 0 : colIndex(a), c2: wholeRows ? used.maxC : colIndex(b),
    r1: wholeColumns ? 0 : rowIndex(a), r2: wholeColumns ? used.maxR : rowIndex(b),
  };
};

/** Built-in date and time formats (ECMA-376 18.8.30) that are not listed in styles.xml. */
const BUILTIN_DATES: Record<number, string> = {
  14: 'yyyy-mm-dd', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
  20: 'h:mm', 21: 'h:mm:ss', 22: 'yyyy-mm-dd h:mm', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Formats a date/time serial with an Excel pattern; m/mm are minutes next to hours or seconds. */
function formatDateTime(n: number, pattern: string, date1904 = false): string {
  const ms = Math.round(n * 86400000);
  // Serial 0 is 1899-12-30 in the 1900 date system and 1904-01-01 in the 1904 system (older Mac workbooks).
  // Serial 0 is 1904-01-01 in the 1904 system. In the 1900 system Excel counts a 29 February 1900 that never
  // existed (serial 60), so serials before it start one day later, from 1899-12-31.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : n < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + ms);
  const pad = (v: number, w = 2) => String(v).padStart(w, '0');
  const ampm = /AM\/PM|A\/P/i.test(pattern);
  const tokens = pattern.match(/"[^"]*"|\\.|\[h+\]|\[m+\]|\[s+\]|AM\/PM|A\/P|y+|m+|d+|h+|s+(?:\.0+)?|./gi) ?? [];
  const kinds = tokens.map((t) => t.toLowerCase().replace(/\..*/, ''));
  const isMinute = (i: number) => {
    for (let k = i - 1; k >= 0; k--) { if (/^\[?h/.test(kinds[k])) return true; if (/^[ydms]/.test(kinds[k])) break; }
    for (let k = i + 1; k < kinds.length; k++) { if (/^s/.test(kinds[k])) return true; if (/^[ydhm]/.test(kinds[k])) break; }
    return false;
  };
  const hours = d.getUTCHours();
  return tokens.map((token, i) => {
    const t = kinds[i];
    if (token.startsWith('"')) return token.slice(1, -1);
    if (token.startsWith('\\')) return token.slice(1);
    if (/^\[h+\]$/.test(t)) return String(Math.floor(ms / 3600000));
    if (/^\[m+\]$/.test(t)) return String(Math.floor(ms / 60000));
    if (/^\[s+\]$/.test(t)) return String(Math.floor(ms / 1000));
    if (t === 'am/pm') return hours < 12 ? 'AM' : 'PM';
    if (t === 'a/p') return hours < 12 ? 'A' : 'P';
    if (t.startsWith('y')) return t.length <= 2 ? String(d.getUTCFullYear()).slice(2) : String(d.getUTCFullYear());
    if (t.startsWith('d')) return t.length === 1 ? String(d.getUTCDate()) : t.length === 2 ? pad(d.getUTCDate()) : t.length === 3 ? DAYS[d.getUTCDay()].slice(0, 3) : DAYS[d.getUTCDay()];
    if (t.startsWith('h')) { const h = ampm ? (hours % 12 || 12) : hours; return t.length === 1 ? String(h) : pad(h); }
    if (t.startsWith('s')) {
      const fraction = token.match(/\.(0+)/)?.[1].length ?? 0;
      return pad(d.getUTCSeconds()) + (fraction ? (d.getUTCMilliseconds() / 1000).toFixed(fraction).slice(1) : '');
    }
    if (t.startsWith('m')) {
      if (t.length <= 2 && isMinute(i)) return t.length === 1 ? String(d.getUTCMinutes()) : pad(d.getUTCMinutes());
      const month = d.getUTCMonth();
      return t.length === 1 ? String(month + 1) : t.length === 2 ? pad(month + 1) : t.length === 3 ? MONTHS[month].slice(0, 3) : t.length === 5 ? MONTHS[month][0] : MONTHS[month];
    }
    return /^[\[\]]$/.test(token) ? '' : token;
  }).join('');
}

function formatValue(raw: string, fmt: string, id: number, date1904 = false): string {
  const n = Number(raw);
  if (raw === '' || !Number.isFinite(n)) return raw;
  const fixed = (d: number, group: boolean) => { const s = Math.abs(n).toFixed(d); const [w, f] = s.split('.'); return `${n < 0 ? '-' : ''}${group ? w.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : w}${f ? '.' + f : ''}`; };
  const builtIn: Record<number, () => string> = { 1: () => fixed(0, false), 2: () => fixed(2, false), 3: () => fixed(0, true), 4: () => fixed(2, true), 9: () => `${Math.round(n * 100)}%`, 10: () => `${(n * 100).toFixed(2)}%` };
  if (builtIn[id]) return builtIn[id]();
  const pattern = fmt || BUILTIN_DATES[id] || '';
  const isDate = Boolean(BUILTIN_DATES[id]) || /[dmyhs]/i.test(pattern.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));
  if (isDate && n >= 0 && n < 2958466) return formatDateTime(n, pattern.split(';')[0], date1904);
  if (fmt) {
    const decimals = (fmt.split(';')[0].match(/\.(0+)/)?.[1].length) ?? 0;
    const text = fixed(fmt.includes('%') ? decimals : decimals, fmt.includes(','));
    const value = fmt.includes('%') ? `${(n * 100).toFixed(decimals)}%` : text;
    const prefix = fmt.match(/^"?([$€£¥])"?/)?.[1] ?? (fmt.includes('[$') ? fmt.match(/\[\$([^\-\]]+)/)?.[1] ?? '' : '');
    return prefix + value;
  }
  // General: every significant digit a double holds (15), in scientific notation when very small or large.
  return String(Number(n.toPrecision(15))).replace('e', 'E');
}

export async function xlsxToPdf(bytes: Uint8Array, options: SheetPdfOptions): Promise<DocumentPdf> {
  const files = unzipOffice(bytes);
  const book = xml(files, 'xl/workbook.xml');
  if (!book) throw new Error('This is not an Excel (XLSX) workbook.');
  const rels = relationships(files, 'xl/workbook.xml');
  const pr = all(book, 'workbookPr')[0]?.attrs.date1904;
  const date1904 = pr === '1' || pr === 'true';
  const shared = (() => { const s = xml(files, 'xl/sharedStrings.xml'); return s ? kids(all(s, 'sst')[0] ?? s, 'si').map((si) => all(si, 't').map(textOf).join('')) : []; })();
  const styles = xml(files, 'xl/styles.xml');
  const numFmts = new Map<number, string>(styles ? all(styles, 'numFmt').map((n) => [Number(n.attrs.numFmtId), n.attrs.formatCode ?? '']) : []);
  const fonts = styles ? kids(all(styles, 'fonts')[0], 'font') : [];
  const fills = styles ? kids(all(styles, 'fills')[0], 'fill') : [];
  const xfs = styles ? kids(all(styles, 'cellXfs')[0], 'xf') : [];
  const styleOf = (s: number) => {
    const xf = xfs[s]; const font = fonts[Number(xf?.attrs.fontId ?? 0)]; const fill = fills[Number(xf?.attrs.fillId ?? 0)];
    const pattern = child(fill, 'patternFill');
    const color = (n: XNode | undefined) => hexColor(n?.attrs.rgb?.slice(-6));
    const run: RunStyle = { ...DEFAULT_STYLE, size: Number(child(font, 'sz')?.attrs.val ?? 11) * 0.9, bold: Boolean(child(font, 'b')) && child(font, 'b')?.attrs.val !== '0', italic: Boolean(child(font, 'i')), color: color(child(font, 'color')) ?? [0, 0, 0] };
    return { run, fill: pattern?.attrs.patternType === 'solid' ? color(child(pattern, 'fgColor')) : undefined, numFmtId: Number(xf?.attrs.numFmtId ?? 0), align: child(xf, 'alignment')?.attrs.horizontal };
  };
  const printAreas = new Map<number, string>();
  for (const d of all(book, 'definedName')) if (d.attrs.name === '_xlnm.Print_Area' && d.attrs.localSheetId !== undefined) printAreas.set(Number(d.attrs.localSheetId), textOf(d));
  const counts = { charts: 0, conditional: 0, comments: 0, formulas: 0, hidden: 0, beyond: 0 };
  const writer = await FlowWriter.create({ width: 612, height: 792, margin: { top: 36, right: 36, bottom: 36, left: 36 } }, false);
  const margin = 36;
  let rendered = 0; const areas: string[] = [];
  const sheets = all(book, 'sheet');
  for (const [sheetIndex, sheet] of sheets.entries()) {
    if (sheet.attrs.state && sheet.attrs.state !== 'visible') { counts.hidden++; if (options.sheets === 'visible') continue; }
    const path = rels.get(sheet.attrs['r:id']);
    const ws = path ? xml(files, path) : undefined;
    if (!ws || !path) continue;
    const wsRels = relationships(files, path);
    if ([...wsRels.values()].some((p) => p.includes('drawings'))) counts.charts++;
    if ([...wsRels.values()].some((p) => p.includes('comments'))) counts.comments++;
    counts.conditional += all(ws, 'conditionalFormatting').length;
    // Cells.
    const cells = new Map<string, { text: string; style: number; numeric: boolean }>();
    let maxR = 0, maxC = 0;
    for (const c of all(ws, 'c')) {
      const ref = c.attrs.r; if (!ref) continue;
      const [r, col] = [rowIndex(ref), colIndex(ref)];
      if (r > 20000 || col > 500) { if (child(c, 'v') || child(c, 'is')) counts.beyond++; continue; }
      const v = child(c, 'v') ? textOf(child(c, 'v')!) : ''; const s = Number(c.attrs.s ?? 0);
      if (child(c, 'f') && !child(c, 'v')) counts.formulas++;
      const type = c.attrs.t ?? 'n';
      const st = styleOf(s);
      const text = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? all(c, 't').map(textOf).join('') : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : type === 'str' || type === 'e' ? v : formatValue(v, numFmts.get(st.numFmtId) ?? '', st.numFmtId, date1904);
      if (!text) continue;
      cells.set(`${r},${col}`, { text, style: s, numeric: type === 'n' && v !== '' });
      maxR = Math.max(maxR, r); maxC = Math.max(maxC, col);
    }
    // A merged cell whose anchor is the last used cell still spans its whole range when printed.
    for (const m of all(ws, 'mergeCell').map((cell) => rangeOf(cell.attrs.ref))) {
      if (cells.has(`${m.r1},${m.c1}`)) { maxR = Math.max(maxR, m.r2); maxC = Math.max(maxC, m.c2); }
    }
    // A print area may list several ranges (Sheet1!$A$1:$B$9,Sheet1!$D$1:$E$9): each prints in turn, on its own pages.
    const areaRefs = printAreas.has(sheetIndex) ? printAreas.get(sheetIndex)!.split(',').map((part) => part.split('!').pop()!.trim()).filter(Boolean) : [];
    const areaList = areaRefs.length ? areaRefs.map((ref) => rangeOf(ref, { maxC, maxR })) : [{ c1: 0, r1: 0, c2: maxC, r2: maxR }];
    if (areaRefs.length) areas.push(`${sheet.attrs.name} (${areaRefs.join(', ')})`);
    if (!cells.size && !printAreas.has(sheetIndex)) continue;
    rendered++;
    const widths = new Map<number, number>(); const heights = new Map<number, number>();
    for (const col of all(ws, 'col')) for (let c = Number(col.attrs.min) - 1; c < Number(col.attrs.max) && c < 500; c++) widths.set(c, col.attrs.hidden === '1' ? 0 : (Number(col.attrs.width ?? 8.43) * 7 + 5) * 0.75);
    // A hidden row needs no custom height to be hidden.
    for (const row of all(ws, 'row')) {
      if (row.attrs.hidden === '1') heights.set(Number(row.attrs.r) - 1, 0);
      else if (row.attrs.ht) heights.set(Number(row.attrs.r) - 1, Number(row.attrs.ht));
    }
    const colW = (c: number) => widths.get(c) ?? 64 * 0.75 + 0.5, rowH = (r: number) => heights.get(r) ?? 15;
    const merges = all(ws, 'mergeCell').map((m) => rangeOf(m.attrs.ref));
    const covered = new Set<string>();
    for (const m of merges) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(`${r},${c}`);
    const setup = all(ws, 'pageSetup')[0];
    const landscape = options.orientation === 'landscape' || (options.orientation === 'sheet' && setup?.attrs.orientation === 'landscape');
    let [pw, ph] = PAGE_SIZES[options.pageSize];
    if (landscape !== pw > ph) [pw, ph] = [ph, pw];
    const grid = options.gridlines === 'on' || (options.gridlines === 'sheet' && all(ws, 'printOptions')[0]?.attrs.gridLines === '1');
    for (const area of areaList) {
    // Column bands that fit across the page, then rows down each band.
    const bands: number[][] = [];
    let band: number[] = [], used = 0;
    for (let c = area.c1; c <= area.c2; c++) {
      const w = Math.min(colW(c), pw - 2 * margin);
      if (band.length && used + w > pw - 2 * margin) { bands.push(band); band = []; used = 0; }
      band.push(c); used += w;
    }
    if (band.length) bands.push(band);
    for (const cols of bands) {
      writer.newPageSized(pw, ph);
      let y = ph - margin;
      for (let r = area.r1; r <= area.r2; r++) {
        const h = rowH(r);
        if (h === 0) continue;
        if (y - h < margin) { writer.newPageSized(pw, ph); y = ph - margin; }
        let x = margin;
        for (const c of cols) {
          const w = Math.min(colW(c), pw - 2 * margin);
          if (w === 0) continue;
          const key = `${r},${c}`;
          const cell = cells.get(key); const st = styleOf(cell?.style ?? 0);
          const merge = merges.find((m) => m.r1 === r && m.c1 === c);
          const mw = merge ? cols.filter((k) => k >= merge.c1 && k <= merge.c2).reduce((n, k) => n + Math.min(colW(k), pw - 2 * margin), 0) : w;
          const mh = merge ? Array.from({ length: merge.r2 - merge.r1 + 1 }, (_, k) => rowH(merge.r1 + k)).reduce((a, b) => a + b, 0) : h;
          const page = writer.currentPage;
          if (!covered.has(key)) {
            if (st.fill) page.drawRectangle({ x, y: y - mh, width: mw, height: mh, color: rgb(...st.fill) });
            if (cell) {
              const font = await writer.font(st.run);
              let text = writer.drawable(font, cell.text.replace(/\s+/g, ' '));
              const size = Math.min(st.run.size, h * 0.8);
              if (cell.numeric && font.widthOfTextAtSize(text, size) > mw - 4) {
                // A number that does not fit shows as #### (as spreadsheets do), or nothing in a sliver of a column.
                text = '#'.repeat(Math.max(0, Math.floor((mw - 4) / font.widthOfTextAtSize('#', size))));
              } else while (text && font.widthOfTextAtSize(text, size) > mw - 4) text = text.slice(0, -1);
              const tw = font.widthOfTextAtSize(text, size);
              const align = st.align ?? (cell.numeric ? 'right' : 'left');
              const tx = align === 'right' ? x + mw - 2 - tw : align === 'center' || align === 'centerContinuous' ? x + (mw - tw) / 2 : x + 2;
              page.drawText(text, { x: tx, y: y - Math.min(mh, h) + (h - size) / 2 + size * 0.2, size, font, color: rgb(...st.run.color) });
            }
          }
          if (grid) page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.4 });
          x += w;
        }
        y -= h;
      }
    }
    }
  }
  if (!rendered) throw new Error('This workbook has no cells to print.');
  const notes = [`Rendered ${rendered} worksheet(s) on ${writer.pages} page(s); wide sheets continue on following pages.`];
  if (areas.length) notes.push(`Print areas used: ${areas.join(', ')}.`);
  if (writer.replaced) notes.push(`${writer.replaced} character(s) outside the standard fonts were drawn as “?”.`);
  if (counts.beyond) notes.push(`Not printed: ${counts.beyond} cell(s) beyond row 20000 or column 500 (the conversion limit).`);
  if (counts.formulas) notes.push(`${counts.formulas} formula(s) have no saved result and print empty; open and save the workbook in a spreadsheet program to store results.`);
  if (counts.charts) notes.push(`Not rendered: charts or pictures on ${counts.charts} sheet(s).`);
  if (counts.conditional) notes.push(`Not applied: ${counts.conditional} conditional format rule(s).`);
  if (counts.comments) notes.push(`Not printed: comments on ${counts.comments} sheet(s).`);
  if (counts.hidden && options.sheets === 'visible') notes.push(`${counts.hidden} hidden sheet(s) were skipped.`);
  return { bytes: await writer.save(), pages: writer.pages, notes };
}
