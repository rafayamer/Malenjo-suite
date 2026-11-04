/* PowerPoint to PDF (MAL-032): one PDF page per slide at the presentation's slide size.
 *
 * Supported: slide, layout and master backgrounds (solid colours); shapes (rectangles,
 * rounded rectangles, ellipses, lines and connectors) with solid fills and outlines (RGB and
 * theme colours); text bodies with insets, vertical anchoring, alignment, bullets, sizes,
 * bold, italic, underline and colours; placeholders positioned from their layout or master;
 * pictures (PNG/JPEG); group shapes; simple tables. Charts, SmartArt, rotation, gradients and
 * effects are reported.
 */
import { rgb } from 'pdf-lib';
import { DEFAULT_STYLE, FlowWriter, imageInfo, type Align, type Paragraph, type Run } from './flowLayout';
import { hexColor, relationships, unzipOffice, xml, type DocumentPdf } from './docxToPdf';
import { all, child, kids, type XNode } from './xmlTree';

const EMU = 12700;
type Box = { x: number; y: number; w: number; h: number };
type Map2 = (b: Box) => Box;

export async function pptxToPdf(bytes: Uint8Array): Promise<DocumentPdf> {
  const files = unzipOffice(bytes);
  const pres = xml(files, 'ppt/presentation.xml');
  if (!pres) throw new Error('This is not a PowerPoint (PPTX) presentation.');
  const size = all(pres, 'p:sldSz')[0];
  const [W, H] = [Number(size?.attrs.cx ?? 9144000) / EMU, Number(size?.attrs.cy ?? 6858000) / EMU];
  const presRels = relationships(files, 'ppt/presentation.xml');
  const slidePaths = all(pres, 'p:sldId').map((s) => presRels.get(s.attrs['r:id'])).filter((p): p is string => Boolean(p && files[p]));
  if (!slidePaths.length) throw new Error('This presentation has no slides.');
  const counts = { charts: 0, smartArt: 0, rotated: 0, gradients: 0, images: 0, geometry: 0, media: 0 };

  // Theme colours (for schemeClr).
  const masterPath = slidePaths.length ? [...relationships(files, [...relationships(files, slidePaths[0]).values()].find((p) => p.includes('slideLayout')) ?? '').values()].find((p) => p.includes('slideMaster')) : undefined;
  const themePath = masterPath ? [...relationships(files, masterPath).values()].find((p) => p.includes('theme')) : undefined;
  const theme = themePath ? xml(files, themePath) : undefined;
  const scheme = new Map<string, string>();
  for (const c of theme ? all(theme, 'a:clrScheme')[0]?.children ?? [] : []) {
    const name = c.name.replace('a:', ''); const v = child(c, 'a:srgbClr')?.attrs.val ?? child(c, 'a:sysClr')?.attrs.lastClr;
    if (v) scheme.set(name, v);
  }
  const alias: Record<string, string> = { tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' };
  const colorOf = (node: XNode | undefined): [number, number, number] | undefined => {
    if (!node) return undefined;
    const srgb = child(node, 'a:srgbClr'); if (srgb) return hexColor(srgb.attrs.val);
    const sch = child(node, 'a:schemeClr'); if (sch) return hexColor(scheme.get(alias[sch.attrs.val] ?? sch.attrs.val));
    const sys = child(node, 'a:sysClr'); if (sys) return hexColor(sys.attrs.lastClr);
    return undefined;
  };
  const fillOf = (spPr: XNode | undefined): [number, number, number] | null | undefined => {
    if (!spPr) return undefined;
    if (child(spPr, 'a:noFill')) return null;
    if (child(spPr, 'a:gradFill')) { counts.gradients++; const stop = all(child(spPr, 'a:gradFill')!, 'a:gs')[0]; return stop ? colorOf(stop) : undefined; }
    const solid = child(spPr, 'a:solidFill'); return solid ? colorOf(solid) : undefined;
  };

  const writer = await FlowWriter.create({ width: W, height: H, margin: { top: 0, right: 0, bottom: 0, left: 0 } }, false);
  /** Placeholder boxes in a layout or master, by type and index. */
  const placeholders = (doc: XNode | undefined) => {
    const out = new Map<string, Box>();
    for (const sp of doc ? all(doc, 'p:sp') : []) {
      const ph = all(sp, 'p:ph')[0]; const off = all(child(sp, 'p:spPr') ?? sp, 'a:off')[0]; const ext = all(child(sp, 'p:spPr') ?? sp, 'a:ext')[0];
      if (!ph || !off || !ext) continue;
      const box = { x: Number(off.attrs.x) / EMU, y: Number(off.attrs.y) / EMU, w: Number(ext.attrs.cx) / EMU, h: Number(ext.attrs.cy) / EMU };
      out.set(`idx:${ph.attrs.idx ?? ''}`, box); out.set(`type:${ph.attrs.type ?? 'body'}`, box);
    }
    return out;
  };

  for (const path of slidePaths) {
    const slide = xml(files, path)!;
    const rels = relationships(files, path);
    const layoutPath = [...rels.values()].find((p) => p.includes('slideLayout'));
    const layout = layoutPath ? xml(files, layoutPath) : undefined;
    const masterP = layoutPath ? [...relationships(files, layoutPath).values()].find((p) => p.includes('slideMaster')) : undefined;
    const master = masterP ? xml(files, masterP) : undefined;
    const known = [placeholders(layout), placeholders(master)];
    writer.newPageSized(W, H);
    const page = writer.currentPage;
    const top = (y: number) => H - y;
    // Background: the slide's own, or its layout's, or its master's.
    for (const doc of [slide, layout, master]) {
      const bg = doc ? all(doc, 'p:bgPr')[0] : undefined;
      if (bg) { const fill = fillOf(bg); if (fill) page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(...fill) }); break; }
    }
    const drawText = async (txBody: XNode, box: Box, isTitle: boolean) => {
      const bodyPr = child(txBody, 'a:bodyPr');
      const inset = (k: string, d: number) => (bodyPr?.attrs[k] !== undefined ? Number(bodyPr.attrs[k]) / EMU : d);
      const [l, t, r, b] = [inset('lIns', 7.2), inset('tIns', 3.6), inset('rIns', 7.2), inset('bIns', 3.6)];
      const paras: Paragraph[] = kids(txBody, 'a:p').map((p) => {
        const pPr = child(p, 'a:pPr');
        const runs: Run[] = [];
        for (const c of p.children) {
          if (c.name !== 'a:r' && c.name !== 'a:br' && c.name !== 'a:fld') continue;
          if (c.name === 'a:br') { runs.push({ text: '\n', style: { ...DEFAULT_STYLE } }); continue; }
          const rPr = child(c, 'a:rPr');
          const style = { ...DEFAULT_STYLE, size: rPr?.attrs.sz ? Number(rPr.attrs.sz) / 100 : isTitle ? 32 : 18, bold: rPr?.attrs.b === '1', italic: rPr?.attrs.i === '1', underline: Boolean(rPr?.attrs.u && rPr.attrs.u !== 'none'),
            color: colorOf(child(rPr, 'a:solidFill')) ?? [0, 0, 0] as [number, number, number] };
          runs.push({ text: all(c, 'a:t').map((n) => n.children.map((x) => x.text).join('')).join(''), style });
        }
        const bullet = child(pPr, 'a:buChar')?.attrs.char;
        const align = (({ ctr: 'center', r: 'right', just: 'justify' } as Record<string, Align>)[pPr?.attrs.algn ?? ''] ?? 'left');
        return { kind: 'para', runs, align, indent: bullet ? 18 : 0, spaceBefore: 0, spaceAfter: 2, lineHeight: 1.1, marker: bullet ? '•' : undefined };
      });
      const area = { x: box.x + l, width: Math.max(4, box.w - l - r) };
      let height = 0;
      for (const p of paras) height += await writer.paragraph(p, { ...area, y: 0, draw: false });
      const anchor = bodyPr?.attrs.anchor ?? (isTitle ? 'ctr' : 't');
      const free = box.h - t - b - height;
      let y = top(box.y + t + (anchor === 'ctr' ? free / 2 : anchor === 'b' ? free : 0));
      for (const p of paras) y -= await writer.paragraph(p, { ...area, y, draw: true });
    };
    const xfrmOf = (spPr: XNode | undefined, map: Map2): Box | null => {
      const xfrm = child(spPr, 'a:xfrm'); const off = child(xfrm, 'a:off'), ext = child(xfrm, 'a:ext');
      if (!off || !ext) return null;
      if (Number(xfrm?.attrs.rot ?? 0) !== 0) counts.rotated++;
      return map({ x: Number(off.attrs.x) / EMU, y: Number(off.attrs.y) / EMU, w: Number(ext.attrs.cx) / EMU, h: Number(ext.attrs.cy) / EMU });
    };
    const walk = async (tree: XNode, map: Map2) => {
      for (const node of tree.children) {
        if (node.name === 'p:sp' || node.name === 'p:cxnSp') {
          const spPr = child(node, 'p:spPr');
          const ph = all(child(node, 'p:nvSpPr') ?? node, 'p:ph')[0];
          let box = xfrmOf(spPr, map);
          if (!box && ph) box = known.map((k) => k.get(`idx:${ph.attrs.idx ?? ''}`) ?? k.get(`type:${ph.attrs.type ?? 'body'}`)).find(Boolean) ?? null;
          if (!box) continue;
          const geom = child(spPr, 'a:prstGeom')?.attrs.prst ?? (node.name === 'p:cxnSp' ? 'line' : 'rect');
          if (child(spPr, 'a:custGeom')) counts.geometry++;
          const fill = fillOf(spPr);
          const ln = child(spPr, 'a:ln');
          const line = ln && !child(ln, 'a:noFill') ? colorOf(child(ln, 'a:solidFill')) ?? (node.name === 'p:cxnSp' ? [0, 0, 0] as [number, number, number] : undefined) : undefined;
          const lw = ln?.attrs.w ? Number(ln.attrs.w) / EMU : 0.75;
          const style = { ...(fill ? { color: rgb(...fill) } : {}), ...(line ? { borderColor: rgb(...line), borderWidth: lw } : {}) };
          if (geom === 'line' || geom.includes('Connector')) { if (line) page.drawLine({ start: { x: box.x, y: top(box.y) }, end: { x: box.x + box.w, y: top(box.y + box.h) }, thickness: lw, color: rgb(...line) }); }
          else if ((fill || line) && geom === 'ellipse') page.drawEllipse({ x: box.x + box.w / 2, y: top(box.y + box.h / 2), xScale: box.w / 2, yScale: box.h / 2, ...style });
          else if (fill || line) {
            if (!['rect', 'roundRect', 'snip1Rect', 'flowChartProcess', 'flowChartAlternateProcess'].includes(geom)) counts.geometry++;
            page.drawRectangle({ x: box.x, y: top(box.y + box.h), width: box.w, height: box.h, ...style });
          }
          const tx = child(node, 'p:txBody');
          if (tx) await drawText(tx, box, /title/i.test(ph?.attrs.type ?? ''));
        } else if (node.name === 'p:pic') {
          const box = xfrmOf(child(node, 'p:spPr'), map);
          const blip = all(node, 'a:blip')[0];
          const target = blip ? rels.get(blip.attrs['r:embed']) : undefined;
          const data = target ? files[target] : undefined; const info = data ? imageInfo(data) : null;
          if (!box || !data || !info) { counts.images++; continue; }
          const image = info.format === 'png' ? await writer.pdf.embedPng(data) : await writer.pdf.embedJpg(data);
          page.drawImage(image, { x: box.x, y: top(box.y + box.h), width: box.w, height: box.h });
        } else if (node.name === 'p:grpSp') {
          const xfrm = child(child(node, 'p:grpSpPr'), 'a:xfrm');
          const [off, ext, chOff, chExt] = ['a:off', 'a:ext', 'a:chOff', 'a:chExt'].map((n) => child(xfrm, n));
          if (off && ext && chOff && chExt) {
            const sx = Number(ext.attrs.cx) / (Number(chExt.attrs.cx) || 1), sy = Number(ext.attrs.cy) / (Number(chExt.attrs.cy) || 1);
            const ox = Number(off.attrs.x) / EMU, oy = Number(off.attrs.y) / EMU, cx = Number(chOff.attrs.x) / EMU, cy = Number(chOff.attrs.y) / EMU;
            await walk(node, (b) => map({ x: ox + (b.x - cx) * sx, y: oy + (b.y - cy) * sy, w: b.w * sx, h: b.h * sy }));
          } else await walk(node, map);
        } else if (node.name === 'p:graphicFrame') {
          const tbl = all(node, 'a:tbl')[0];
          const off = all(child(node, 'p:xfrm') ?? node, 'a:off')[0];
          if (all(node, 'c:chart').length) { counts.charts++; continue; }
          if (all(node, 'dgm:relIds').length) { counts.smartArt++; continue; }
          if (!tbl || !off) { counts.charts++; continue; }
          const widths = all(tbl, 'a:gridCol').map((g) => Number(g.attrs.w) / EMU);
          let y = Number(off.attrs.y) / EMU;
          const x0 = Number(off.attrs.x) / EMU;
          for (const tr of kids(tbl, 'a:tr')) {
            const h = Number(tr.attrs.h ?? 0) / EMU || 24;
            let x = x0;
            for (const [i, tc] of kids(tr, 'a:tc').entries()) {
              const w = widths[i] ?? 72;
              const box = map({ x, y, w, h });
              const fill = fillOf(child(tc, 'a:tcPr'));
              page.drawRectangle({ x: box.x, y: top(box.y + box.h), width: box.w, height: box.h, ...(fill ? { color: rgb(...fill) } : {}), borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 0.6 });
              const body = child(tc, 'a:txBody'); if (body) await drawText(body, box, false);
              x += w;
            }
            y += h;
          }
        } else if (node.name === 'p:contentPart' || node.name === 'mc:AlternateContent') counts.media++;
      }
    };
    const tree = all(slide, 'p:spTree')[0];
    if (tree) await walk(tree, (b) => b);
  }
  const notes = [`Rendered ${slidePaths.length} slide(s) at ${Math.round(W)} × ${Math.round(H)} pt.`];
  if (writer.replaced) notes.push(`${writer.replaced} character(s) outside the standard fonts were drawn as “?”.`);
  const missing: [number, string][] = [[counts.charts, 'chart(s) or other embedded objects'], [counts.smartArt, 'SmartArt diagram(s)'], [counts.images, 'picture(s) in formats other than PNG or JPEG'],
    [counts.media, 'ink or alternate-content item(s)']];
  for (const [n, label] of missing) if (n) notes.push(`Not rendered: ${n} ${label}.`);
  if (counts.rotated) notes.push(`${counts.rotated} rotated item(s) are drawn unrotated.`);
  if (counts.gradients) notes.push(`${counts.gradients} gradient fill(s) are drawn with their first colour.`);
  if (counts.geometry) notes.push(`${counts.geometry} shape(s) with other outlines are drawn as rectangles.`);
  notes.push('Text uses standard PDF fonts; theme fonts are not embedded.');
  return { bytes: await writer.save(), pages: writer.pages, notes };
}
