/**
 * MAL-024 Lossless PDF compression. Only non-destructive optimizations:
 *  - streams stored without any filter are Flate-compressed (lossless);
 *  - byte-identical streams with identical dictionaries are merged;
 *  - objects that nothing references are removed;
 *  - the file is written with compressed object streams.
 * Decoded page content is compared before and after; any difference aborts
 * the operation, so the result is never returned unless it is equivalent.
 */
import { zlibSync } from 'fflate';
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream,
} from 'pdf-lib';

export const PDF_COMPRESS_MAX_INPUT_BYTES = 256 * 1024 * 1024;

export interface PdfCompressReport {
  bytes: Uint8Array;
  before: number;
  after: number;
  streamsCompressed: number;
  duplicatesMerged: number;
  unusedRemoved: number;
  /** True when no smaller equivalent file could be produced; bytes are the input. */
  unchanged: boolean;
}

export async function loadForCompression(bytes: Uint8Array): Promise<PDFDocument> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > PDF_COMPRESS_MAX_INPUT_BYTES) {
    throw new Error('Compression accepts PDFs up to 256 MB.');
  }
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() < 1) throw new Error('no pages');
  } catch { throw new Error('This PDF could not be compressed because it is encrypted, invalid or damaged.'); }
  if (pdf.catalog.has(PDFName.of('Perms'))) throw new Error('Certified PDFs cannot be rewritten without invalidating the certification.');
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && object.has(PDFName.of('ByteRange'))) {
      throw new Error('Signed PDFs cannot be rewritten without invalidating the signature.');
    }
  }
  return pdf;
}

/** Visits every value inside an object, replacing references through `map`. */
function remap(object: PDFObject, map: Map<string, PDFRef>): void {
  const dict = object instanceof PDFStream ? object.dict : object;
  if (dict instanceof PDFDict) {
    for (const [key, value] of dict.entries()) {
      if (value instanceof PDFRef) { const to = map.get(value.toString()); if (to) dict.set(key, to); } else remap(value, map);
    }
  } else if (dict instanceof PDFArray) {
    for (let i = 0; i < dict.size(); i++) {
      const value = dict.get(i);
      if (value instanceof PDFRef) { const to = map.get(value.toString()); if (to) dict.set(i, to); } else remap(value, map);
    }
  }
}

function references(object: PDFObject, out: PDFRef[]): void {
  const dict = object instanceof PDFStream ? object.dict : object;
  if (dict instanceof PDFDict) for (const [, value] of dict.entries()) value instanceof PDFRef ? out.push(value) : references(value, out);
  else if (dict instanceof PDFArray) for (const value of dict.asArray()) value instanceof PDFRef ? out.push(value) : references(value, out);
}

function dictKey(dict: PDFDict): string {
  return dict.entries().filter(([key]) => key.decodeText() !== 'Length').map(([key, value]) => `${key.decodeText()}=${value.toString()}`).sort().join('|');
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Decoded content of every page, for an equivalence check. */
export function pageContents(pdf: PDFDocument): string[] {
  return pdf.getPages().map((page) => {
    const raw = page.node.get(PDFName.of('Contents'));
    const refs = raw instanceof PDFArray ? raw.asArray() : raw ? [raw] : [];
    return refs.map((ref) => {
      const stream = pdf.context.lookup(ref);
      if (!(stream instanceof PDFStream)) return '';
      const data = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
      return Array.from(data, (b) => String.fromCharCode(b)).join('');
    }).join('\n');
  });
}

/** Applies the lossless passes to a loaded document (also used after image recompression). */
export async function optimizeLoaded(pdf: PDFDocument): Promise<{ streamsCompressed: number; duplicatesMerged: number; unusedRemoved: number }> {
  const { context } = pdf;
  let streamsCompressed = 0;
  // 1. Flate-compress streams that carry no filter at all.
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.has(PDFName.of('Filter')) || object.dict.has(PDFName.of('DecodeParms'))) continue;
    const type = object.dict.get(PDFName.of('Type'))?.toString();
    if (type === '/XRef' || type === '/ObjStm' || object.contents.length < 64) continue;
    const packed = zlibSync(object.contents, { level: 9 });
    if (packed.length >= object.contents.length) continue;
    const dict = object.dict.clone(context);
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    context.assign(ref, PDFRawStream.of(dict, packed));
    streamsCompressed++;
  }
  // 2. Merge byte-identical streams with identical dictionaries.
  const canonical = new Map<string, PDFRef>();
  const map = new Map<string, PDFRef>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const key = `${dictKey(object.dict)}#${await digest(object.contents)}`;
    const first = canonical.get(key);
    if (first) map.set(ref.toString(), first); else canonical.set(key, ref);
  }
  if (map.size) for (const [, object] of context.enumerateIndirectObjects()) remap(object, map);
  // 3. Remove everything not reachable from the catalog and the Info dictionary.
  const reachable = new Set<string>();
  const pending: PDFRef[] = [];
  for (const root of [context.trailerInfo.Root, context.trailerInfo.Info]) if (root instanceof PDFRef) pending.push(root);
  while (pending.length) {
    const ref = pending.pop()!;
    if (reachable.has(ref.toString())) continue;
    reachable.add(ref.toString());
    const object = context.lookup(ref);
    if (object) references(object, pending);
  }
  let unusedRemoved = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) { context.delete(ref); unusedRemoved++; }
  }
  return { streamsCompressed, duplicatesMerged: map.size, unusedRemoved: Math.max(0, unusedRemoved - map.size) };
}

export async function compressPdfLossless(bytes: Uint8Array): Promise<PdfCompressReport> {
  const pdf = await loadForCompression(bytes);
  const beforeContent = pageContents(pdf);
  const counts = await optimizeLoaded(pdf);
  const out = Uint8Array.from(await pdf.save({ useObjectStreams: true, updateFieldAppearances: false }));
  const check = await PDFDocument.load(out, { updateMetadata: false });
  const afterContent = pageContents(check);
  if (afterContent.length !== beforeContent.length || afterContent.some((content, i) => content !== beforeContent[i])) {
    throw new Error('Compression stopped: the optimized file would not show the same page content. The document was not changed.');
  }
  const smaller = out.length < bytes.length;
  return { bytes: smaller ? out : bytes, before: bytes.length, after: smaller ? out.length : bytes.length, ...counts, unchanged: !smaller };
}
