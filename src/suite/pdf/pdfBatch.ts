/**
 * MAL-010 Batch document assembly: apply one ordered set of page
 * organization rules to many PDFs and produce a ZIP of results plus a
 * manifest (JSON and CSV) with each file's status, page counts, sizes and
 * SHA-256 digests of input and output.
 *
 * A file that fails (damaged, encrypted, a rule that does not fit it) is
 * recorded as failed with a plain-language reason; the other files still run.
 * Source bytes are never modified.
 */
import { strToU8, zipSync } from 'fflate';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, degrees } from 'pdf-lib';
import { nupPdf, type NupOptions } from './pdfNup';
import { listPdfPageLabelRanges, type PdfPageLabelRange } from './pageLabels';
import { pruneNavigationToPages } from './pdfNavigationPrune';
import { parsePageRanges } from './pdfSplitModes';

export const PDF_BATCH_MAX_FILES = 50;
export const PDF_BATCH_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const PDF_BATCH_MAX_RULES = 20;

export type PdfBatchRule =
  | { kind: 'rotate'; pages: string; angle: 90 | 180 | 270 }
  | { kind: 'remove'; pages: string }
  | { kind: 'keep'; pages: string }
  | { kind: 'nup'; options: NupOptions };

export interface PdfBatchEntry {
  source: string;
  output: string | null;
  status: 'ok' | 'failed';
  message: string;
  inputPages: number | null;
  outputPages: number | null;
  inputBytes: number;
  outputBytes: number | null;
  inputSha256: string;
  outputSha256: string | null;
}
export interface PdfBatchResult { archive: Uint8Array; entries: PdfBatchEntry[]; succeeded: number; failed: number }

/** "all" (or empty) selects every page; otherwise ranges like 1-3, 5, 8-. */
export function batchPages(text: string, pageCount: number): number[] {
  if (!text.trim() || /^all$/i.test(text.trim())) return Array.from({ length: pageCount }, (_, index) => index + 1);
  return [...new Set(parsePageRanges(text, pageCount).flat())].sort((a, b) => a - b);
}

