/**
 * Dynamic and custom stamps (MAL-057). A stamp design has a status line (the approval state, e.g. APPROVED) and a
 * detail line with variables — {user}, {date}, {time}, {docid}, {file}, {status} — filled in when the stamp is placed.
 * Placed stamps are real Stamp annotations with their own appearance, upright in the view they were placed in.
 * Designs are kept in a reusable library (stampLibrary.ts).
 */
import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts } from 'pdf-lib';
import { refuseSignedPdf } from './pdfSignatureGuard';
import { parseColor, viewerFrame, type Matrix } from './pdfStamp';
import type { ShownPoint } from './pdfMarkup';

export interface StampDesign { id: string; name: string; status: string; detail: string; color: string; builtIn?: boolean }
export const STAMP_VARIABLES = ['user', 'date', 'time', 'docid', 'file', 'status'] as const;
export const BUILT_IN_STAMPS: StampDesign[] = [
  { id: 'approved', name: 'Approved', status: 'APPROVED', detail: 'By {user} on {date} at {time}', color: '#15803d', builtIn: true },
  { id: 'rejected', name: 'Rejected', status: 'REJECTED', detail: 'By {user} on {date} at {time}', color: '#b91c1c', builtIn: true },
  { id: 'reviewed', name: 'Reviewed', status: 'REVIEWED', detail: '{user} · {date} · Doc {docid}', color: '#1d4ed8', builtIn: true },
  { id: 'draft', name: 'Draft', status: 'DRAFT', detail: '{file} · {date}', color: '#4b5563', builtIn: true },
  { id: 'confidential', name: 'Confidential', status: 'CONFIDENTIAL', detail: 'Doc {docid}', color: '#b91c1c', builtIn: true },
];
export interface StampValues { user: string; now: Date; docId: string; file: string }

const N = PDFName.of;
const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const clockTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function checkStampDesign(design: StampDesign): void {
  if (!design.name.trim() || design.name.length > 60) throw new Error('Give the stamp a name of up to 60 characters.');
  if (!design.status.trim() || design.status.length > 40) throw new Error('The status line must be 1 to 40 characters.');
  if (design.detail.length > 120) throw new Error('The detail line must be 120 characters or shorter.');
  for (const [, key] of `${design.status} ${design.detail}`.matchAll(/\{([^}]*)\}/g)) {
    if (!(STAMP_VARIABLES as readonly string[]).includes(key.toLowerCase())) throw new Error(`{${key}} is not a stamp variable. Use ${STAMP_VARIABLES.map((v) => `{${v}}`).join(', ')}.`);
  }
  parseColor(design.color);
}

/** The status and detail lines with every variable filled in. */
export function resolveStamp(design: StampDesign, values: StampValues): { status: string; detail: string } {
  const fill = (template: string, status: string) => template.replace(/\{([a-z]+)\}/gi, (_, key: string) => ({
    user: values.user || 'Unknown user', date: isoDate(values.now), time: clockTime(values.now), docid: values.docId || 'none', file: values.file || 'document.pdf', status,
  } as Record<string, string>)[key.toLowerCase()] ?? '');
  const status = fill(design.status, '');
  return { status, detail: fill(design.detail, status) };
}

/** The document identifier: the first part of the trailer ID, as 12 hex digits (blank when the file has none). */
export async function documentIdentifier(bytes: Uint8Array): Promise<string> {
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const id = pdf.context.trailerInfo.ID;
    const first = id && 'get' in id ? (id as unknown as { get(i: number): unknown }).get(0) : undefined;
    const hex = first instanceof PDFHexString ? first.asString() : first instanceof PDFString ? Array.from(first.asBytes(), (b) => b.toString(16).padStart(2, '0')).join('') : '';
    return hex.slice(0, 12).toUpperCase();
  } catch { return ''; }
}

export interface PlaceStampSpec { pageNumber: number; viewRotation: number; point: ShownPoint; design: StampDesign; values: StampValues }

