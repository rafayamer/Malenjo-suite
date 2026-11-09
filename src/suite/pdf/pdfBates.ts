/**
 * Bates numbering across files (MAL-067). Each page of each file, in the order given, gets the next identifier:
 * prefix + zero-padded counter + suffix, stamped in the page's visible frame. Between files the counter continues,
 * restarts, or jumps to the next round number, and the prefix may carry the file's volume number ({vol}).
 * A log lists every file's first and last identifier.
 */
import { zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { sha256Hex } from './pdfBatch';
import { stampPageLabels, type StampPosition, type StampText } from './pdfStamp';

export type BatesContinuation = 'continue' | 'restart' | 'round';
export interface BatesSpec {
  /** May contain {vol}: the file's position in the batch, zero-padded to three digits. */
  prefix: string;
  suffix: string;
  start: number;
  digits: number;
  position: StampPosition;
  marginX: number;
  marginY: number;
  text: StampText;
  continuation: BatesContinuation;
  /** With 'round', each later file starts at the next multiple of this. */
  roundTo: number;
}
export interface BatesFileResult { name: string; pages: number; first: string; last: string; bytes: Uint8Array }

export const BATES_MAX_FILES = 200;
const csv = (value: string | number) => { const s = String(value); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };

export function checkBatesSpec(spec: BatesSpec): void {
  if (!Number.isSafeInteger(spec.start) || spec.start < 0 || spec.start > 999_999_999_999) throw new Error('The start number must be a whole number from 0 up.');
  if (!Number.isSafeInteger(spec.digits) || spec.digits < 1 || spec.digits > 12) throw new Error('Padding must be from 1 to 12 digits.');
  if (spec.prefix.length > 60 || spec.suffix.length > 60) throw new Error('Prefix and suffix must be 60 characters or shorter.');
  if (/[\u0000-\u001f]/.test(spec.prefix + spec.suffix)) throw new Error('Prefix and suffix cannot contain control characters.');
  if (!['continue', 'restart', 'round'].includes(spec.continuation)) throw new Error('Choose how numbering continues between files.');
  if (spec.continuation === 'round' && (!Number.isSafeInteger(spec.roundTo) || spec.roundTo < 2 || spec.roundTo > 1_000_000)) throw new Error('Round to a whole number from 2 to 1,000,000.');
}

export function batesLabel(spec: BatesSpec, counter: number, volume: number): string {
  const serial = String(counter).padStart(spec.digits, '0');
  if (serial.length > spec.digits) throw new Error(`Bates numbers would need more than ${spec.digits} digits; increase the padding or lower the start number.`);
  return `${spec.prefix.replace(/\{vol\}/gi, String(volume).padStart(3, '0'))}${serial}${spec.suffix}`;
}

/** First counter value for each file, given their page counts. */
export function batesPlan(spec: BatesSpec, pageCounts: number[]): number[] {
  checkBatesSpec(spec);
  const starts: number[] = []; let next = spec.start;
  pageCounts.forEach((pages, i) => {
    if (i > 0 && spec.continuation === 'restart') next = spec.start;
    if (i > 0 && spec.continuation === 'round') next = Math.ceil(next / spec.roundTo) * spec.roundTo;
    starts.push(next); next += pages;
  });
  return starts;
}

export async function batesNumberFiles(files: { name: string; bytes: Uint8Array }[], spec: BatesSpec, onProgress?: (done: number, total: number) => void): Promise<{ files: BatesFileResult[]; log: string }> {
  if (!files.length) throw new Error('Add at least one PDF.');
  if (files.length > BATES_MAX_FILES) throw new Error(`Bates numbering handles up to ${BATES_MAX_FILES} files at a time.`);
  checkBatesSpec(spec);
  const counts: number[] = [];
  for (const file of files) {
    try { counts.push((await PDFDocument.load(file.bytes, { updateMetadata: false })).getPageCount()); }
    catch { throw new Error(`${file.name} could not be read because it is encrypted, invalid or damaged.`); }
  }
  const starts = batesPlan(spec, counts);
  const results: BatesFileResult[] = [];
  for (let i = 0; i < files.length; i++) {
    const labels = new Map<number, string>();
    for (let p = 0; p < counts[i]; p++) labels.set(p + 1, batesLabel(spec, starts[i] + p, i + 1));
    let out;
    try { out = await stampPageLabels(files[i].bytes, labels, spec.text, spec.position, spec.marginX, spec.marginY); }
    catch (error) { throw new Error(`${files[i].name}: ${error instanceof Error ? error.message : String(error)}`); }
    results.push({ name: files[i].name, pages: counts[i], first: labels.get(1)!, last: labels.get(counts[i])!, bytes: out.bytes });
    onProgress?.(i + 1, files.length);
  }
  const rows = ['File,First Bates,Last Bates,Pages,SHA-256'];
  for (const r of results) rows.push([r.name, r.first, r.last, r.pages, await sha256Hex(r.bytes)].map(csv).join(','));
  return { files: results, log: rows.join('\r\n') + '\r\n' };
}

/** Numbered files under their first identifier (unique by construction when numbering continues), plus the log. */
export function batesArchive(result: { files: BatesFileResult[]; log: string }): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  result.files.forEach((file, i) => {
    const safe = file.name.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'document';
    let name = `${file.first.replace(/[^\w.-]+/g, '_')}_${safe}.pdf`;
    if (entries[name]) name = `${String(i + 1).padStart(3, '0')}_${name}`;
    entries[name] = file.bytes;
  });
  entries['bates-log.csv'] = new TextEncoder().encode(result.log);
  return zipSync(entries, { level: 6 });
}