export function describeBatchRule(rule: PdfBatchRule): string {
  switch (rule.kind) {
    case 'rotate': return `Rotate ${rule.pages.trim() || 'all'} by ${rule.angle}°`;
    case 'remove': return `Remove pages ${rule.pages.trim()}`;
    case 'keep': return `Keep only pages ${rule.pages.trim()}`;
    case 'nup': return `${rule.options.perSheet} pages per sheet`;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function applyRules(bytes: Uint8Array, rules: PdfBatchRule[]): Promise<{ bytes: Uint8Array; inputPages: number; outputPages: number; note: string }> {
  let prunedLinks = 0, prunedBookmarks = 0;
  let pdf: PDFDocument;
  let inputPages: number;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    inputPages = pdf.getPageCount();
    if (inputPages < 1) throw new Error('no pages');
  } catch { throw new Error('This file is encrypted, invalid or damaged.'); }
  for (const [index, rule] of rules.entries()) {
    const step = `Rule ${index + 1} (${describeBatchRule(rule)})`;
    try {
      if (rule.kind === 'nup') {
        const arranged = await nupPdf(Uint8Array.from(await pdf.save()), rule.options);
        pdf = await PDFDocument.load(arranged.bytes);
        continue;
      }
      const pages = batchPages(rule.pages, pdf.getPageCount());
      if (rule.kind === 'rotate') {
        for (const page of pages) {
          const target = pdf.getPage(page - 1);
          const current = ((target.getRotation().angle % 360) + 360) % 360;
          target.setRotation(degrees((current + rule.angle) % 360));
        }
      } else {
        const keep = new Set(rule.kind === 'keep' ? pages : []);
        const remove = rule.kind === 'remove'
          ? pages
          : Array.from({ length: pdf.getPageCount() }, (_, i) => i + 1).filter((page) => !keep.has(page));
        if (remove.length >= pdf.getPageCount()) throw new Error('it would remove every page');
        // Page labels are indexed by page position: work out each kept page's label first.
        // Form fields keep widget references to their pages; removing such a page would leave orphaned fields.
        for (const page of remove) {
          const annots = pdf.getPage(page - 1).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? [];
          if (annots.some((a) => { const d = pdf.context.lookup(a); return d instanceof PDFDict && d.get(PDFName.of('Subtype'))?.toString() === '/Widget'; })) {
            throw new Error(`page ${page} has form fields; remove them or flatten the form before removing the page`);
          }
        }
        const labels = pdf.catalog.has(PDFName.of('PageLabels')) ? await labelRanges(pdf) : null;
        const kept = Array.from({ length: pdf.getPageCount() }, (_, i) => i + 1).filter((page) => !remove.includes(page));
        // Bookmarks and links to removed pages would be dead: remove them first.
        const pruned = pruneNavigationToPages(pdf, new Set(remove.map((page) => pdf.getPage(page - 1).ref.toString())));
        prunedLinks += pruned.links; prunedBookmarks += pruned.bookmarks;
        for (const page of [...remove].sort((a, b) => b - a)) pdf.removePage(page - 1);
        if (labels) writeLabelsFor(pdf, kept, labels);
        // pdf-lib keeps a stale page cache after removePage; reload so later rules see the real pages.
        pdf = await PDFDocument.load(await pdf.save(), { updateMetadata: false });
      }
    } catch (error) {
      throw new Error(`${step}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  pdf.setProducer('MALENJO');
  const note = prunedLinks || prunedBookmarks ? `Removed ${prunedBookmarks} bookmark(s) and ${prunedLinks} link(s) that pointed to removed pages.` : '';
  return { bytes: Uint8Array.from(await pdf.save({ useObjectStreams: true })), inputPages, outputPages: pdf.getPageCount(), note };
}

async function labelRanges(pdf: PDFDocument): Promise<PdfPageLabelRange[]> {
  try { return await listPdfPageLabelRanges(Uint8Array.from(await pdf.save())); }
  catch { throw new Error('its page labels use a structure that cannot be updated when pages are removed'); }
}

/** Rewrites /PageLabels so each kept page (original numbers, in order) shows the label it had before. */
function writeLabelsFor(pdf: PDFDocument, kept: number[], ranges: PdfPageLabelRange[]): void {
  const sorted = [...ranges].sort((a, b) => a.startPage - b.startPage);
  const nums: unknown[] = [];
  let previous: { range: PdfPageLabelRange; number: number } | null = null;
  kept.forEach((page, index) => {
    const range = [...sorted].reverse().find((item) => item.startPage <= page);
    if (!range) return;
    const number = range.startNumber + page - range.startPage;
    const continues = previous && previous.range === range && (range.style === 'none' || number === previous.number + 1);
    if (!continues) {
      const dict = pdf.context.obj({}) as PDFDict;
      if (range.style !== 'none') dict.set(PDFName.of('S'), PDFName.of(range.style));
      if (range.prefix) dict.set(PDFName.of('P'), PDFHexString.fromText(range.prefix));
      if (number !== 1) dict.set(PDFName.of('St'), PDFNumber.of(number));
      nums.push(index, dict);
    }
    previous = { range, number };
  });
  if (nums.length && nums[0] !== 0) nums.unshift(0, pdf.context.obj({}));
  pdf.catalog.set(PDFName.of('PageLabels'), pdf.context.obj({ Nums: nums as never }));
}

function outputName(source: string, used: Set<string>): string {
  const stem = (source.split(/[\\/]/).pop() ?? 'document').replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N} ._-]+/gu, '_').trim() || 'document';
  let name = `${stem}.pdf`;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem} (${n}).pdf`;
  used.add(name.toLowerCase());
  return `results/${name}`;
}

/** CSV cell: quoted, with spreadsheet formula prefixes neutralised. */
function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function batchManifestCsv(entries: PdfBatchEntry[]): string {
  const columns: (keyof PdfBatchEntry)[] = ['source', 'output', 'status', 'message', 'inputPages', 'outputPages', 'inputBytes', 'outputBytes', 'inputSha256', 'outputSha256'];
  return [columns.join(','), ...entries.map((entry) => columns.map((column) => csvCell(entry[column])).join(','))].join('\r\n') + '\r\n';
}

/**
 * maxOutputBytes bounds the retained results (the desktop writer saves 32 MB;
 * browser downloads 256 MB); the batch is refused as soon as it would exceed it.
 */
export async function runPdfBatch(sources: { name: string; bytes: Uint8Array }[], rules: PdfBatchRule[],
  maxOutputBytes = PDF_BATCH_MAX_TOTAL_BYTES): Promise<PdfBatchResult> {
  if (!sources.length) throw new Error('Choose at least one PDF.');
  if (sources.length > PDF_BATCH_MAX_FILES) throw new Error(`Batch supports up to ${PDF_BATCH_MAX_FILES} files.`);
  if (sources.reduce((sum, source) => sum + source.bytes.length, 0) > PDF_BATCH_MAX_TOTAL_BYTES) throw new Error('Batch supports up to 256 MB of input.');
  if (!rules.length) throw new Error('Add at least one rule.');
  if (rules.length > PDF_BATCH_MAX_RULES) throw new Error(`Batch supports up to ${PDF_BATCH_MAX_RULES} rules.`);

  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > PDF_BATCH_MAX_TOTAL_BYTES) {
    throw new Error('Batch output budget must be between 1 KB and 256 MB.');
  }
  let retained = 64 * 1024; // room for the manifests
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const entries: PdfBatchEntry[] = [];
  for (const source of sources) {
    const inputSha256 = await sha256Hex(source.bytes);
    const base = { source: source.name, inputBytes: source.bytes.length, inputSha256 };
    try {
      const result = await applyRules(source.bytes, rules);
      retained += result.bytes.length + 256;
      if (retained > maxOutputBytes) {
        throw Object.assign(new Error(`The batch results would exceed ${Math.round(maxOutputBytes / (1024 * 1024))} MB together. Run fewer files at once.`), { budget: true });
      }
      const output = outputName(source.name, used);
      files[output] = result.bytes;
      entries.push({ ...base, output, status: 'ok', message: result.note, inputPages: result.inputPages, outputPages: result.outputPages, outputBytes: result.bytes.length, outputSha256: await sha256Hex(result.bytes) });
    } catch (error) {
      if (error instanceof Error && 'budget' in error) throw error;
      entries.push({ ...base, output: null, status: 'failed', message: error instanceof Error ? error.message : String(error), inputPages: null, outputPages: null, outputBytes: null, outputSha256: null });
    }
  }
  const manifest = { generator: 'MALENJO', rules: rules.map(describeBatchRule), entries };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['manifest.csv'] = strToU8(batchManifestCsv(entries));
  const succeeded = entries.filter((entry) => entry.status === 'ok').length;
  return { archive: zipSync(files, { level: 0 }), entries, succeeded, failed: entries.length - succeeded };
}
