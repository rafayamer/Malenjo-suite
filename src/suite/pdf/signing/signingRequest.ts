/**
 * Electronic signature requests (MAL-066), carried by the PDF itself:
 * - preparing a request adds one empty signature field per recipient and embeds the request (title, message,
 *   recipients, order, who prepared it, the original file's SHA-256);
 * - each recipient signs their own field with a certificate (MAL-065), in order when the order is sequential;
 * - the status is worked out from the signatures actually in the file and their validation;
 * - the audit report lists the request, every signature's validation evidence and a hash of each signed revision.
 * MALENJO sends no email: the sender passes the file to each recipient in their own way.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { hex } from './asn1';
import { sha256 } from './cms';
import { verifyPdfSignatures, type SignatureReport } from './pdfVerify';
import type { Certificate } from './x509';

export interface Recipient { name: string; email: string }
export interface SigningRequest {
  version: 1; id: string; title: string; message: string; order: 'sequential' | 'any';
  recipients: (Recipient & { field: string })[]; preparedBy: string; preparedAt: string; originalSha256: string;
}
export interface RecipientStatus { recipient: Recipient & { field: string }; state: 'signed' | 'ready' | 'waiting'; report?: SignatureReport; nameMatches?: boolean }
export interface RequestStatus { request: SigningRequest; recipients: RecipientStatus[]; complete: boolean; next: RecipientStatus | null }

const N = PDFName.of;
export const REQUEST_FILE = 'malenjo-signing-request.json';
const fieldName = (i: number, r: Recipient) => `Sign ${i + 1} - ${r.name.replace(/[.\u0000-\u001f]/g, ' ').trim()}`;

export async function prepareSigningRequest(bytes: Uint8Array, spec: { title: string; message: string; order: 'sequential' | 'any'; recipients: Recipient[]; preparedBy: string;
  placements?: ({ pageNumber: number; box: [number, number, number, number] } | null)[] }): Promise<{ bytes: Uint8Array; request: SigningRequest }> {
  const title = spec.title.trim();
  if (!title || title.length > 200) throw new Error('Give the request a title of up to 200 characters.');
  const recipients = spec.recipients.map((r) => ({ name: r.name.trim(), email: r.email.trim() }));
  if (!recipients.length || recipients.length > 20) throw new Error('Add between 1 and 20 recipients.');
  if (recipients.some((r) => !r.name || r.name.length > 120)) throw new Error('Every recipient needs a name (up to 120 characters).');
  if (recipients.some((r) => r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))) throw new Error('One of the email addresses is not valid.');
  if (new Set(recipients.map((r) => r.name.toLowerCase())).size !== recipients.length) throw new Error('Each recipient must have a different name.');
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { throw new Error('This PDF could not be read because it is encrypted, invalid or damaged.'); }
  if (pdf.getForm().getFields().some((f) => f.acroField.dict.get(N('FT'))?.toString() === '/Sig' && f.acroField.dict.has(N('V')))) throw new Error('This PDF is already signed; prepare the request on an unsigned copy.');
  if (await readSigningRequest(bytes)) throw new Error('This PDF already holds a signing request.');
  const last = pdf.getPage(pdf.getPageCount() - 1);
  const { width } = last.getSize(); const crop = last.getCropBox();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.getForm(); // creates the AcroForm when there is none
  const acro = pdf.catalog.lookup(N('AcroForm'), PDFDict);
  const fields = acro.lookupMaybe(N('Fields'), PDFArray) ?? (() => { const a = pdf.context.obj([]); acro.set(N('Fields'), a); return a; })();
  const withFields = recipients.map((r, i) => ({ ...r, field: fieldName(i, r) }));
  withFields.forEach((r, i) => {
    const placement = spec.placements?.[i];
    const pageIndex = placement ? placement.pageNumber - 1 : pdf.getPageCount() - 1;
    if (pageIndex < 0 || pageIndex >= pdf.getPageCount()) throw new Error(`The signature box for ${r.name} is on a page that is not in this PDF.`);
    const page = pdf.getPage(pageIndex);
    // Default boxes: stacked from the bottom of the last page, two per row.
    const w = Math.min(220, (width - 72) / 2 - 6), h = 46;
    const box = placement?.box ?? [crop.x + 36 + (i % 2) * (w + 12), crop.y + 36 + Math.floor(i / 2) * (h + 12), crop.x + 36 + (i % 2) * (w + 12) + w, crop.y + 36 + Math.floor(i / 2) * (h + 12) + h];
    const bw = box[2] - box[0], bh = box[3] - box[1];
    const label = `Signature of ${r.name}`;
    const size = Math.max(5, Math.min(9, (bw - 8) / Math.max(1, font.widthOfTextAtSize(label, 1))));
    const ap = pdf.context.register(pdf.context.stream(`0.75 0.45 0.1 RG 1 w [3 2] 0 d 0.5 0.5 ${bw - 1} ${bh - 1} re S BT /Helv ${size.toFixed(2)} Tf 0.45 0.3 0.1 rg 4 ${(bh / 2 - size / 3).toFixed(2)} Td ${font.encodeText(label).toString()} Tj ET`,
      { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, bw, bh], Resources: { Font: { Helv: font.ref } } }));
    const dict = pdf.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFHexString.fromText(r.field), TU: PDFHexString.fromText(`${label}${r.email ? ` <${r.email}>` : ''}`), F: 4, Rect: box, P: page.ref, AP: { N: ap } });
    const ref = pdf.context.register(dict);
    const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
    if (annots) annots.push(ref); else page.node.set(N('Annots'), pdf.context.obj([ref]));
    fields.push(ref);
  });
  const request: SigningRequest = {
    version: 1, id: crypto.randomUUID(), title, message: spec.message.trim().slice(0, 4000), order: spec.order, recipients: withFields,
    preparedBy: spec.preparedBy.trim() || 'Unknown', preparedAt: new Date().toISOString(), originalSha256: hex(await sha256(bytes)),
  };
  await pdf.attach(new TextEncoder().encode(JSON.stringify(request, null, 2)), REQUEST_FILE, { mimeType: 'application/json', description: `Signing request: ${title}`, creationDate: new Date(), modificationDate: new Date() });
  return { bytes: await pdf.save({ useObjectStreams: false }), request };
}

export async function readSigningRequest(bytes: Uint8Array): Promise<SigningRequest | null> {
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true }); } catch { return null; }
  const names = pdf.catalog.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N('EmbeddedFiles'), PDFDict)?.lookupMaybe(N('Names'), PDFArray);
  for (let k = 0; names && k + 1 < names.size(); k += 2) {
    const key = names.lookup(k); const name = key instanceof PDFString || key instanceof PDFHexString ? key.decodeText() : '';
    if (name !== REQUEST_FILE) continue;
    const spec = names.lookup(k + 1, PDFDict);
    const stream = spec.lookupMaybe(N('EF'), PDFDict)?.lookup(N('F'));
    try {
      if (!(stream instanceof PDFRawStream)) return null;
      const parsed = JSON.parse(new TextDecoder().decode(decodePDFRawStream(stream).decode())) as SigningRequest;
      if (parsed.version !== 1 || !Array.isArray(parsed.recipients)) return null;
      return parsed;
    } catch { return null; }
  }
  return null;
}

const normal = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export async function signingRequestStatus(bytes: Uint8Array, trusted: Certificate[]): Promise<RequestStatus | null> {
  const request = await readSigningRequest(bytes);
  if (!request) return null;
  const reports = await verifyPdfSignatures(bytes, trusted);
  let blocked = false;
  const recipients = request.recipients.map((recipient): RecipientStatus => {
    const report = reports.find((r) => r.field === recipient.field);
    if (report) return { recipient, state: 'signed', report, nameMatches: normal(report.signer) === normal(recipient.name) };
    const state = blocked ? 'waiting' : 'ready';
    if (request.order === 'sequential') blocked = true;
    return { recipient, state };
  });
  return { request, recipients, complete: recipients.every((r) => r.state === 'signed'), next: recipients.find((r) => r.state === 'ready') ?? null };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** The audit report: request, recipients, every signature's validation evidence and a SHA-256 of each signed revision. */
