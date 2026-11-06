/* Word to PDF (MAL-031): renders DOCX body content through the flow layout engine.
 *
 * Supported: paragraph styles (with basedOn chains and document defaults), headings, alignment,
 * spacing, indents, numbered and bulleted lists from numbering.xml, runs (bold, italic,
 * underline, strike, size, colour, highlight, font family), line and page breaks, tables
 * (column widths, spans, shading, borders), inline PNG/JPEG pictures, and the section's page
 * size and margins. Everything else is counted in the fidelity report.
 */
import { strFromU8, unzipSync } from 'fflate';
import { DEFAULT_STYLE, FlowWriter, imageInfo, type Align, type Block, type Paragraph, type Run, type RunStyle, type TableCell } from './flowLayout';
import { all, child, kids, parseMarkup, type XNode } from './xmlTree';

export interface DocumentPdf { bytes: Uint8Array; pages: number; notes: string[] }
const twip = (v: string | undefined, fallback = 0) => (v === undefined || v === '' ? fallback : Number(v) / 20);
const val = (n: XNode | undefined, attr = 'w:val') => n?.attrs[attr];
const on = (n: XNode | undefined) => Boolean(n) && !['0', 'false', 'off', 'none'].includes(val(n) ?? 'true');
export const hexColor = (h: string | undefined): [number, number, number] | undefined => (h && /^[0-9a-f]{6}$/i.test(h) ? [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number] : undefined);
const HIGHLIGHT: Record<string, string> = { yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', lightGray: 'D3D3D3', darkGray: 'A9A9A9' };
export const familyOf = (font: string | undefined): RunStyle['family'] => (!font ? 'sans' : /courier|consol|mono|menlo/i.test(font) ? 'mono' : /times|georgia|cambria|garamond|book|serif|palatino|minion/i.test(font) && !/sans/i.test(font) ? 'serif' : 'sans');

export function unzipOffice(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > 64 * 1024 * 1024) throw new Error('Office files over 64 MB are not converted.');
  let total = 0, count = 0;
  try {
    return unzipSync(bytes, { filter: (f) => { total += f.originalSize; if (++count > 5000 || total > 256 * 1024 * 1024) throw new Error('too large'); return true; } });
  } catch { throw new Error('This file is not a valid Office document, or it is too large.'); }
}
export const xml = (files: Record<string, Uint8Array>, path: string) => (files[path] ? parseMarkup(strFromU8(files[path])) : undefined);
export function relationships(files: Record<string, Uint8Array>, path: string): Map<string, string> {
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const rels = xml(files, `${dir}_rels/${path.slice(dir.length)}.rels`);
  const map = new Map<string, string>();
  for (const r of rels ? all(rels, 'Relationship') : []) {
    const target = r.attrs.Target ?? '';
    if (r.attrs.TargetMode === 'External') continue;
    const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/');
    const resolved: string[] = [];
    for (const p of parts) { if (p === '..') resolved.pop(); else if (p && p !== '.') resolved.push(p); }
    map.set(r.attrs.Id, resolved.join('/'));
  }
  return map;
}

interface Props { p: Partial<Pick<Paragraph, 'align' | 'indent' | 'firstIndent' | 'spaceBefore' | 'spaceAfter' | 'lineHeight' | 'pageBreakBefore'>> & { num?: [string, number]; heading?: number }; r: Partial<RunStyle> }

