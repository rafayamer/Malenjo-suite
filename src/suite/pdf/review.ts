import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString,
} from 'pdf-lib';

/**
 * PDF-native review annotations. Mutations must use the caller's per-tab history.
 * Ref-based identity prevents a stale selection from changing another item.
 */
export type PdfReviewKind = 'Text' | 'Highlight' | 'Underline' | 'StrikeOut';
export interface PdfReviewItem {
  pageNumber: number;
  index: number;
  ref: string | null;
  kind: PdfReviewKind;
  author: string;
  text: string;
  resolved: boolean;
}
export type PdfReviewTarget = Pick<PdfReviewItem, 'pageNumber' | 'index' | 'ref' | 'kind'>;
export interface PdfRegionMarkup {
  pageNumber: number;
  kind: Exclude<PdfReviewKind, 'Text'>;
  x: number;
  y: number;
  width: number;
  height: number;
  author?: string;
  text?: string;
}

const annotsKey = PDFName.of('Annots');
const kindKey = PDFName.of('Subtype');
const contentsKey = PDFName.of('Contents');
const authorKey = PDFName.of('T');
const stateKey = PDFName.of('State');
const stateModelKey = PDFName.of('StateModel');
const allowedKinds = new Set<PdfReviewKind>(['Text', 'Highlight', 'Underline', 'StrikeOut']);
export const PDF_REVIEW_PAGE_LIMIT = 2000;
export const PDF_REVIEW_ANNOTATION_LIMIT = 4000;

function decode(value: unknown): string {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : '';
}
function name(value: unknown): string {
  return value instanceof PDFName ? value.asString().replace(/^\//, '') : '';
}
function textInput(value: string, label: string, max: number, requireContent: boolean): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/.test(value)) {
    throw new Error(label + ' is invalid or exceeds ' + max + ' characters.');
  }
  if (requireContent && !value.trim()) throw new Error(label + ' must not be empty.');
  return value;
}

function getAnnotations(pdf: PDFDocument, pageNumber: number): PDFArray | undefined {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.getPageCount()) {
    throw new Error('Annotation page is outside this PDF.');
  }
  return pdf.getPage(pageNumber - 1).node.lookupMaybe(annotsKey, PDFArray);
}

function annotationAt(pdf: PDFDocument, target: PdfReviewTarget): {
  annots: PDFArray; dict: PDFDict;
} {
  const annots = getAnnotations(pdf, target.pageNumber);
  if (!annots || !Number.isSafeInteger(target.index) || target.index < 0 || target.index >= annots.size()) {
    throw new Error('Selected annotation no longer exists; refresh the review list.');
  }
  const entry = annots.get(target.index);
  if (!(entry instanceof PDFRef) || target.ref !== entry.toString()) {
    throw new Error('Annotation identity changed; refresh the review list.');
  }
  const dict = pdf.context.lookup(entry, PDFDict);
  const kind = name(dict.get(kindKey));
  if (kind !== target.kind || !allowedKinds.has(kind as PdfReviewKind)) {
    throw new Error('Annotation subtype changed; refresh the review list.');
  }
  return { annots, dict };
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (!bytes.byteLength) throw new Error('PDF bytes are empty.');
  return PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
}
async function save(pdf: PDFDocument): Promise<Uint8Array> {
  return Uint8Array.from(await pdf.save({ useObjectStreams: false }));
}

