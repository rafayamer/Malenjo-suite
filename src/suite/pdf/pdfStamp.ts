/**
 * Page stamping for MAL-017 (headers and footers), MAL-018 (page numbering),
 * MAL-019 (text watermarks) and MAL-020 (image watermarks).
 *
 * Every stamp is placed in the page's *visible* frame: inside the crop box
 * and upright as the reader shows the page, whatever its /Rotate. Stamps are
 * real PDF text or image XObjects in their own content stream; "below" puts
 * that stream before the page content (under it), "above" after the page
 * content, which is wrapped in q/Q so its graphics state cannot leak.
 */
import {
  PDFArray, PDFDocument, PDFFont, PDFImage, PDFName, PDFOperator, PDFRef, StandardFonts,
  beginText, concatTransformationMatrix, drawObject, endText, moveText, popGraphicsState,
  pushGraphicsState, setFillingRgbColor, setFontAndSize, setGraphicsState, showText,
} from 'pdf-lib';
import { listPdfPageLabelRanges, type PdfPageLabelRange } from './pageLabels';
import { parsePageRanges } from './pdfSplitModes';
import { refuseSignedPdf } from './pdfSignatureGuard';

export type StampFont = 'helvetica' | 'helvetica-bold' | 'times' | 'times-bold' | 'courier';
export type StampPosition = 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type StampLayer = 'above' | 'below';
export type NumberFormat = 'arabic' | 'roman-lower' | 'roman-upper' | 'alpha-lower' | 'alpha-upper';
/** Pages to stamp: "all" or ranges like 1-3, 5, 8-; skipFirst leaves page 1 unstamped (e.g. a cover). */
export interface StampScope { pages: string; skipFirst: boolean }
export interface StampText { font: StampFont; size: number; color: string }

export const STAMP_MAX_INPUT_BYTES = 128 * 1024 * 1024;
const FONTS: Record<StampFont, StandardFonts> = {
  helvetica: StandardFonts.Helvetica, 'helvetica-bold': StandardFonts.HelveticaBold,
  times: StandardFonts.TimesRoman, 'times-bold': StandardFonts.TimesRomanBold, courier: StandardFonts.Courier,
};

export type Matrix = [number, number, number, number, number, number];
export const compose = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

// ---- formatting ----
export function formatNumber(value: number, format: NumberFormat): string {
  if (format === 'arabic') return String(value);
  if (format.startsWith('roman')) {
    if (value < 1 || value > 3999) return String(value);
    const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let rest = value; let out = '';
    for (const [n, s] of table) while (rest >= n) { out += s; rest -= n; }
    return format === 'roman-lower' ? out.toLowerCase() : out;
  }
  if (value < 1) return String(value);
  // PDF page-label letters: A..Z, then AA..ZZ, AAA...
  const letter = String.fromCharCode(65 + ((value - 1) % 26)).repeat(Math.floor((value - 1) / 26) + 1);
  return format === 'alpha-lower' ? letter.toLowerCase() : letter;
}

export function labelFor(page: number, ranges: PdfPageLabelRange[]): string {
  const range = [...ranges].reverse().find((item) => item.startPage <= page);
  if (!range) return String(page);
  const n = range.startNumber + page - range.startPage;
  const style: Record<PdfPageLabelRange['style'], NumberFormat | null> = { D: 'arabic', R: 'roman-upper', r: 'roman-lower', A: 'alpha-upper', a: 'alpha-lower', none: null };
  const format = style[range.style];
  return range.prefix + (format ? formatNumber(n, format) : '');
}

export function parseColor(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error('Choose a colour like #336699.');
  const value = parseInt(match[1], 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export function scopePages(scope: StampScope, pageCount: number): number[] {
  const text = scope.pages.trim();
  const pages = !text || /^all$/i.test(text)
    ? Array.from({ length: pageCount }, (_, i) => i + 1)
    : [...new Set(parsePageRanges(text, pageCount).flat())].sort((a, b) => a - b);
  const chosen = scope.skipFirst ? pages.filter((page) => page !== 1) : pages;
  if (!chosen.length) throw new Error('No pages are left to stamp with this page selection.');
  return chosen;
}

// ---- document plumbing ----
async function loadForStamp(bytes: Uint8Array): Promise<PDFDocument> {
  let pdf0: PDFDocument;
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > STAMP_MAX_INPUT_BYTES) {
    throw new Error('Stamping accepts PDFs up to 128 MB.');
  }
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() < 1) throw new Error('no pages');
    pdf0 = pdf;
  } catch { throw new Error('This PDF could not be stamped because it is encrypted, invalid or damaged.'); }
  refuseSignedPdf(pdf0, 'stamping it');
  return pdf0;
}

