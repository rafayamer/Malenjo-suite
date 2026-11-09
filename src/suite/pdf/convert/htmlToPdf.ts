/* HTML to PDF (MAL-034) through MALENJO's own controlled renderer.
 *
 * The HTML is parsed by xmlTree (never by a browser engine): no scripts run, nothing is fetched,
 * and only inline data: images (PNG/JPEG) are drawn. Supported CSS (from <style> rules with tag,
 * .class, #id or tag.class selectors, and style attributes): color, background-color, font-size,
 * font-weight, font-style, font-family, text-align, text-decoration, margin-top/bottom,
 * margin-left/padding-left, line-height, display:none and page-break-before/break-before. Other
 * properties and elements are listed in the report.
 */
import { DEFAULT_STYLE, FlowWriter, imageInfo, type Align, type Block, type ImageBlock, type Paragraph, type Run, type RunStyle, type TableCell } from './flowLayout';
import { PAGE_SIZES, type PageSizeName } from './imagesToPdf';
import { familyOf, type DocumentPdf } from './docxToPdf';
import { all, parseMarkup, textOf, type XNode } from './xmlTree';

export interface HtmlPdfOptions { pageSize: Exclude<PageSizeName, 'image'>; landscape: boolean; margin: number }
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'hr', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'address', 'body', 'html']);
const SKIP = new Set(['script', 'style', 'head', 'template', 'noscript', 'iframe', 'object', 'embed', 'video', 'audio', 'canvas', 'svg', 'form', 'input', 'select', 'textarea', 'button', 'link', 'meta']);
const SUPPORTED = new Set(['color', 'background-color', 'background', 'font-size', 'font-weight', 'font-style', 'font-family', 'text-align', 'text-decoration', 'margin-top', 'margin-bottom', 'margin-left', 'padding-left', 'line-height', 'display', 'page-break-before', 'break-before', 'margin']);
const NAMED_COLORS: Record<string, string> = { black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', gray: '808080', grey: '808080', navy: '000080', maroon: '800000', purple: '800080', teal: '008080', orange: 'ffa500', yellow: 'ffff00', silver: 'c0c0c0', lime: '00ff00', aqua: '00ffff', fuchsia: 'ff00ff', olive: '808000' };
type Css = Record<string, string>;
interface Ctx { run: RunStyle; align: Align; indent: number; css: Css; list?: { ordered: boolean; n: number }; pre: boolean; /** Background of the nearest block that sets one (painted behind its lines). */ background?: [number, number, number] }

function color(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  const hex = NAMED_COLORS[v] ?? (/^#([0-9a-f]{3}){1,2}$/.test(v) ? (v.length === 4 ? [...v.slice(1)].map((c) => c + c).join('') : v.slice(1)) : undefined);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : undefined;
}
function length(value: string | undefined, base: number): number | undefined {
  const m = value ? /^(-?[\d.]+)(px|pt|em|rem|%)?$/.exec(value.trim()) : null;
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'pt' ? n : m[2] === 'em' || m[2] === 'rem' ? n * base : m[2] === '%' ? (n / 100) * base : n * 0.75;
}

const MAX_SPAN = 1000;
export async function htmlToPdf(source: string, options: HtmlPdfOptions): Promise<DocumentPdf> {
  const doc = parseMarkup(source, true);
  const unsupportedCss = new Set<string>(); const skipped = new Map<string, number>(); let externalImages = 0, otherImages = 0, complexSelectors = 0;
  // Style rules: simple selectors only.
  const rules: { tag?: string; cls?: string; id?: string; css: Css }[] = [];
  const parseDecls = (text: string): Css => {
    const css: Css = {};
    for (const decl of text.split(';')) {
      const at = decl.indexOf(':'); if (at < 0) continue;
      const name = decl.slice(0, at).trim().toLowerCase(), value = decl.slice(at + 1).replace(/!important/i, '').trim();
      if (!name) continue;
      if (!SUPPORTED.has(name)) { unsupportedCss.add(name); continue; }
      css[name] = value;
    }
    return css;
  };
  for (const style of all(doc, 'style')) {
    const text = textOf(style).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, '');
    for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const css = parseDecls(m[2]);
      for (const sel of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        const simple = /^([a-z][a-z0-9]*)?(?:\.([\w-]+))?(?:#([\w-]+))?$/i.exec(sel);
        if (!simple || (!simple[1] && !simple[2] && !simple[3])) { complexSelectors++; continue; }
        rules.push({ tag: simple[1]?.toLowerCase(), cls: simple[2], id: simple[3], css });
      }
    }
  }
  const cssOf = (n: XNode): Css => {
    const classes = (n.attrs.class ?? '').split(/\s+/);
    const matched = rules.filter((r) => (!r.tag || r.tag === n.name) && (!r.cls || classes.includes(r.cls)) && (!r.id || r.id === n.attrs.id))
      .sort((a, b) => (a.id ? 100 : 0) + (a.cls ? 10 : 0) + (a.tag ? 1 : 0) - ((b.id ? 100 : 0) + (b.cls ? 10 : 0) + (b.tag ? 1 : 0)));
    return Object.assign({}, ...matched.map((r) => r.css), n.attrs.style ? parseDecls(n.attrs.style) : {});
  };
  const HEADING: Record<string, number> = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67 };
  const blocks: Block[] = [];
  let runs: Run[] = []; let paraCtx: Ctx | null = null; let pendingBreak = false;
  // A list item's marker waits for the item's first paragraph with text, even one inside a <p> in the item.
  let pendingMarker: string | undefined;
  const flush = (ctx: Ctx, extra: Partial<Paragraph> = {}) => {
    if (!runs.some((r) => r.text.trim()) && !extra.marker) { runs = []; return; }
    if (pendingMarker && !extra.marker) { extra = { ...extra, marker: pendingMarker }; pendingMarker = undefined; }
    const before = length(ctx.css['margin-top'], ctx.run.size) ?? 0, after = length(ctx.css['margin-bottom'], ctx.run.size) ?? ctx.run.size * 0.6;
    const lh = ctx.css['line-height'] ? (Number(ctx.css['line-height']) || (length(ctx.css['line-height'], ctx.run.size) ?? ctx.run.size * 1.2) / ctx.run.size) : 1.2;
    const trimmed = ctx.pre ? runs : runs.map((r, i) => ({ ...r, text: i === 0 ? r.text.replace(/^\s+/, '') : r.text }));
    blocks.push({ kind: 'para', runs: trimmed, align: ctx.align, indent: ctx.indent, spaceBefore: before, spaceAfter: after, lineHeight: lh, pageBreakBefore: pendingBreak, pre: ctx.pre || undefined, background: ctx.background, ...extra });
    pendingBreak = false; runs = [];
  };
  const derive = (n: XNode, parent: Ctx): Ctx | null => {
    let css = cssOf(n);
    if (css.display === 'none' || n.attrs.hidden !== undefined) return null;
    const run = { ...parent.run };
    const tagStyle: Partial<RunStyle> = n.name in HEADING ? { size: 12 * HEADING[n.name], bold: true } : ['b', 'strong', 'th'].includes(n.name) ? { bold: true } : ['i', 'em', 'cite', 'var'].includes(n.name) ? { italic: true }
      : n.name === 'u' || n.name === 'ins' ? { underline: true } : ['s', 'del', 'strike'].includes(n.name) ? { strike: true } : ['code', 'kbd', 'samp', 'pre', 'tt'].includes(n.name) ? { family: 'mono' }
        : n.name === 'a' ? { color: [0.05, 0.3, 0.75], underline: true } : n.name === 'small' || n.name === 'sub' || n.name === 'sup' ? { size: run.size * 0.83 } : n.name === 'mark' ? { background: [1, 1, 0] } : {};
    Object.assign(run, tagStyle);
    const size = length(css['font-size'], parent.run.size); if (size) run.size = Math.max(4, Math.min(96, size));
    if (css['font-weight']) run.bold = /bold|[6-9]00/.test(css['font-weight']);
    if (css['font-style']) run.italic = /italic|oblique/.test(css['font-style']);
    if (css['font-family']) run.family = /mono|courier|consol/i.test(css['font-family']) ? 'mono' : familyOf(css['font-family'].split(',')[0].replace(/["']/g, ''));
    const fg = color(css.color); if (fg) run.color = fg;
    const bg = color(css['background-color'] ?? css.background); if (bg && !BLOCK.has(n.name)) run.background = bg;
    if (css['text-decoration']) { run.underline = css['text-decoration'].includes('underline'); run.strike = css['text-decoration'].includes('line-through'); }
    const align = (['left', 'center', 'right', 'justify'].includes(css['text-align']) ? css['text-align'] : n.name === 'th' ? 'left' : parent.align) as Align;
    const indent = parent.indent + (length(css['margin-left'] ?? css['padding-left'], run.size) ?? (['ul', 'ol', 'blockquote', 'dd'].includes(n.name) ? 24 : 0));
    if (css['page-break-before'] === 'always' || css['break-before'] === 'page') pendingBreak = true;
    // line-height is inherited: a child keeps its container's value unless it sets its own.
    if (css['line-height'] === undefined && parent.css['line-height'] !== undefined) css = { ...css, 'line-height': parent.css['line-height'] };
    return { run, align, indent, css: n.name in HEADING ? { 'margin-top': '0.6em', 'margin-bottom': '0.4em', ...css } : n.name === 'p' ? { 'margin-bottom': '0.8em', ...css } : css, list: parent.list, pre: parent.pre || n.name === 'pre', background: (BLOCK.has(n.name) ? bg : undefined) ?? parent.background };
  };
  const inline = (n: XNode, ctx: Ctx) => {
    for (const c of n.children) {
      if (c.name === '#text') { const text = ctx.pre ? c.text : c.text.replace(/\s+/g, ' '); if (text) runs.push({ text, style: ctx.run }); continue; }
      if (SKIP.has(c.name)) { if (!['style', 'head', 'meta', 'link', 'template', 'noscript'].includes(c.name)) skipped.set(c.name, (skipped.get(c.name) ?? 0) + 1); continue; }
      if (c.name === 'br') { runs.push({ text: '\n', style: ctx.run }); continue; }
      if (c.name === 'img') { if (derive(c, ctx)) image(c, ctx); continue; } // a hidden picture is left out
      if (BLOCK.has(c.name) || c.name === 'tr' || c.name === 'td') { block(c, ctx); continue; }
      const next = derive(c, ctx); if (next) inline(c, next);
    }
  };
  const image = (n: XNode, ctx: Ctx) => {
    const src = n.attrs.src ?? '';
    const m = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src);
    if (!m) { if (/^(https?:|\/\/)/i.test(src)) externalImages++; else otherImages++; return; }
    const bytes = Uint8Array.from(atob(m[2].replace(/\s+/g, '')), (ch) => ch.charCodeAt(0));
    const info = imageInfo(bytes); if (!info) { otherImages++; return; }
    flush(ctx);
    const w = length(n.attrs.width ? `${n.attrs.width}px` : cssOf(n).width, ctx.run.size) ?? info.width * 0.75;
    const h = length(n.attrs.height ? `${n.attrs.height}px` : undefined, ctx.run.size) ?? (w * info.height) / info.width;
    blocks.push({ kind: 'image', bytes, format: info.format, width: w, height: h, align: ctx.align, spaceAfter: 6 });
  };
  const table = (n: XNode, ctx: Ctx) => {
    // Rows come from the table itself and its row groups; hidden rows, groups and cells (display:none or the
    // hidden attribute) are left out, as they are for any other element.
    // A row group's and a row's own styles (colour, weight, background) carry into their cells.
    const fill = (node: XNode) => color(cssOf(node)['background-color'] ?? cssOf(node).background);
    type Row = { tr: XNode; ctx: Ctx; background?: [number, number, number] };
    const visibleRows = (node: XNode, parent: Ctx, background?: [number, number, number]): Row[] => node.children.flatMap((c): Row[] => {
      const next = c.name === 'tr' || c.name === 'thead' || c.name === 'tbody' || c.name === 'tfoot' ? derive(c, { ...parent, indent: 0 }) : null;
      if (!next) return [];
      if (c.name === 'tr') return [{ tr: c, ctx: next, background: fill(c) ?? background }];
      return visibleRows(c, next, fill(c) ?? background);
    });
    const rows = visibleRows(n, ctx).map(({ tr, ctx: rowCtx, background: rowFill }, r) => ({ header: r === 0 && tr.children.some((c) => c.name === 'th'), cells: tr.children.filter((c) => (c.name === 'td' || c.name === 'th') && derive(c, { ...rowCtx, indent: 0 })).map((cell): TableCell => {
      const cctx = derive(cell, { ...rowCtx, indent: 0 })!;
      const saved = blocks.length; const savedRuns = runs; runs = [];
      inline(cell, cctx); flush(cctx, { spaceAfter: 0, indent: 0 });
      // Text and pictures both belong in the cell; the shared table layout draws images too.
      const paras = blocks.splice(saved).filter((b): b is Paragraph | ImageBlock => b.kind === 'para' || b.kind === 'image'); runs = savedRuns;
      return { blocks: paras.length ? paras : [{ kind: 'para', runs: [], align: 'left', indent: 0, spaceBefore: 0, spaceAfter: 0, lineHeight: 1.2 }], colSpan: Math.min(MAX_SPAN, Math.max(1, Math.floor(Number(cell.attrs.colspan ?? 1)) || 1)), background: fill(cell) ?? rowFill };
    }) }));
    const cols = Math.max(1, ...rows.map((r) => r.cells.reduce((s, c) => s + c.colSpan, 0)));
    // As browsers do, a span counts at most 1000 columns; a table wider than that is refused rather than laid out.
    if (cols > MAX_SPAN) throw new Error(`This HTML has a table more than ${MAX_SPAN} columns wide, which cannot be laid out on a page.`);
    blocks.push({ kind: 'table', rows, colWidths: Array.from({ length: cols }, () => 1000 / cols), borders: n.attrs.border !== '0', spaceAfter: 10 });
  };
  const block = (n: XNode, parent: Ctx) => {
    const ctx = derive(n, parent); if (!ctx) return;
    flush(paraCtx ?? parent); paraCtx = ctx;
    if (n.name === 'hr') { blocks.push({ kind: 'rule' }); return; }
    if (n.name === 'table') { table(n, ctx); return; }
    if (n.name === 'ul' || n.name === 'ol') {
      const list = { ordered: n.name === 'ol', n: Number(n.attrs.start ?? 1) - 1 };
      for (const li of n.children.filter((c) => c.name === 'li')) {
        const lctx = derive(li, { ...ctx, list }); if (!lctx) continue;
        list.n++;
        runs = []; pendingMarker = list.ordered ? `${list.n}.` : '•';
        inline(li, { ...lctx, list: undefined });
        flush(lctx, { spaceAfter: 2 });
        // An item with no text still shows its marker.
        if (pendingMarker) { const marker = pendingMarker; pendingMarker = undefined; flush(lctx, { marker, spaceAfter: 2 }); }
      }
      paraCtx = parent; return;
    }
    inline(n, ctx);
    flush(ctx);
    paraCtx = parent;
  };
  const root: Ctx = { run: { ...DEFAULT_STYLE, size: 12 }, align: 'left', indent: 0, css: {}, pre: false };
  const body = all(doc, 'body')[0] ?? doc;
  // A body hidden by display:none or the hidden attribute shows nothing, as in a browser.
  const bodyCtx = derive(body, root);
  if (bodyCtx) {
    paraCtx = bodyCtx;
    inline(body, bodyCtx);
    flush(bodyCtx);
  }
  let [w, h] = PAGE_SIZES[options.pageSize];
  if (options.landscape !== w > h) [w, h] = [h, w];
  const writer = await FlowWriter.create({ width: w, height: h, margin: { top: options.margin, right: options.margin, bottom: options.margin, left: options.margin } });
  await writer.write(blocks);
  const notes = [`Rendered ${blocks.length} block(s) on ${writer.pages} page(s) with MALENJO's HTML renderer; no scripts were run and nothing was downloaded.`];
  if (unsupportedCss.size) notes.push(`CSS not applied: ${[...unsupportedCss].sort().slice(0, 12).join(', ')}${unsupportedCss.size > 12 ? '…' : ''}.`);
  if (complexSelectors) notes.push(`${complexSelectors} CSS selector(s) beyond tag, class and id selectors were ignored.`);
  skipped.delete('script');
  const scripts = all(doc, 'script').length;
  if (scripts) notes.push(`${scripts} <script> element(s) were not run.`);
  if (skipped.size) notes.push(`Left out: ${[...skipped.entries()].map(([t, n]) => `${n} <${t}>`).join(', ')}.`);
  if (externalImages) notes.push(`${externalImages} image(s) from web addresses were not downloaded.`);
  if (otherImages) notes.push(`${otherImages} image(s) not embedded as PNG or JPEG data were left out.`);
  if (writer.unrolledRows) notes.push(`${writer.unrolledRows} table row(s) taller than a page were laid out as paragraphs, one cell after another.`);
  if (writer.replaced) notes.push(`${writer.replaced} character(s) outside the standard fonts were drawn as “?”.`);
  return { bytes: await writer.save(), pages: writer.pages, notes };
}