export async function addDynamicStamp(bytes: Uint8Array, spec: PlaceStampSpec): Promise<{ bytes: Uint8Array; text: string }> {
  checkStampDesign(spec.design);
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { throw new Error('This PDF could not be stamped because it is encrypted, invalid or damaged.'); }
  refuseSignedPdf(pdf, 'stamping it');
  if (!Number.isSafeInteger(spec.pageNumber) || spec.pageNumber < 1 || spec.pageNumber > pdf.getPageCount()) throw new Error('That page is not in this PDF.');
  const { status, detail } = resolveStamp(spec.design, spec.values);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold); const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const encode = (font: typeof bold, s: string) => { try { return font.encodeText(s).toString(); } catch { throw new Error(`“${s.slice(0, 40)}” contains characters the stamp fonts cannot show. Use Latin letters, digits and common punctuation.`); } };
  const statusText = encode(bold, status); const detailText = detail ? encode(regular, detail) : '';
  const statusSize = 16, detailSize = 8;
  const width = Math.max(bold.widthOfTextAtSize(status, statusSize), detail ? regular.widthOfTextAtSize(detail, detailSize) : 0) + 20;
  const height = detail ? 44 : 30;
  const frame = viewerFrame(pdf, spec.pageNumber - 1, spec.viewRotation);
  if (!(spec.point.x >= 0 && spec.point.x <= 1 && spec.point.y >= 0 && spec.point.y <= 1)) throw new Error('Place the stamp on the page.');
  // Centre the stamp on the click, kept inside the shown page.
  const cx = Math.min(Math.max(spec.point.x * frame.width, width / 2), frame.width - width / 2);
  const cy = Math.min(Math.max((1 - spec.point.y) * frame.height, height / 2), frame.height - height / 2);
  const [u0, v0] = [cx - width / 2, cy - height / 2];
  const m: Matrix = frame.matrix;
  const toPage = (u: number, v: number) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
  const corners = [toPage(u0, v0), toPage(u0 + width, v0 + height), toPage(u0, v0 + height), toPage(u0 + width, v0)];
  const rect = [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1]))];
  const [r, g, b] = parseColor(spec.design.color);
  const radius = 6;
  const box = `${u0 + radius} ${v0} m ${u0 + width - radius} ${v0} l ${u0 + width} ${v0} ${u0 + width} ${v0} ${u0 + width} ${v0 + radius} c ${u0 + width} ${v0 + height - radius} l ${u0 + width} ${v0 + height} ${u0 + width} ${v0 + height} ${u0 + width - radius} ${v0 + height} c ${u0 + radius} ${v0 + height} l ${u0} ${v0 + height} ${u0} ${v0 + height} ${u0} ${v0 + height - radius} c ${u0} ${v0 + radius} l ${u0} ${v0} ${u0} ${v0} ${u0 + radius} ${v0} c h`;
  const statusX = u0 + (width - bold.widthOfTextAtSize(status, statusSize)) / 2;
  const statusY = detail ? v0 + height - 22 : v0 + 9;
  const ops = [`q ${m.join(' ')} cm`, `${r} ${g} ${b} RG 2 w 1 1 1 rg ${box} B`, `${r} ${g} ${b} rg BT /SB ${statusSize} Tf ${statusX} ${statusY} Td ${statusText} Tj ET`];
  if (detail) ops.push(`BT /SR ${detailSize} Tf ${u0 + (width - regular.widthOfTextAtSize(detail, detailSize)) / 2} ${v0 + 9} Td ${detailText} Tj ET`);
  ops.push('Q');
  const appearance = pdf.context.register(pdf.context.stream(ops.join('\n'), { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: { Font: { SB: bold.ref, SR: regular.ref } } }));
  const text = detail ? `${status} — ${detail}` : status;
  const dict = pdf.context.obj({
    Type: 'Annot', Subtype: 'Stamp', Rect: rect, F: 4, C: [r, g, b], Name: N(spec.design.status.replace(/[^A-Za-z0-9]/g, '') || 'Stamp'),
    Contents: PDFHexString.fromText(text), T: PDFHexString.fromText(spec.values.user || 'MALENJO User'), Subj: PDFHexString.fromText(spec.design.name),
    M: PDFString.fromDate(spec.values.now), CreationDate: PDFString.fromDate(spec.values.now), AP: { N: appearance },
    // The design it came from, so the variables can be read back.
    MALENJO_StampTemplate: PDFHexString.fromText(`${spec.design.status}\n${spec.design.detail}`), MALENJO_ViewRotation: PDFNumber.of(((spec.viewRotation % 360) + 360) % 360),
  });
  const page = pdf.getPage(spec.pageNumber - 1);
  const existing = page.node.lookup(N('Annots'));
  const ref = pdf.context.register(dict);
  if (existing && 'push' in existing) (existing as unknown as { push(r: unknown): void }).push(ref); else page.node.set(N('Annots'), pdf.context.obj([ref]));
  return { bytes: await pdf.save({ useObjectStreams: false }), text };
}