/**
 * Visible size and the matrix from that upright frame into page space.
 * extraRotation adds a viewing rotation (clockwise) on top of the page's /Rotate.
 */
export function viewerFrame(pdf: PDFDocument, index: number, extraRotation = 0): { width: number; height: number; matrix: Matrix } {
  const page = pdf.getPage(index);
  const { x, y, width, height } = page.getCropBox();
  const rotation = ((((page.getRotation().angle + extraRotation) % 360) + 360) % 360);
  if (rotation === 90) return { width: height, height: width, matrix: [0, 1, -1, 0, x + width, y] };
  if (rotation === 180) return { width, height, matrix: [-1, 0, 0, -1, x + width, y + height] };
  if (rotation === 270) return { width: height, height: width, matrix: [0, -1, 1, 0, x, y + height] };
  return { width, height, matrix: [1, 0, 0, 1, x, y] };
}

interface Placement { position: StampPosition; marginX: number; marginY: number; rotation: number; opacity: number }

/** Matrix taking an item's local box (0..w, 0..h) to its place in the upright frame. */
function placeItem(frame: { width: number; height: number }, w: number, h: number, place: Placement): Matrix {
  const theta = (place.rotation * Math.PI) / 180;
  const cos = Math.cos(theta); const sin = Math.sin(theta);
  const rw = Math.abs(w * cos) + Math.abs(h * sin);
  const rh = Math.abs(w * sin) + Math.abs(h * cos);
  const [vertical, horizontal] = place.position === 'center' ? ['middle', 'center'] : place.position.split('-');
  const cx = horizontal === 'left' ? place.marginX + rw / 2 : horizontal === 'right' ? frame.width - place.marginX - rw / 2 : frame.width / 2;
  const cy = vertical === 'bottom' ? place.marginY + rh / 2 : vertical === 'top' ? frame.height - place.marginY - rh / 2 : frame.height / 2;
  return compose([1, 0, 0, 1, cx, cy], compose([cos, sin, -sin, cos, 0, 0], [1, 0, 0, 1, -w / 2, -h / 2]));
}

class PageStamper {
  private ops: PDFOperator[] = [];
  constructor(private pdf: PDFDocument, private index: number) {}
  get frame() { return viewerFrame(this.pdf, this.index); }

  private opacity(value: number): PDFOperator[] {
    if (value >= 1) return [];
    const name = this.pdf.getPage(this.index).node.newExtGState('MalenjoGS',
      this.pdf.context.obj({ Type: 'ExtGState', ca: value, CA: value }));
    return [setGraphicsState(name)];
  }

  text(text: string, font: PDFFont, style: StampText, place: Placement): void {
    if (!text) return;
    let encoded;
    try { encoded = font.encodeText(text); }
    catch { throw new Error(`“${text.slice(0, 40)}” contains characters the built-in fonts cannot show. Use Latin letters, digits and common punctuation.`); }
    const width = font.widthOfTextAtSize(text, style.size);
    const height = font.heightAtSize(style.size);
    const baseline = height - font.heightAtSize(style.size, { descender: false });
    const frame = this.frame;
    const m = compose(frame.matrix, placeItem(frame, width, height, place));
    const fontName = this.pdf.getPage(this.index).node.newFontDictionary('MalenjoF', font.ref);
    this.ops.push(pushGraphicsState(), ...this.opacity(place.opacity), concatTransformationMatrix(...m),
      setFillingRgbColor(...parseColor(style.color)), beginText(), setFontAndSize(fontName, style.size),
      moveText(0, baseline), showText(encoded), endText(), popGraphicsState());
  }

  image(image: PDFImage, width: number, place: Placement): void {
    const height = width * (image.height / image.width);
    const frame = this.frame;
    const m = compose(frame.matrix, compose(placeItem(frame, width, height, place), [width, 0, 0, height, 0, 0]));
    const name = this.pdf.getPage(this.index).node.newXObject('MalenjoIm', image.ref);
    this.ops.push(pushGraphicsState(), ...this.opacity(place.opacity), concatTransformationMatrix(...m), drawObject(name), popGraphicsState());
  }