export async function docxToPdf(bytes: Uint8Array): Promise<DocumentPdf> {
  const files = unzipOffice(bytes);
  const doc = xml(files, 'word/document.xml');
  if (!doc) throw new Error('This is not a Word (DOCX) document.');
  const counts = { headers: 0, footnotes: 0, textboxes: 0, charts: 0, equations: 0, images: 0, nested: 0, fields: 0 };
  const fonts = new Set<string>();
  const rels = relationships(files, 'word/document.xml');

  // Styles: run and paragraph properties per style id, resolved through basedOn.
  const stylesXml = xml(files, 'word/styles.xml');
  const readRun = (rPr: XNode | undefined): Partial<RunStyle> => {
    if (!rPr) return {};
    const out: Partial<RunStyle> = {};
    const flag = (name: string) => child(rPr, name);
    if (flag('w:b')) out.bold = on(flag('w:b')); if (flag('w:i')) out.italic = on(flag('w:i'));
    if (flag('w:u')) out.underline = val(flag('w:u')) !== 'none'; if (flag('w:strike')) out.strike = on(flag('w:strike'));
    if (flag('w:sz')) out.size = Number(val(flag('w:sz'))) / 2;
    const color = hexColor(val(flag('w:color'))); if (color) out.color = color;
    const highlight = val(flag('w:highlight')); const shd = child(rPr, 'w:shd')?.attrs['w:fill'];
    const bg = hexColor(highlight ? HIGHLIGHT[highlight] : shd !== 'auto' ? shd : undefined); if (bg) out.background = bg;
    const font = child(rPr, 'w:rFonts')?.attrs['w:ascii'] ?? child(rPr, 'w:rFonts')?.attrs['w:hAnsi'];
    if (font) { out.family = familyOf(font); fonts.add(font); }
    return out;
  };
  const readPara = (pPr: XNode | undefined): Props['p'] => {
    if (!pPr) return {};
    const out: Props['p'] = {};
    const jc = val(child(pPr, 'w:jc')); if (jc) out.align = (({ center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' } as Record<string, Align>)[jc] ?? 'left');
    const sp = child(pPr, 'w:spacing');
    if (sp?.attrs['w:before'] !== undefined) out.spaceBefore = twip(sp.attrs['w:before']);
    if (sp?.attrs['w:after'] !== undefined) out.spaceAfter = twip(sp.attrs['w:after']);
    if (sp?.attrs['w:line'] && (sp.attrs['w:lineRule'] ?? 'auto') === 'auto') out.lineHeight = Math.max(0.8, Number(sp.attrs['w:line']) / 240) * 1.15;
    const ind = child(pPr, 'w:ind');
    if (ind) { out.indent = twip(ind.attrs['w:left'] ?? ind.attrs['w:start']); out.firstIndent = ind.attrs['w:hanging'] ? -twip(ind.attrs['w:hanging']) : twip(ind.attrs['w:firstLine']); }
    if (on(child(pPr, 'w:pageBreakBefore'))) out.pageBreakBefore = true;
    const num = child(pPr, 'w:numPr'); if (num) out.num = [val(child(num, 'w:numId')) ?? '0', Number(val(child(num, 'w:ilvl')) ?? 0)];
    const outline = val(child(pPr, 'w:outlineLvl')); if (outline !== undefined) out.heading = Number(outline) + 1;
    return out;
  };
  const styles = new Map<string, { basedOn?: string; props: Props }>();
  for (const s of stylesXml ? all(stylesXml, 'w:style') : []) {
    const id = s.attrs['w:styleId'];
    const props: Props = { p: readPara(child(s, 'w:pPr')), r: readRun(child(s, 'w:rPr')) };
    const name = (val(child(s, 'w:name')) ?? '').toLowerCase();
    const heading = /^heading (\d)$/.exec(name) ?? /^Heading(\d)$/.exec(id);
    if (heading) props.p.heading = Number(heading[1]);
    if (name === 'title') props.p.heading = 0;
    styles.set(id, { basedOn: val(child(s, 'w:basedOn')), props });
  }
  const defaults: Props = { p: readPara(stylesXml ? all(stylesXml, 'w:pPrDefault').map((n) => child(n, 'w:pPr'))[0] : undefined), r: readRun(stylesXml ? all(stylesXml, 'w:rPrDefault').map((n) => child(n, 'w:rPr'))[0] : undefined) };
  const styleProps = (id: string | undefined, depth = 0): Props => {
    const s = id ? styles.get(id) : undefined;
    if (!s || depth > 20) return { p: {}, r: {} };
    const base = styleProps(s.basedOn, depth + 1);
    return { p: { ...base.p, ...s.props.p }, r: { ...base.r, ...s.props.r } };
  };

  // Numbering: numId -> levels (format and text), counters restart per numId.
  const numbering = xml(files, 'word/numbering.xml');
  const abstract = new Map<string, XNode>();
  for (const a of numbering ? all(numbering, 'w:abstractNum') : []) abstract.set(a.attrs['w:abstractNumId'], a);
  const nums = new Map<string, XNode | undefined>();
  for (const n of numbering ? all(numbering, 'w:num') : []) nums.set(n.attrs['w:numId'], abstract.get(val(child(n, 'w:abstractNumId')) ?? ''));
  const counters = new Map<string, number[]>();
  const marker = (numId: string, level: number): string | undefined => {
    const abs = nums.get(numId); if (!abs) return undefined;
    const lvl = kids(abs, 'w:lvl').find((l) => Number(l.attrs['w:ilvl']) === level);
    const fmt = val(child(lvl, 'w:numFmt')) ?? 'decimal';
    const text = val(child(lvl, 'w:lvlText')) ?? '%1.';
    const c = counters.get(numId) ?? []; c[level] = (c[level] ?? Number(val(child(lvl, 'w:start')) ?? 1) - 1) + 1; c.length = level + 1; counters.set(numId, c);
    if (fmt === 'bullet') return /[-]/.test(text) || !text.trim() ? '•' : text;
    const format = (n: number, f: string) => f === 'lowerLetter' ? String.fromCharCode(96 + ((n - 1) % 26) + 1) : f === 'upperLetter' ? String.fromCharCode(64 + ((n - 1) % 26) + 1)
      : f === 'lowerRoman' || f === 'upperRoman' ? (() => { let r = '', x = n; for (const [v, s] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']] as [number, string][]) while (x >= v) { r += s; x -= v; } return f === 'upperRoman' ? r.toUpperCase() : r; })() : String(n);
    return text.replace(/%(\d)/g, (_, d) => format(c[Number(d) - 1] ?? 1, d === String(level + 1) ? fmt : 'decimal'));
  };

  const HEADING = [26, 20, 16, 14, 13, 12, 12];
  const blocks: Block[] = [];
  const picture = (drawing: XNode): Block | null => {
    if (all(drawing, 'c:chart').length || all(drawing, 'chart').length) { counts.charts++; return null; }
    const blip = all(drawing, 'a:blip')[0]; const extent = all(drawing, 'wp:extent')[0];
    const target = blip ? rels.get(blip.attrs['r:embed']) : undefined;
    const data = target ? files[target] : undefined;
    const info = data ? imageInfo(data) : null;
    if (!data || !info) { counts.images++; return null; }
    const cx = Number(extent?.attrs.cx ?? 0) / 12700, cy = Number(extent?.attrs.cy ?? 0) / 12700;
    return { kind: 'image', bytes: data, format: info.format, width: cx || info.width * 0.75, height: cy || info.height * 0.75, align: 'left', spaceAfter: 6 };
  };
  const paragraph = (p: XNode, inTable = false): Block[] => {
    const pPr = child(p, 'w:pPr');
    const styleId = val(child(pPr, 'w:pStyle')) ?? 'Normal';
    const sp = styleProps(styleId);
    const props: Props['p'] = { ...defaults.p, ...sp.p, ...readPara(pPr) };
    const baseRun: RunStyle = { ...DEFAULT_STYLE, ...defaults.r, ...sp.r };
    if (props.heading !== undefined && sp.r.size === undefined) { baseRun.size = HEADING[props.heading] ?? 12; baseRun.bold = sp.r.bold ?? true; }
    const runs: Run[] = []; const after: Block[] = []; const breaks: number[] = [];
    const walk = (node: XNode) => {
      for (const c of node.children) {
        if (c.name === 'w:r') {
          const style = { ...baseRun, ...readRun(child(c, 'w:rPr')) };
          for (const part of c.children) {
            if (part.name === 'w:t') runs.push({ text: part.children.map((t) => t.text).join(''), style });
            else if (part.name === 'w:tab') runs.push({ text: '    ', style });
            else if (part.name === 'w:br' || part.name === 'w:cr') { if (part.attrs['w:type'] === 'page') breaks.push(runs.length); else runs.push({ text: '\n', style }); }
            else if (part.name === 'w:drawing' || part.name === 'w:pict') { if (all(part, 'w:txbxContent').length) counts.textboxes++; else { const img = picture(part); if (img) after.push(img); } }
            else if (part.name === 'w:footnoteReference' || part.name === 'w:endnoteReference') counts.footnotes++;
            else if (part.name === 'w:fldChar') counts.fields++;
          }
        } else if (['w:hyperlink', 'w:smartTag', 'w:ins', 'w:fldSimple', 'w:sdt', 'w:sdtContent', 'w:customXml'].includes(c.name)) walk(c);
        else if (c.name === 'm:oMath' || c.name === 'm:oMathPara') counts.equations++;
      }
    };
    walk(p);
    const mark = props.num && props.num[0] !== '0' ? marker(props.num[0], props.num[1]) : undefined;
    const block: Paragraph = {
      kind: 'para', runs, align: props.align ?? 'left', indent: props.indent ?? (mark ? 18 + 18 * (props.num?.[1] ?? 0) : 0), firstIndent: mark ? 0 : props.firstIndent,
      spaceBefore: props.spaceBefore ?? (props.heading !== undefined && !inTable ? 10 : 0), spaceAfter: inTable ? 0 : props.spaceAfter ?? 6,
      lineHeight: props.lineHeight ?? 1.15, marker: mark, pageBreakBefore: props.pageBreakBefore,
    };
    const out: Block[] = [];
    // A page break inside the paragraph splits it: the text after the break starts the next page.
    const cuts = [0, ...breaks, runs.length];
    cuts.slice(1).forEach((end, k) => {
      const part = runs.slice(cuts[k], end);
      if (k > 0) out.push({ kind: 'pageBreak' });
      if (k === 0 ? part.some((r) => r.text) || mark || !after.length : part.some((r) => r.text)) out.push({ ...block, runs: part, ...(k > 0 ? { marker: undefined, spaceBefore: 0 } : {}) });
    });
    out.push(...after);
    return out;
  };
  const table = (t: XNode): Block => {
    const grid = kids(child(t, 'w:tblGrid'), 'w:gridCol').map((g) => twip(g.attrs['w:w'], 72));
    const borders = all(child(t, 'w:tblPr') ?? t, 'w:tblBorders').length > 0 || /grid/i.test(val(child(child(t, 'w:tblPr'), 'w:tblStyle')) ?? '');
    const rows = kids(t, 'w:tr').map((tr, r) => ({
      header: r === 0 && Boolean(child(child(tr, 'w:trPr'), 'w:tblHeader')),
      cells: kids(tr, 'w:tc').map((tc): TableCell => {
        const tcPr = child(tc, 'w:tcPr');
        if (all(tc, 'w:tbl').length) counts.nested++;
        // A nested table's paragraphs are listed in the cell, one after another.
        const paras = tc.children.flatMap((c) => (c.name === 'w:p' ? paragraph(c, true) : c.name === 'w:tbl' ? all(c, 'w:p').flatMap((p) => paragraph(p, true)) : []))
          .filter((b): b is Paragraph => b.kind === 'para');
        return { blocks: paras.length ? paras : [{ kind: 'para', runs: [], align: 'left', indent: 0, spaceBefore: 0, spaceAfter: 0, lineHeight: 1.15 }], colSpan: Number(val(child(tcPr, 'w:gridSpan')) ?? 1), background: hexColor(child(tcPr, 'w:shd')?.attrs['w:fill']) };
      }),
    }));
    const cols = Math.max(grid.length, ...rows.map((r) => r.cells.reduce((n, c) => n + c.colSpan, 0)));
    return { kind: 'table', rows, colWidths: Array.from({ length: cols }, (_, i) => grid[i] ?? 72), borders, spaceAfter: 8 };
  };
  const body = all(doc, 'w:body')[0];
  const walkBody = (node: XNode) => {
    for (const c of node.children) {
      if (c.name === 'w:p') blocks.push(...paragraph(c));
      else if (c.name === 'w:tbl') blocks.push(table(c));
      else if (c.name === 'w:sdt' || c.name === 'w:sdtContent' || c.name === 'w:customXml') walkBody(c);
    }
  };
  if (body) walkBody(body);
  const sect = body ? all(body, 'w:sectPr').at(-1) : undefined;
  if (sect && kids(sect, 'w:headerReference').length + kids(sect, 'w:footerReference').length) counts.headers++;
  const size = child(sect, 'w:pgSz'), margin = child(sect, 'w:pgMar');
  const writer = await FlowWriter.create({
    width: twip(size?.attrs['w:w'], 612), height: twip(size?.attrs['w:h'], 792),
    margin: { top: twip(margin?.attrs['w:top'], 72), right: twip(margin?.attrs['w:right'], 72), bottom: twip(margin?.attrs['w:bottom'], 72), left: twip(margin?.attrs['w:left'], 72) },
  });
  await writer.write(blocks);
  const notes = [`Rendered ${blocks.length} block(s) on ${writer.pages} page(s) with the document's page size and margins.`];
  const substituted = [...fonts].filter((f) => !/^(arial|helvetica|times new roman|times|courier new|courier)$/i.test(f));
  if (substituted.length) notes.push(`Fonts drawn with standard PDF fonts: ${substituted.slice(0, 8).join(', ')}${substituted.length > 8 ? '…' : ''}.`);
  if (writer.unrolledRows) notes.push(`${writer.unrolledRows} table row(s) taller than a page were laid out as paragraphs, one cell after another.`);
  if (writer.replaced) notes.push(`${writer.replaced} character(s) outside the standard fonts were drawn as “?”.`);
  const missing: [number, string][] = [[counts.headers, 'headers and footers'], [counts.footnotes, 'footnote/endnote reference(s)'], [counts.textboxes, 'text box(es)'], [counts.charts, 'chart(s)'],
    [counts.equations, 'equation(s)'], [counts.images, 'picture(s) in formats other than PNG or JPEG']];
  for (const [n, label] of missing) if (n) notes.push(`Not rendered: ${label === 'headers and footers' ? label : `${n} ${label}`}.`);
  if (counts.nested) notes.push(`${counts.nested} nested table(s) are shown as text inside their cell.`);
  if (counts.fields) notes.push(`Fields (page numbers, references) show the value last saved in the document.`);
  return { bytes: await writer.save(), pages: writer.pages, notes };
}
