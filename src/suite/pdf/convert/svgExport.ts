/* PDF to SVG (MAL-043): page graphics as SVG, keeping supported vector constructs.
 *
 * Supported: paths (move, line, curves, rectangles, close) with fill, stroke, even-odd fill
 * and line width under their transformation matrix; text as <text> sized to the PDF advance;
 * JPEG images and 8-bit Flate RGB/grey images (with soft masks). Everything else (form
 * XObjects, shadings, patterns, clipping, dashes, other image formats) is counted and reported.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { readPageModel, type Matrix } from '../content/contentModel';
import { viewerFrame } from '../pdfStamp';
import { encodePng } from './imageCodecs';
import type { ConversionResult } from './textFormats';

const N = PDFName.of;
const r = (n: number) => String(Math.round(n * 1000) / 1000);
const mat = (m: Matrix | number[]) => `matrix(${m.map(r).join(' ')})`;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const invert = (m: Matrix): Matrix => { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
const mul = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const base64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

function family(baseFont: string): string {
  const name = baseFont.replace(/^[A-Z]{6}\+/, '');
  const generic = /courier|mono|consol/i.test(name) ? 'monospace' : /times|serif|georgia|garamond|roman|minion/i.test(name) && !/sans/i.test(name) ? 'serif' : 'sans-serif';
  return `font-family="${esc(name.split(/[-,]/)[0])}, ${generic}"${/bold|black|heavy/i.test(name) ? ' font-weight="bold"' : ''}${/italic|oblique/i.test(name) ? ' font-style="italic"' : ''}`;
}

/** True when a stream's /DecodeParms (a dictionary, or an array of them) asks for a predictor. */
function hasPredictor(pdf: PDFDocument, dict: PDFRawStream['dict']): boolean {
  const parms = dict.get(N('DecodeParms'));
  const resolved = parms ? pdf.context.lookup(parms) : undefined;
  const list = resolved instanceof PDFArray ? resolved.asArray().map((p) => pdf.context.lookup(p)) : [resolved];
  return list.some((p) => p instanceof PDFDict && (p.lookupMaybe(N('Predictor'), PDFNumber)?.asNumber() ?? 1) > 1);
}

/** A soft mask's 8-bit alpha samples for a width × height image, or null when they cannot be read. */
function maskAlpha(pdf: PDFDocument, dict: PDFRawStream['dict'], width: number, height: number): Uint8Array | null {
  const smask = pdf.context.lookup(dict.get(N('SMask')) as never);
  if (!(smask instanceof PDFRawStream)) return null;
  if (smask.dict.lookupMaybe(N('Width'), PDFNumber)?.asNumber() !== width || smask.dict.lookupMaybe(N('Height'), PDFNumber)?.asNumber() !== height) return null;
  if (smask.dict.lookupMaybe(N('BitsPerComponent'), PDFNumber)?.asNumber() !== 8 || hasPredictor(pdf, smask.dict)) return null;
  // /Decode [1 0] inverts the samples; any other mapping than [0 1] is not supported here.
  const decode = smask.dict.lookupMaybe(N('Decode'), PDFArray)?.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN));
  const inverted = decode !== undefined && decode[0] === 1 && decode[1] === 0;
  if (decode !== undefined && !inverted && !(decode[0] === 0 && decode[1] === 1)) return null;
  let alpha: Uint8Array;
  try { alpha = decodePDFRawStream(smask).decode(); } catch { return null; }
  if (alpha.length < width * height) return null;
  return inverted ? alpha.map((a) => 255 - a) : alpha;
}

/**
 * An image XObject as a data URI, plus a luminance mask (a grey PNG) when its soft mask cannot be folded into the
 * picture itself (a JPEG); null when the format, or its transparency, is not supported here.
 */
