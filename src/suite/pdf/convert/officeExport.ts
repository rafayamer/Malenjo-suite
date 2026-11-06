/* PDF to Word (MAL-037), PowerPoint (MAL-038) and Excel (MAL-039).
 *
 * Built from the same structure model as Markdown and HTML (pdfStructure.ts):
 * - DOCX: heading styles, paragraphs with size, bold and italic, real bulleted and numbered
 *   lists, bordered tables, inline images, one section per PDF page size.
 * - PPTX: one slide per page at the page's size, editable text boxes where the text is,
 *   pictures, and filled or outlined rectangles from the page drawing.
 * - XLSX: one sheet per detected table (numbers stored as numbers), or the page's lines as
 *   rows when a page has no table.
 * What could not be reconstructed is listed in the fidelity notes.
 */
import { zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { readPageModel } from '../content/contentModel';
import { frameOf } from '../content/objectEdit';
import { layout, master, ns, officeRel, relsNS, spTree, theme } from '../pdfToPresentation';
import { encodePng } from './imageCodecs';
import { blocksOf, documentHeadingSizes, linesOf, type Block, type PageStructure } from './pdfStructure';
import type { ConversionResult } from './textFormats';

const enc = (s: string) => new TextEncoder().encode(s);
const x = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const EMU = 12700; // per point
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function structureNotes(pages: PageStructure[]): string[] {
  const notes: string[] = [];
  const empty = pages.filter((p) => !p.items.some((i) => i.str.trim())).map((p) => p.pageNumber);
  if (empty.length) notes.push(`No text on page${empty.length > 1 ? 's' : ''} ${empty.join(', ')}: scanned pages need OCR first.`);
  const skipped = pages.reduce((n, p) => n + p.skippedImages, 0);
  if (skipped) notes.push(`${skipped} image(s) in unsupported formats were left out.`);
  return notes;
}

// ---- Word ---------------------------------------------------------------------------------------

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const HEADING_SIZES = [32, 26, 24, 22, 20, 20];
const docxStyles = () => `${XML}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>`
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
  + HEADING_SIZES.map((sz, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`).join('')
  + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style>'
  + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>'
  + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`).join('')
  + '</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>';
function docxNumbering(orderedLists: number): string {
  const level = (fmt: string, text: string) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
  let nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
  for (let i = 0; i < orderedLists; i++) nums += `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;
  return `${XML}<w:numbering ${W}><w:abstractNum w:abstractNumId="0">${level('bullet', '•')}</w:abstractNum><w:abstractNum w:abstractNumId="1">${level('decimal', '%1.')}</w:abstractNum>${nums}</w:numbering>`;
}
const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${x(text)}</w:t></w:r>`;

export function pdfToDocx(pages: PageStructure[], title: string): ConversionResult {
  const sizes = documentHeadingSizes(pages);
  const media: Record<string, Uint8Array> = {}; const rels: string[] = [];
  let ordered = 0, imageId = 0, tables = 0, lists = 0, headings = 0;
  const body: string[] = [];
  const first = pages[0];
  const textWidth = (first ? first.width : 612) - 144; // points inside 1-inch margins
  pages.forEach((page, pageIndex) => {
    // A new PDF page starts on a new Word page (page break before its first paragraph, no empty paragraph).
    let breakBefore = pageIndex > 0;
    const pPr = (inner = '') => { const props = `${breakBefore ? '<w:pageBreakBefore/>' : ''}${inner}`; breakBefore = false; return props ? `<w:pPr>${props}</w:pPr>` : ''; };
    for (const block of blocksOf(page, sizes) as Block[]) {
      if (block.kind === 'heading') { headings++; body.push(`<w:p>${pPr(`<w:pStyle w:val="Heading${block.level}"/>`)}${run(block.text)}</w:p>`); }
      else if (block.kind === 'paragraph') body.push(`<w:p>${pPr()}${run(block.text, `${block.bold ? '<w:b/>' : ''}${block.italic ? '<w:i/>' : ''}<w:sz w:val="${Math.round(block.size * 2)}"/>`)}</w:p>`);
      else if (block.kind === 'list') {
        lists++;
        const numId = block.ordered ? 2 + ordered++ : 1;
        for (const item of block.items) body.push(`<w:p>${pPr(`<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`)}${run(item)}</w:p>`);
      } else if (block.kind === 'table') {
        tables++;
        if (breakBefore) body.push(`<w:p>${pPr()}</w:p>`);
        const cols = Math.max(...block.rows.map((r) => r.length));
        const width = Math.round((textWidth * 20) / cols);
        body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${width * cols}" w:type="dxa"/></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(cols)}</w:tblGrid>`
          + block.rows.map((row, r) => `<w:tr>${Array.from({ length: cols }, (_, c) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p>${row[c] ? run(row[c], r === 0 ? '<w:b/>' : '') : ''}</w:p></w:tc>`).join('')}</w:tr>`).join('')
          + '</w:tbl>');
      } else {
        const image = page.images[block.index];
        const id = ++imageId;
        media[`word/media/image${id}.png`] = encodePng(image.image);
        rels.push(`<Relationship Id="rIdImg${id}" Type="${officeRel}image" Target="media/image${id}.png"/>`);
        const scale = Math.min(1, textWidth / Math.max(1, image.width));
        const [cx, cy] = [Math.round(image.width * scale * EMU), Math.round(image.height * scale * EMU)];
        body.push(`<w:p>${pPr()}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="Page ${page.pageNumber} image ${block.index + 1}"/>`
          + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
          + `<pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
          + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
      }
    }
  });
  const [pw, ph] = first ? [first.width, first.height] : [612, 792];
  // A body must not end with a table.
  if (body.length && body[body.length - 1].endsWith('</w:tbl>')) body.push('<w:p></w:p>');
  const document = `${XML}<w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="${Math.round(pw * 20)}" w:h="${Math.round(ph * 20)}"${pw > ph ? ' w:orient="landscape"' : ''}/>`
    + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': enc(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'),
    '_rels/.rels': enc(`${XML}<Relationships xmlns="${relsNS}"><Relationship Id="rId1" Type="${officeRel}officeDocument" Target="word/document.xml"/>`
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    'docProps/core.xml': enc(`${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(title)}</dc:title><dc:creator>MALENJO</dc:creator></cp:coreProperties>`),
    'word/document.xml': enc(document),
    'word/styles.xml': enc(docxStyles()),
    'word/numbering.xml': enc(docxNumbering(ordered)),
    'word/_rels/document.xml.rels': enc(`${XML}<Relationships xmlns="${relsNS}"><Relationship Id="rIdStyles" Type="${officeRel}styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="${officeRel}numbering" Target="numbering.xml"/>${rels.join('')}</Relationships>`),
    ...media,
  };
  const notes = [`Rebuilt ${headings} heading(s), ${lists} list(s), ${tables} table(s) and ${imageId} image(s) from the page layout; text flows in Word instead of keeping exact positions.`,
    'Fonts are set to Arial with the original sizes, bold and italic.', ...structureNotes(pages)];
  if (pages.some((p) => Math.abs(p.width - pw) > 1 || Math.abs(p.height - ph) > 1)) notes.push('Pages of different sizes use the first page\'s size.');
  return { files: [{ name: `${title}.docx`, bytes: zipSync(files, { level: 6 }), mime: DOCX }], notes };
}

// ---- PowerPoint ---------------------------------------------------------------------------------

/** Rectangles drawn on a page (fill and/or outline), as fractions of the page as shown. */
function pageRectangles(pdf: PDFDocument | null, pageNumber: number) {
  if (!pdf) return { rects: [], other: 0 };
  const model = readPageModel(pdf, pageNumber - 1);
  const frame = frameOf(pdf, pageNumber, 0);
  const rects: { shown: { x: number; y: number; width: number; height: number }; fill: string | null; stroke: string | null; width: number }[] = [];
  let other = 0;
  for (const path of model.paths) {
    const ops = model.ops.slice(path.startIndex, path.endIndex);
    const rotated = Math.abs(path.ctm[1]) > 1e-6 || Math.abs(path.ctm[2]) > 1e-6;
    // A rectangle is either `re`, or a closed four-corner path (m l l l [l] h) on the box corners.
    const names = ops.map((o) => o.op).join(' ');
    const onCorners = ops.every((o) => {
      if (o.op === 'h') return true;
      const [u, v] = o.operands.map((n) => (n.type === 'number' ? n.value : NaN));
      const [px, py] = [path.ctm[0] * u + path.ctm[2] * v + path.ctm[4], path.ctm[1] * u + path.ctm[3] * v + path.ctm[5]];
      return [path.box[0], path.box[2]].some((c) => Math.abs(c - px) < 0.01) && [path.box[1], path.box[3]].some((c) => Math.abs(c - py) < 0.01);
    });
    if (rotated || !(names === 're' || (/^m l l l( l)? h$/.test(names) && onCorners))) { other++; continue; }
    rects.push({ shown: frame.toShown(path.box), fill: /^[fFbB]/.test(path.paint) ? path.fill : null, stroke: /^[sSbB]/.test(path.paint) ? path.stroke : null, width: path.lineWidth * Math.abs(path.ctm[0]) });
  }
  return { rects, other };
}
const hex = (c: string) => c.replace('#', '').toUpperCase();

export async function pdfToPptx(pages: PageStructure[], pdfBytes: Uint8Array | null, title: string): Promise<ConversionResult> {
  if (!pages.length) throw new Error('Choose at least one page.');
  if (pages.length > 200) throw new Error('PowerPoint export handles up to 200 pages at a time.');
  let pdf: PDFDocument | null = null;
  try { pdf = pdfBytes ? await PDFDocument.load(pdfBytes, { updateMetadata: false }) : null; } catch { pdf = null; }
  const [cx, cy] = [Math.round(pages[0].width * EMU), Math.round(pages[0].height * EMU)];
  const files: Record<string, Uint8Array> = {};
  let otherShapes = 0, imageCount = 0, boxes = 0;
  pages.forEach((page, index) => {
    const n = index + 1;
    const sx = cx / page.width, sy = cy / page.height;
    const shapes: string[] = []; const rels: string[] = [`<Relationship Id="rIdLayout" Type="${officeRel}slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
    let id = 2;
    const xfrm = (l: number, t: number, w: number, h: number) => `<a:xfrm><a:off x="${Math.round(l * sx)}" y="${Math.round(t * sy)}"/><a:ext cx="${Math.max(1, Math.round(w * sx))}" cy="${Math.max(1, Math.round(h * sy))}"/></a:xfrm>`;
    const { rects, other } = pdf ? pageRectangles(pdf, page.pageNumber) : { rects: [], other: 0 };
    otherShapes += other;
    for (const rect of rects) {
      const fill = rect.fill ? `<a:solidFill><a:srgbClr val="${hex(rect.fill)}"/></a:solidFill>` : '<a:noFill/>';
      const line = rect.stroke ? `<a:ln w="${Math.round(rect.width * EMU)}"><a:solidFill><a:srgbClr val="${hex(rect.stroke)}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
      shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Rectangle ${id++}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(rect.shown.x * page.width, rect.shown.y * page.height, rect.shown.width * page.width, rect.shown.height * page.height)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr></p:sp>`);
    }
    page.images.forEach((image, k) => {
      imageCount++;
      const name = `image${n}-${k + 1}.png`;
      files[`ppt/media/${name}`] = encodePng(image.image);
      rels.push(`<Relationship Id="rIdImg${k + 1}" Type="${officeRel}image" Target="../media/${name}"/>`);
      shapes.push(`<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id++}" descr="Page ${page.pageNumber} image ${k + 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
        + `<p:blipFill><a:blip r:embed="rIdImg${k + 1}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(image.x, image.y, image.width, image.height)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
    });
    // Text boxes: consecutive lines that share a left edge and size become one box.
    const groups: ReturnType<typeof linesOf>[] = [];
    for (const line of linesOf(page)) {
      const last = groups[groups.length - 1]?.at(-1);
      if (last && Math.abs(last.x - line.x) < 2 && Math.abs(last.size - line.size) < 0.6 && line.y - last.y < line.size * 1.7 && last.cells.length === 1 && line.cells.length === 1) groups[groups.length - 1].push(line);
      else groups.push([line]);
    }
    for (const group of groups) {
      boxes++;
      const left = Math.min(...group.map((l) => l.x)), right = Math.max(...group.map((l) => l.end));
      const top = group[0].y - group[0].size * 0.95, bottom = group[group.length - 1].y + group[group.length - 1].size * 0.3;
      const paras = group.map((l) => `<a:p>${l.cells.map((c, i) => `<a:r><a:rPr lang="en-US" sz="${Math.round(l.size * 100)}"${c.bold ? ' b="1"' : ''}${c.italic ? ' i="1"' : ''} dirty="0"><a:latin typeface="Arial"/></a:rPr><a:t>${x((i ? '\t' : '') + c.text)}</a:t></a:r>`).join('')}</a:p>`).join('');
      shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id++}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(left, top, Math.max(right - left, 4) * 1.06, bottom - top)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
        + `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`);
    }
    files[`ppt/slides/slide${n}.xml`] = enc(`${XML}<p:sld ${ns}><p:cSld><p:spTree>${spTree}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = enc(`${XML}<Relationships xmlns="${relsNS}">${rels.join('')}</Relationships>`);
  });
  const count = pages.length;
  files['[Content_Types].xml'] = enc(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>`
    + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
    + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
    + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + Array.from({ length: count }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') + '</Types>');
  files['_rels/.rels'] = enc(`${XML}<Relationships xmlns="${relsNS}"><Relationship Id="rId1" Type="${officeRel}officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  files['ppt/presentation.xml'] = enc(`${XML}<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>`
    + Array.from({ length: count }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('') + `</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="${cy}" cy="${cx}"/></p:presentation>`);
  files['ppt/_rels/presentation.xml.rels'] = enc(`${XML}<Relationships xmlns="${relsNS}"><Relationship Id="rId1" Type="${officeRel}slideMaster" Target="slideMasters/slideMaster1.xml"/>`
    + Array.from({ length: count }, (_, i) => `<Relationship Id="rId${i + 2}" Type="${officeRel}slide" Target="slides/slide${i + 1}.xml"/>`).join('') + '</Relationships>');
  files['ppt/slideMasters/slideMaster1.xml'] = enc(master);
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = enc(`<Relationships xmlns="${relsNS}"><Relationship Id="rId1" Type="${officeRel}slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${officeRel}theme" Target="../theme/theme1.xml"/></Relationships>`);
  files['ppt/slideLayouts/slideLayout1.xml'] = enc(layout);
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = enc(`<Relationships xmlns="${relsNS}"><Relationship Id="rId1" Type="${officeRel}slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  files['ppt/theme/theme1.xml'] = enc(theme);
  const notes = [`${count} slide(s) at the page size with ${boxes} editable text box(es) and ${imageCount} picture(s).`, 'Text uses Arial at the original size; line breaks inside paragraphs are kept as separate lines.', ...structureNotes(pages)];
  if (otherShapes) notes.push(`${otherShapes} drawing(s) other than rectangles (lines, curves) were not rebuilt as shapes.`);
  if (pages.some((p) => Math.abs(p.width - pages[0].width) > 1 || Math.abs(p.height - pages[0].height) > 1)) notes.push('Pages of different sizes are scaled to the first page\'s slide size.');
  return { files: [{ name: `${title}.pptx`, bytes: zipSync(files, { level: 6 }), mime: PPTX }], notes };
}

// ---- Excel --------------------------------------------------------------------------------------

const colName = (i: number) => { let s = ''; for (let v = i + 1; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(65 + ((v - 1) % 26)) + s; return s; };
const NUMBER = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

/**
 * A table value is written as a number only when that loses nothing: identifiers with leading zeros
 * (001234) and numbers with more significant digits than a spreadsheet keeps (about 15, so long account
 * numbers) stay text.
 */
function losslessNumber(value: string): boolean {
  if (!NUMBER.test(value)) return false;
  const clean = value.replace(/,/g, '').replace(/^-/, '');
  if (/^0\d/.test(clean)) return false;
  return clean.replace('.', '').replace(/^0+/, '').length <= 15;
}

export function pdfToXlsx(pages: PageStructure[], title: string): ConversionResult {
  const sheets: { name: string; rows: string[][] }[] = [];
  const sizes = documentHeadingSizes(pages);
  const fallback: number[] = [];
  for (const page of pages) {
    const tables = blocksOf({ ...page, images: [] }, sizes).filter((b): b is Extract<Block, { kind: 'table' }> => b.kind === 'table');
    tables.forEach((t, k) => sheets.push({ name: `Page ${page.pageNumber} table ${k + 1}`, rows: t.rows }));
    if (!tables.length) {
      const lines = linesOf(page);
      if (lines.length) { fallback.push(page.pageNumber); sheets.push({ name: `Page ${page.pageNumber}`, rows: lines.map((l) => l.cells.map((c) => c.text)) }); }
    }
  }
  if (!sheets.length) throw new Error('These pages have no text or tables to put in a spreadsheet. Run OCR on scanned pages first.');
  if (sheets.length > 64) throw new Error('More than 64 tables were found; convert fewer pages at a time.');
  const files: Record<string, Uint8Array> = {};
  sheets.forEach((sheet, i) => {
    const cols = Math.max(1, ...sheet.rows.map((r) => r.length));
    const widths = Array.from({ length: cols }, (_, c) => Math.min(60, Math.max(8, ...sheet.rows.map((r) => (r[c] ?? '').length + 2))));
    const rows = sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      const ref = `${colName(c)}${r + 1}`;
      const style = r === 0 && !fallback.length ? ' s="1"' : '';
      if (value && r > 0 && losslessNumber(value)) return `<c r="${ref}"${style}><v>${Number(value.replace(/,/g, ''))}</v></c>`;
      return value ? `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${x(value)}</t></is></c>` : '';
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = enc(`${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData></worksheet>`);
  });
  const names = new Set<string>();
  const safe = sheets.map((s) => { let name = s.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31); for (let k = 2; names.has(name); k++) name = `${s.name.slice(0, 27)} (${k})`; names.add(name); return name; });
  files['[Content_Types].xml'] = enc(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>');
  files['_rels/.rels'] = enc(`${XML}<Relationships xmlns="${relsNS}"><Relationship Id="rId1" Type="${officeRel}officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files['xl/workbook.xml'] = enc(`${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`
    + safe.map((name, i) => `<sheet name="${x(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>');
  files['xl/_rels/workbook.xml.rels'] = enc(`${XML}<Relationships xmlns="${relsNS}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${officeRel}worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="${officeRel}styles" Target="styles.xml"/></Relationships>`);
  files['xl/styles.xml'] = enc(`${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>`
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>');
  const tableCount = sheets.length - fallback.length;
  const notes = [`${tableCount} table(s) found, one sheet each; numbers are stored as numbers and the first row is bold.`];
  if (fallback.length) notes.push(`No table on page${fallback.length > 1 ? 's' : ''} ${fallback.join(', ')}: their lines are on their own sheet, split into columns at wide gaps.`);
  notes.push(...structureNotes(pages).filter((n) => !n.includes('image')));
  return { files: [{ name: `${title}.xlsx`, bytes: zipSync(files, { level: 6 }), mime: XLSX }], notes };
}