export async function listPdfReviewAnnotations(bytes: Uint8Array): Promise<PdfReviewItem[]> {
  const pdf = await load(bytes);
  if (pdf.getPageCount() > PDF_REVIEW_PAGE_LIMIT) {
    throw new Error('Review inventory supports at most ' + PDF_REVIEW_PAGE_LIMIT + ' pages; no partial list was returned.');
  }
  const items: PdfReviewItem[] = [];
  let totalEntries = 0;
  for (let pageNumber = 1; pageNumber <= pdf.getPageCount(); pageNumber += 1) {
    const annots = getAnnotations(pdf, pageNumber);
    if (!annots) continue;
    totalEntries += annots.size();
    if (totalEntries > PDF_REVIEW_ANNOTATION_LIMIT) {
      throw new Error('Review inventory exceeds ' + PDF_REVIEW_ANNOTATION_LIMIT + ' annotations; no partial list was returned.');
    }
    for (let index = 0; index < annots.size(); index += 1) {
      const object = annots.get(index);
      let dict: PDFDict;
      try {
        dict = pdf.context.lookup(object, PDFDict);
      } catch {
        continue; // Imported PDFs can contain invalid /Annots entries.
      }
      const kind = name(dict.get(kindKey));
      if (!allowedKinds.has(kind as PdfReviewKind)) continue;
      items.push({
        pageNumber,
        index,
        ref: object instanceof PDFRef ? object.toString() : null,
        kind: kind as PdfReviewKind,
        author: decode(dict.get(authorKey)),
        text: decode(dict.get(contentsKey)),
        resolved: name(dict.get(stateModelKey)) === 'Review' &&
          name(dict.get(stateKey)) === 'Completed',
      });
    }
  }
  return items;
}

export async function updatePdfReviewText(
  bytes: Uint8Array, target: PdfReviewTarget, nextText: string,
): Promise<Uint8Array> {
  const text = textInput(nextText, 'Annotation text', 4000, true);
  const pdf = await load(bytes);
  const { dict } = annotationAt(pdf, target);
  dict.set(contentsKey, PDFHexString.fromText(text));
  return save(pdf);
}

export async function setPdfReviewResolved(
  bytes: Uint8Array, target: PdfReviewTarget, resolved: boolean,
): Promise<Uint8Array> {
  if (typeof resolved !== 'boolean') throw new Error('Review status must be a boolean.');
  const pdf = await load(bytes);
  const { dict } = annotationAt(pdf, target);
  dict.set(stateModelKey, PDFName.of('Review'));
  dict.set(stateKey, PDFName.of(resolved ? 'Completed' : 'None'));
  return save(pdf);
}

export async function deletePdfReviewAnnotation(
  bytes: Uint8Array, target: PdfReviewTarget,
): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const { annots } = annotationAt(pdf, target);
  annots.remove(target.index);
  return save(pdf);
}

export async function addPdfRegionMarkup(
  bytes: Uint8Array, markup: PdfRegionMarkup,
): Promise<Uint8Array> {
  if (!['Highlight', 'Underline', 'StrikeOut'].includes(markup.kind)) {
    throw new Error('Unsupported region markup annotation.');
  }
  const vals = [markup.x, markup.y, markup.width, markup.height];
  if (vals.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
      markup.width <= 0 || markup.height <= 0 ||
      markup.x + markup.width > 1 || markup.y + markup.height > 1) {
    throw new Error('Markup rectangle must stay inside the PDF page.');
  }
  const author = textInput(markup.author ?? 'MALENJO User', 'Annotation author', 160, false);
  const description = textInput(markup.text ?? '', 'Annotation text', 4000, false);
  const pdf = await load(bytes);
  if (!Number.isSafeInteger(markup.pageNumber) || markup.pageNumber < 1 ||
      markup.pageNumber > pdf.getPageCount()) {
    throw new Error('Annotation page is outside this PDF.');
  }
  const page = pdf.getPage(markup.pageNumber - 1);
  const { width, height } = page.getSize();
  const x1 = markup.x * width, y1 = markup.y * height;
  const x2 = (markup.x + markup.width) * width, y2 = (markup.y + markup.height) * height;
  const annots = getAnnotations(pdf, markup.pageNumber) ?? pdf.context.obj([]);
  if (!page.node.has(annotsKey)) page.node.set(annotsKey, annots);
  // Standard PDF markup quad order: top-left, top-right, bottom-left, bottom-right.
  const annotation = pdf.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of(markup.kind),
    Rect: [x1, y1, x2, y2],
    QuadPoints: [x1, y2, x2, y2, x1, y1, x2, y1],
    Contents: PDFHexString.fromText(description),
    T: PDFHexString.fromText(author),
    C: markup.kind === 'Highlight' ? [1, 0.88, 0.2] : [0.85, 0.2, 0.2],
    F: 4,
  });
  annots.push(pdf.context.register(annotation));
  return save(pdf);
}