function imageUri(pdf: PDFDocument, stream: PDFRawStream): { uri: string; mask?: string } | null {
  const dict = stream.dict;
  const filters = (() => { const f = dict.get(N('Filter')); return f instanceof PDFArray ? f.asArray().map(String) : f ? [String(f)] : []; })();
  let cs = dict.get(N('ColorSpace')); if (cs && !(cs instanceof PDFName) && !(cs instanceof PDFArray)) cs = pdf.context.lookup(cs as never);
  const components = cs instanceof PDFName ? ({ '/DeviceRGB': 3, '/DeviceGray': 1 } as Record<string, number>)[cs.toString()] ?? 0
    : cs instanceof PDFArray && String(cs.get(0)) === '/ICCBased' ? (pdf.context.lookup(cs.get(1)) as PDFRawStream)?.dict.lookupMaybe(N('N'), PDFNumber)?.asNumber() ?? 0 : 0;
  if (components !== 1 && components !== 3) return null;
  // A colour-key or stencil /Mask is not applied here: such a picture is counted as not converted, never drawn opaque.
  if (dict.has(N('Mask'))) return null;
  // A PNG or TIFF predictor leaves filtered rows, not samples, after decompression: such pictures are reported.
  if (hasPredictor(pdf, dict)) return null;
  if (filters.length === 1 && filters[0] === '/DCTDecode') {
    const uri = `data:image/jpeg;base64,${base64(stream.contents)}`;
    if (!dict.has(N('SMask'))) return { uri };
    // The JPEG stays as it is; its transparency goes into an SVG mask drawn from the soft mask's samples.
    const width = dict.lookupMaybe(N('Width'), PDFNumber)?.asNumber() ?? 0, height = dict.lookupMaybe(N('Height'), PDFNumber)?.asNumber() ?? 0;
    if (!width || !height || width * height > 25_000_000) return null;
    const alpha = maskAlpha(pdf, dict, width, height);
    if (!alpha) return null;
    const grey = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) { grey[i * 4] = grey[i * 4 + 1] = grey[i * 4 + 2] = alpha[i]; grey[i * 4 + 3] = 255; }
    return { uri, mask: `data:image/png;base64,${base64(encodePng({ width, height, data: grey }))}` };
  }
  if (dict.has(N('Decode')) || dict.lookupMaybe(N('BitsPerComponent'), PDFNumber)?.asNumber() !== 8 || filters.some((f) => f !== '/FlateDecode')) return null;
  const width = dict.lookup(N('Width'), PDFNumber).asNumber(), height = dict.lookup(N('Height'), PDFNumber).asNumber();
  if (width * height > 25_000_000) return null;
  let raw: Uint8Array;
  try { raw = decodePDFRawStream(stream).decode(); } catch { return null; }
  if (raw.length < width * height * components) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * components;
    rgba[i * 4] = raw[s]; rgba[i * 4 + 1] = raw[s + (components === 3 ? 1 : 0)]; rgba[i * 4 + 2] = raw[s + (components === 3 ? 2 : 0)]; rgba[i * 4 + 3] = 255;
  }
  if (dict.has(N('SMask'))) {
    // Transparency that cannot be read is reported (the picture is counted as not converted), never made opaque.
    const alpha = maskAlpha(pdf, dict, width, height);
    if (!alpha) return null;
    for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = alpha[i];
  }
  return { uri: `data:image/png;base64,${base64(encodePng({ width, height, data: rgba }))}` };
}