  commit(layer: StampLayer): void {
    if (!this.ops.length) return;
    const { context } = this.pdf;
    const node = this.pdf.getPage(this.index).node;
    const ours = context.register(context.contentStream(this.ops));
    // /Contents may be an indirect reference to an array of streams: resolve it before splicing.
    const direct = node.get(PDFName.of('Contents'));
    const resolved = direct instanceof PDFRef ? context.lookup(direct) : direct;
    const raw = resolved instanceof PDFArray ? resolved : direct;
    const existing = raw instanceof PDFArray ? raw.asArray() : raw ? [raw] : [];
    const contents = layer === 'below'
      ? [ours, ...existing]
      : [context.register(context.contentStream([pushGraphicsState()])), ...existing,
        context.register(context.contentStream([popGraphicsState()])), ours];
    node.set(PDFName.of('Contents'), context.obj(contents as PDFRef[]));
  }
}

async function save(pdf: PDFDocument): Promise<Uint8Array> {
  return Uint8Array.from(await pdf.save({ useObjectStreams: false }));
}

function checkText(style: StampText, label: string): void {
  if (!FONTS[style.font]) throw new Error('Choose one of the listed fonts.');
  if (!(style.size >= 4 && style.size <= 400)) throw new Error(`${label} size must be between 4 and 400 points.`);
  parseColor(style.color);
}
function checkMargins(x: number, y: number): void {
  if (!(x >= 0 && x <= 300) || !(y >= 0 && y <= 300)) throw new Error('Margins must be between 0 and 300 points.');
}

// ---- MAL-017 headers and footers ----
export interface HeaderFooterSpec {
  header: { left: string; center: string; right: string };
  footer: { left: string; center: string; right: string };
  text: StampText;
  marginX: number;
  marginY: number;
  scope: StampScope;
  /** Values for {file}; {date} and {time} use `now`. */
  fileName: string;
  now: Date;
}

const FIELDS = ['page', 'pages', 'label', 'file', 'title', 'author', 'subject', 'date', 'time'] as const;

export function fillTemplate(template: string, values: Record<(typeof FIELDS)[number], string>): string {
  return template.replace(/\{([a-z]+)\}/gi, (whole, key: string) => {
    const field = key.toLowerCase() as (typeof FIELDS)[number];
    if (!FIELDS.includes(field)) throw new Error(`${whole} is not a known field. Use ${FIELDS.map((f) => `{${f}}`).join(', ')}.`);
    return values[field];
  }).replace(/[\u0000-\u001F]/g, ' ').slice(0, 300);
}

export async function applyHeaderFooter(bytes: Uint8Array, spec: HeaderFooterSpec): Promise<{ bytes: Uint8Array; pages: number }> {
  checkText(spec.text, 'Header and footer text');
  checkMargins(spec.marginX, spec.marginY);
  const slots = [...Object.values(spec.header), ...Object.values(spec.footer)];
  if (!slots.some((slot) => slot.trim())) throw new Error('Enter text for at least one header or footer position.');
  const pdf = await loadForStamp(bytes);
  const pageCount = pdf.getPageCount();
  const pages = scopePages(spec.scope, pageCount);
  let labels: PdfPageLabelRange[] = [];
  try { labels = await listPdfPageLabelRanges(bytes); } catch { labels = []; }
  const font = await pdf.embedFont(FONTS[spec.text.font]);
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = {
    pages: String(pageCount), file: spec.fileName.replace(/^.*[\\/]/, ''),
    title: pdf.getTitle() ?? '', author: pdf.getAuthor() ?? '', subject: pdf.getSubject() ?? '',
    date: `${spec.now.getFullYear()}-${pad(spec.now.getMonth() + 1)}-${pad(spec.now.getDate())}`,
    time: `${pad(spec.now.getHours())}:${pad(spec.now.getMinutes())}`,
  };
  for (const page of pages) {
    const values = { ...base, page: String(page), label: labelFor(page, labels) };
    const stamper = new PageStamper(pdf, page - 1);
    for (const [row, slotsInRow] of [['top', spec.header], ['bottom', spec.footer]] as const) {
      for (const column of ['left', 'center', 'right'] as const) {
        const text = fillTemplate(slotsInRow[column].trim(), values).trim();
        stamper.text(text, font, spec.text, { position: `${row}-${column}`, marginX: spec.marginX, marginY: spec.marginY, rotation: 0, opacity: 1 });
      }
    }
    stamper.commit('above');
  }
  return { bytes: await save(pdf), pages: pages.length };
}

// ---- MAL-018 page numbers ----
export interface PageNumberSpec {
  format: NumberFormat;
  prefix: string;
  suffix: string;
  start: number;
  /** Append " of N" (N = last number shown, in the same format). */
  showTotal: boolean;
  position: Exclude<StampPosition, 'middle-left' | 'center' | 'middle-right'>;
  marginX: number;
  marginY: number;
  text: StampText;
  scope: StampScope;
}