export async function signingAuditReport(bytes: Uint8Array, trusted: Certificate[], fileName: string, now = new Date()): Promise<string> {
  const status = await signingRequestStatus(bytes, trusted);
  if (!status) throw new Error('This PDF holds no signing request.');
  const text = new TextDecoder('latin1').decode(bytes);
  const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].map((m) => Number(m[2]) + Number(m[3]));
  const revisions: string[] = [];
  for (const end of [...new Set(ranges)].sort((a, b) => a - b)) revisions.push(`<tr><td>${end.toLocaleString('en-US')} bytes</td><td><code>${hex(await sha256(bytes.subarray(0, end)))}</code></td></tr>`);
  const r = status.request;
  const rows = status.recipients.map((s, i) => {
    const rep = s.report;
    const detail = rep ? `${esc(rep.signer)} — ${rep.status === 'valid' ? 'valid' : rep.status === 'warning' ? 'intact, with notes' : 'INVALID'}; ${esc(rep.level)}; ${rep.timestamp?.trusted ? `trusted time ${rep.timestamp.time.toISOString()}` : `time claimed by signer ${rep.signedAt?.toISOString() ?? 'unknown'}`}; certificate ${rep.certificateTrusted ? 'trusted' : 'not trusted'} (${esc(rep.chain.join(' → '))}); revocation ${rep.revocation}${s.nameMatches === false ? '; <strong>certificate name differs from the recipient</strong>' : ''}${rep.problems.length ? `<ul>${rep.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}` : s.state === 'ready' ? 'not signed yet (may sign now)' : 'not signed yet (waiting for earlier recipients)';
    return `<tr><td>${i + 1}</td><td>${esc(s.recipient.name)}${s.recipient.email ? `<br><small>${esc(s.recipient.email)}</small>` : ''}</td><td>${s.state}</td><td>${detail}</td></tr>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signing audit report: ${esc(r.title)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:64rem;margin:2rem auto;padding:0 1rem;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:6px;text-align:left;vertical-align:top}code{word-break:break-all}</style></head>
<body><h1>Signing audit report</h1>
<p><strong>${esc(r.title)}</strong><br>Request ${esc(r.id)}, prepared by ${esc(r.preparedBy)} on ${esc(r.preparedAt)}; order: ${r.order === 'sequential' ? 'one after another' : 'any order'}.</p>
${r.message ? `<p>${esc(r.message)}</p>` : ''}
<p>Status: <strong>${status.complete ? 'COMPLETED — every recipient has signed' : 'IN PROGRESS'}</strong>. File: ${esc(fileName)}, SHA-256 <code>${hex(await sha256(bytes))}</code>. Original before the request: SHA-256 <code>${esc(r.originalSha256)}</code>.</p>
<h2>Recipients</h2><table><thead><tr><th>#</th><th>Recipient</th><th>Status</th><th>Signature evidence</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Signed revisions</h2><table><thead><tr><th>Revision length</th><th>SHA-256</th></tr></thead><tbody>${revisions.join('\n') || '<tr><td colspan="2">None yet</td></tr>'}</tbody></table>
<p><small>Generated by MALENJO on ${now.toISOString()}. Signature evidence is checked against the certificates trusted on this device.</small></p></body></html>`;
}