export async function pdfToSvg(bytes: Uint8Array, pages: number[], title: string): Promise<ConversionResult> {
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { throw new Error('This PDF could not be read because it is encrypted, invalid or damaged.'); }
  const counts = { forms: 0, shadings: 0, clips: 0, dashes: 0, images: 0, text: 0, colours: 0, transparency: 0 };
  const files = pages.map((pageNumber) => {
    const index = pageNumber - 1;
    const model = readPageModel(pdf, index);
    const frame = viewerFrame(pdf, index);
    // Page space -> shown space (y up) -> SVG (y down).
    const toSvg = mul(invert(frame.matrix), [1, 0, 0, -1, 0, frame.height]);
    const parts: string[] = [];
    const xobjects = pdf.getPage(index).node.Resources()?.lookupMaybe(N('XObject'), PDFDict);
    const states = pdf.getPage(index).node.Resources()?.lookupMaybe(N('ExtGState'), PDFDict);
    // Graphics states that make what follows translucent, masked or blended (which SVG export draws opaque).
    const transparent = (name: string) => {
      const gs = states?.lookupMaybe(N(name), PDFDict);
      if (!gs) return false;
      const alpha = (key: string) => gs.lookupMaybe(N(key), PDFNumber)?.asNumber() ?? 1;
      const smask = gs.get(N('SMask')), blend = gs.get(N('BM'));
      return alpha('ca') < 1 || alpha('CA') < 1 || (smask !== undefined && String(smask) !== '/None') || (blend !== undefined && !['/Normal', '/Compatible'].includes(String(blend)));
    };
    model.ops.forEach((op) => {
      if (op.op === 'gs' && op.operands[0]?.type === 'name' && transparent(op.operands[0].value)) counts.transparency++;
      else if (op.op === 'sh') counts.shadings++;
      else if (op.op === 'W' || op.op === 'W*') counts.clips++;
      else if (op.op === 'd' && op.operands[0]?.type === 'array' && op.operands[0].items.length) counts.dashes++;
      else if (op.op === 'scn' || op.op === 'SCN' || op.op === 'sc' || op.op === 'SC' || op.op === 'cs' || op.op === 'CS') counts.colours++;
      else if (op.op === 'Do') {
        const name = op.operands[0]?.type === 'name' ? op.operands[0].value : '';
        const target = xobjects?.get(N(name)); const object = target ? pdf.context.lookup(target) : null;
        if (object instanceof PDFRawStream && String(object.dict.get(N('Subtype'))) === '/Form') counts.forms++;
      }
    });
    // Drawing order follows the content stream.
    const items: { at: number; svg: string }[] = [];
    for (const path of model.paths) {
      const d: string[] = [];
      let [cx, cy, sx, sy] = [0, 0, 0, 0]; // current point and subpath start
      for (const op of model.ops.slice(path.startIndex, path.endIndex)) {
        const v = op.operands.map((o) => (o.type === 'number' ? o.value : 0));
        if (op.op === 'm') { d.push(`M${r(v[0])} ${r(v[1])}`); [cx, cy, sx, sy] = [v[0], v[1], v[0], v[1]]; }
        else if (op.op === 'l') { d.push(`L${r(v[0])} ${r(v[1])}`); [cx, cy] = [v[0], v[1]]; }
        else if (op.op === 'c') { d.push(`C${v.slice(0, 6).map(r).join(' ')}`); [cx, cy] = [v[4], v[5]]; }
        else if (op.op === 'v') { d.push(`C${r(cx)} ${r(cy)} ${v.slice(0, 4).map(r).join(' ')}`); [cx, cy] = [v[2], v[3]]; }
        else if (op.op === 'y') { d.push(`C${r(v[0])} ${r(v[1])} ${r(v[2])} ${r(v[3])} ${r(v[2])} ${r(v[3])}`); [cx, cy] = [v[2], v[3]]; }
        else if (op.op === 'h') { d.push('Z'); [cx, cy] = [sx, sy]; }
        else if (op.op === 're') { d.push(`M${r(v[0])} ${r(v[1])}h${r(v[2])}v${r(v[3])}h${r(-v[2])}Z`); [cx, cy, sx, sy] = [v[0], v[1], v[0], v[1]]; }
      }
      const paint = path.paint;
      const fill = /^[fFbB]/.test(paint) ? path.fill : 'none';
      const stroke = /^[sSbB]/.test(paint) ? path.stroke : 'none';
      // s, b and b* close the path before painting (so the stroke closes too).
      if (/^(s|b\*?)$/.test(paint)) d.push('Z');
      items.push({ at: path.startIndex, svg: `<path d="${d.join('')}" transform="${mat(path.ctm)}" fill="${fill}"${paint.endsWith('*') ? ' fill-rule="evenodd"' : ''} stroke="${stroke}"${stroke !== 'none' ? ` stroke-width="${r(path.lineWidth || 1)}"` : ''}/>` });
    }
    for (const run of model.runs) {
      if (!run.text.trim()) continue;
      if (run.unmapped) { counts.text++; continue; }
      // Text rendering modes: 3 and 7 are invisible (an OCR layer), 1 and 5 stroke only, 2 and 6 both.
      const mode = run.render % 4;
      if (mode === 3) continue;
      const paint = `fill="${mode === 1 ? 'none' : run.fill}"${mode === 1 || mode === 2 ? ` stroke="${run.stroke}" stroke-width="${r(0.04)}"` : ''}`;
      const th = run.horizontalScale / 100;
      const length = run.size ? run.advance / (run.size * th) : 0;
      items.push({ at: run.opIndex, svg: `<text transform="${mat(run.start)} scale(1 -1)" font-size="1" ${family(run.font.baseFont)} ${paint}${length > 0 ? ` textLength="${r(length)}" lengthAdjust="spacingAndGlyphs"` : ''} xml:space="preserve">${esc(run.display || run.text)}</text>` });
    }
    for (const image of model.images) {
      const stream = image.ref ? pdf.context.lookup(xobjects?.get(N(image.name)) as never) : null;
      const found = stream instanceof PDFRawStream ? imageUri(pdf, stream) : null;
      if (!found) { counts.images++; continue; }
      // A mask is drawn in the picture's own unit square, so it lines up with the picture under the same transform.
      const maskId = `mask-${pageNumber}-${image.opIndex}`;
      const mask = found.mask ? `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="1" height="1"><image width="1" height="1" preserveAspectRatio="none" href="${found.mask}"/></mask>` : '';
      items.push({ at: image.opIndex, svg: `${mask}<image width="1" height="1" preserveAspectRatio="none" transform="${mat(image.ctm)} matrix(1 0 0 -1 0 1)"${found.mask ? ` mask="url(#${maskId})"` : ''} href="${found.uri}"/>` });
    }
    items.sort((a, b) => a.at - b.at);
    parts.push(...items.map((i) => i.svg));
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${r(frame.width)}pt" height="${r(frame.height)}pt" viewBox="0 0 ${r(frame.width)} ${r(frame.height)}">\n<title>${esc(title)} — page ${pageNumber}</title>\n<rect width="100%" height="100%" fill="#fff"/>\n<g transform="${mat(toSvg)}">\n${parts.join('\n')}\n</g>\n</svg>\n`;
    return { name: `${title}-page-${pageNumber}.svg`, bytes: new TextEncoder().encode(svg), mime: 'image/svg+xml' };
  });
  const notes: string[] = [];
  if (counts.forms) notes.push(`${counts.forms} embedded drawing(s) (form XObjects) were not converted.`);
  if (counts.transparency) notes.push(`Transparency set by ${counts.transparency} graphics state change(s) (opacity, soft masks or blend modes) was not applied; that content is drawn opaque.`);
  if (counts.shadings) notes.push(`${counts.shadings} gradient shading(s) were left out.`);
  if (counts.clips) notes.push(`${counts.clips} clipping path(s) were not applied; clipped content may show in full.`);
  if (counts.dashes) notes.push('Dashed lines are drawn solid.');
  if (counts.colours) notes.push('Colours set through colour spaces or patterns are drawn black.');
  if (counts.images) notes.push(`${counts.images} image(s) in formats SVG export does not support were left out.`);
  if (counts.text) notes.push(`${counts.text} text run(s) without a Unicode mapping were left out.`);
  if (!notes.length) notes.push('Every graphic on these pages was converted.');
  return { files, notes };
}