export async function applyPageNumbers(bytes: Uint8Array, spec: PageNumberSpec): Promise<{ bytes: Uint8Array; pages: number; first: string; last: string }> {
  checkText(spec.text, 'Page number');
  checkMargins(spec.marginX, spec.marginY);
  if (!Number.isSafeInteger(spec.start) || spec.start < 0 || spec.start > 1_000_000) throw new Error('Start number must be a whole number from 0 to 1,000,000.');
  if (spec.prefix.length > 80 || spec.suffix.length > 80) throw new Error('Prefix and suffix must be 80 characters or shorter.');
  const pdf = await loadForStamp(bytes);
  const pages = scopePages(spec.scope, pdf.getPageCount());
  const font = await pdf.embedFont(FONTS[spec.text.font]);
  const total = formatNumber(spec.start + pages.length - 1, spec.format);
  const labels = pages.map((_, i) => `${spec.prefix}${formatNumber(spec.start + i, spec.format)}${spec.showTotal ? ` of ${total}` : ''}${spec.suffix}`);
  pages.forEach((page, i) => {
    const stamper = new PageStamper(pdf, page - 1);
    stamper.text(labels[i], font, spec.text, { position: spec.position, marginX: spec.marginX, marginY: spec.marginY, rotation: 0, opacity: 1 });
    stamper.commit('above');
  });
  return { bytes: await save(pdf), pages: pages.length, first: labels[0], last: labels[labels.length - 1] };
}

// ---- MAL-019 / MAL-020 watermarks ----
interface WatermarkCommon { position: StampPosition; margin: number; rotation: number; opacity: number; layer: StampLayer; scope: StampScope }
export interface TextWatermarkSpec extends WatermarkCommon { text: string; style: StampText }
export interface ImageWatermarkSpec extends WatermarkCommon {
  image: Uint8Array;
  /** Width as a percentage of each page's visible width. */
  scalePercent: number;
}

function checkWatermark(spec: WatermarkCommon): void {
  if (!(spec.opacity >= 0.05 && spec.opacity <= 1)) throw new Error('Opacity must be between 5% and 100%.');
  if (!(spec.rotation >= -180 && spec.rotation <= 180)) throw new Error('Rotation must be between -180° and 180°.');
  checkMargins(spec.margin, spec.margin);
  if (spec.layer !== 'above' && spec.layer !== 'below') throw new Error('Choose above or below the page content.');
}

export async function applyTextWatermark(bytes: Uint8Array, spec: TextWatermarkSpec): Promise<{ bytes: Uint8Array; pages: number }> {
  checkWatermark(spec);
  checkText(spec.style, 'Watermark');
  const text = spec.text.replace(/[\u0000-\u001F]/g, ' ').trim();
  if (!text || text.length > 200) throw new Error('Enter watermark text of up to 200 characters.');
  const pdf = await loadForStamp(bytes);
  const pages = scopePages(spec.scope, pdf.getPageCount());
  const font = await pdf.embedFont(FONTS[spec.style.font]);
  for (const page of pages) {
    const stamper = new PageStamper(pdf, page - 1);
    stamper.text(text, font, spec.style, { position: spec.position, marginX: spec.margin, marginY: spec.margin, rotation: spec.rotation, opacity: spec.opacity });
    stamper.commit(spec.layer);
  }
  return { bytes: await save(pdf), pages: pages.length };
}

export async function applyImageWatermark(bytes: Uint8Array, spec: ImageWatermarkSpec): Promise<{ bytes: Uint8Array; pages: number }> {
  checkWatermark(spec);
  if (!(spec.scalePercent >= 5 && spec.scalePercent <= 100)) throw new Error('Image width must be between 5% and 100% of the page width.');
  const image = spec.image;
  const png = image.length > 8 && image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47;
  const jpeg = image.length > 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  if (!png && !jpeg) throw new Error('Choose a PNG or JPEG image for the watermark.');
  if (image.length > 20 * 1024 * 1024) throw new Error('Watermark images must be 20 MB or smaller.');
  const pdf = await loadForStamp(bytes);
  const pages = scopePages(spec.scope, pdf.getPageCount());
  let embedded: PDFImage;
  try { embedded = png ? await pdf.embedPng(image) : await pdf.embedJpg(image); }
  catch { throw new Error('This image could not be read. Choose another PNG or JPEG file.'); }
  for (const page of pages) {
    const stamper = new PageStamper(pdf, page - 1);
    stamper.image(embedded, (stamper.frame.width * spec.scalePercent) / 100,
      { position: spec.position, marginX: spec.margin, marginY: spec.margin, rotation: spec.rotation, opacity: spec.opacity });
    stamper.commit(spec.layer);
  }
  return { bytes: await save(pdf), pages: pages.length };
}
