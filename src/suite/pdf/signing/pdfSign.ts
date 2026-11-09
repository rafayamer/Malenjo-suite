/**
 * Certificate-based PDF signing (MAL-065) with PAdES baseline profiles:
 * - B-B: CAdES-detached signature (ETSI.CAdES.detached) with the signing-certificate-v2 attribute;
 * - B-T: plus a trusted timestamp from an RFC 3161 timestamp authority on the signature value;
 * - B-LT: plus a Document Security Store with the certificates and revocation lists (CRLs) needed to validate it;
 * - B-LTA: plus a document timestamp over everything, so the evidence itself is protected.
 * Each step is an incremental update: the bytes signed before stay exactly as they were.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import { concatBytes, equalBytes, hex } from './asn1';
import { buildSignedData, fetchTransport, parseCrl, parseSignedData, requestTimestamp, sha256, timestampAttribute, type Crl, type Transport } from './cms';
import type { SigningIdentity } from './pkcs12';
import { commonName, issuedBy, selfIssued, verifyWith, type Certificate } from './x509';

export type PadesProfile = 'B-B' | 'B-T' | 'B-LT' | 'B-LTA';
export const PADES_PROFILES: [PadesProfile, string][] = [
  ['B-B', 'PAdES B-B (basic signature)'], ['B-T', 'PAdES B-T (with a trusted timestamp)'],
  ['B-LT', 'PAdES B-LT (long-term: certificates and revocation embedded)'], ['B-LTA', 'PAdES B-LTA (long-term with archive timestamp)'],
];
export interface SignOptions {
  profile: PadesProfile;
  reason?: string; location?: string; contactInfo?: string;
  /** A visible signature box (page space); invisible when absent. */
  appearance?: { pageNumber: number; box: [number, number, number, number] } | null;
  tsaUrl?: string;
  transport?: Transport;
  now?: Date;
}

const N = PDFName.of;
const CONTENTS_BYTES = 24 * 1024;
const enc = new TextEncoder();
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const pdfDate = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`; };
const text = (s: string) => PDFHexString.fromText(s).toString();

export function serialize(object: PDFObject): Uint8Array {
  const out = new Uint8Array(object.sizeInBytes()); object.copyBytesInto(out, 0); return out;
}
function findLast(haystack: Uint8Array, needle: string, from = haystack.length): number {
  const n = latin1(needle);
  for (let i = Math.min(from, haystack.length - n.length); i >= 0; i--) { let ok = true; for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) { ok = false; break; } if (ok) return i; }
  return -1;
}
function findFrom(haystack: Uint8Array, needle: string, from: number): number {
  const n = latin1(needle);
  for (let i = from; i <= haystack.length - n.length; i++) { let ok = true; for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) { ok = false; break; } if (ok) return i; }
  return -1;
}

/** The next free object number: past both pdf-lib's objects and the file's own /Size (which counts cross-reference streams pdf-lib drops). */
export function nextObjectNumber(original: Uint8Array, pdf: PDFDocument): number {
  const startxref = findLast(original, 'startxref');
  const prev = Number(/startxref\s+(\d+)/.exec(new TextDecoder('latin1').decode(original.subarray(startxref, startxref + 40)))?.[1] ?? 0);
  const tail = new TextDecoder('latin1').decode(original.subarray(prev, Math.min(original.length, prev + 4096)));
  const size = Number(/\/Size\s+(\d+)/.exec(tail)?.[1] ?? 0);
  return Math.max(pdf.context.largestObjectNumber + 1, size);
}

/** Appends one incremental update holding `objects` (number -> body bytes), in the cross-reference style of the original. */
export function appendUpdate(original: Uint8Array, pdf: PDFDocument, objects: Map<number, Uint8Array>): Uint8Array {
  const startxref = findLast(original, 'startxref');
  if (startxref < 0) throw new Error('This PDF has no cross-reference position, so it cannot be signed incrementally.');
  const prev = Number(/startxref\s+(\d+)/.exec(new TextDecoder('latin1').decode(original.subarray(startxref, startxref + 40)))?.[1]);
  if (!Number.isSafeInteger(prev)) throw new Error('This PDF has a damaged cross-reference position.');
  const streamXref = !new TextDecoder('latin1').decode(original.subarray(prev, prev + 4)).startsWith('xref');
  const parts: Uint8Array[] = [original, original[original.length - 1] === 0x0a ? new Uint8Array() : enc.encode('\n')];
  let at = parts.reduce((n, p) => n + p.length, 0);
  const offsets = new Map<number, number>();
  for (const [number, body] of [...objects].sort((a, b) => a[0] - b[0])) {
    const head = enc.encode(`${number} 0 obj\n`); const tail = enc.encode('\nendobj\n');
    offsets.set(number, at); parts.push(head, body, tail); at += head.length + body.length + tail.length;
  }
  const info = pdf.context.trailerInfo;
  const oldId = info.ID instanceof PDFArray ? info.ID.get(0) : undefined;
  const first = oldId instanceof PDFHexString || oldId instanceof PDFString ? oldId.toString() : `<${hex(globalThis.crypto.getRandomValues(new Uint8Array(16)))}>`;
  const id = `[${first} <${hex(globalThis.crypto.getRandomValues(new Uint8Array(16)))}>]`;
  const size = Math.max(nextObjectNumber(original, pdf), ...[...objects.keys()].map((n) => n + 1));
  const root = `/Root ${info.Root!.toString()}${info.Info ? ` /Info ${info.Info.toString()}` : ''}`;
  const numbers = [...offsets.keys()].sort((a, b) => a - b);
  if (streamXref) {
    const xrefNumber = size; const rows: number[] = [];
    const entries = [...numbers.map((n) => [n, offsets.get(n)!] as [number, number]), [xrefNumber, at] as [number, number]];
    for (const [, offset] of entries) rows.push(1, (offset >>> 24) & 255, (offset >>> 16) & 255, (offset >>> 8) & 255, offset & 255, 0, 0);
    const index = entries.map(([n]) => `${n} 1`).join(' ');
    const data = Uint8Array.from(rows);
    const head = enc.encode(`${xrefNumber} 0 obj\n<< /Type /XRef /Size ${xrefNumber + 1} /W [1 4 2] /Index [${index}] /Prev ${prev} ${root} /ID ${id} /Length ${data.length} >>\nstream\n`);
    parts.push(head, data, enc.encode(`\nendstream\nendobj\nstartxref\n${at}\n%%EOF\n`));
  } else {
    let table = 'xref\n';
    for (const n of numbers) table += `${n} 1\n${String(offsets.get(n)!).padStart(10, '0')} 00000 n\r\n`;
    table += `trailer\n<< /Size ${size} /Prev ${prev} ${root} /ID ${id} >>\nstartxref\n${at}\n%%EOF\n`;
    parts.push(enc.encode(table));
  }
  return concatBytes(...parts);
}

/** Adds a signature field (and its widget) and returns the update with placeholders, ready to fill. */
function prepareSignature(bytes: Uint8Array, pdf: PDFDocument, kind: 'signature' | 'timestamp', options: SignOptions, signerName: string, extra?: (catalog: PDFDict) => void): Uint8Array {
  const ctx = pdf.context;
  let next = nextObjectNumber(bytes, pdf);
  const objects = new Map<number, Uint8Array>();
  const now = options.now ?? new Date();
  const sigNumber = next++; const widgetNumber = next++;
  const sigDict = kind === 'signature'
    ? `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 0000000000 0000000000 0000000000] /Contents <${'0'.repeat(CONTENTS_BYTES * 2)}> /M (${pdfDate(now)}) /Name ${text(signerName)}${options.reason ? ` /Reason ${text(options.reason)}` : ''}${options.location ? ` /Location ${text(options.location)}` : ''}${options.contactInfo ? ` /ContactInfo ${text(options.contactInfo)}` : ''} /Prop_Build << /App << /Name /MALENJO >> >> >>`
    : `<< /Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161 /ByteRange [0 0000000000 0000000000 0000000000] /Contents <${'0'.repeat(CONTENTS_BYTES * 2)}> >>`;
  objects.set(sigNumber, enc.encode(sigDict));
  // A unique field name.
  const form = pdf.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  const fieldsObject = form?.get(N('Fields'));
  const fields = fieldsObject ? ctx.lookup(fieldsObject) as PDFArray | undefined : undefined;
  const names = new Set((fields?.asArray() ?? []).map((r) => { const d = ctx.lookup(r); const t = d instanceof PDFDict ? d.lookup(N('T')) : undefined; return t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : ''; }));
  const base = kind === 'signature' ? 'Signature' : 'DocumentTimestamp';
  let k = 1; while (names.has(`${base}${k}`)) k++;
  const pageIndex = options.appearance && kind === 'signature' ? options.appearance.pageNumber - 1 : 0;
  if (pageIndex < 0 || pageIndex >= pdf.getPageCount()) throw new Error('The signature box is on a page that is not in this PDF.');
  const page = pdf.getPage(pageIndex);
  const box = kind === 'signature' && options.appearance ? options.appearance.box : [0, 0, 0, 0];
  let ap = '';
  if (box[2] - box[0] > 1 && box[3] - box[1] > 1) {
    const w = box[2] - box[0], h = box[3] - box[1];
    const lines = [`Digitally signed by ${signerName}`, `Date: ${now.toISOString().replace('T', ' ').slice(0, 19)} UTC`, ...(options.reason ? [`Reason: ${options.reason}`] : []), ...(options.location ? [`Location: ${options.location}`] : [])];
    const size = Math.max(5, Math.min(10, (h - 6) / (lines.length * 1.25), ...lines.map((l) => (w - 8) / (l.length * 0.5))));
    const esc = (s: string) => [...s].map((c) => (c.charCodeAt(0) > 255 ? '?' : c)).join('').replace(/[\\()]/g, (m) => `\\${m}`);
    const stream = `0.15 0.35 0.75 RG 1 w 0.5 0.5 ${w - 1} ${h - 1} re S BT /Helv ${size.toFixed(2)} Tf 0.1 0.1 0.15 rg ${lines.map((l, i) => `1 0 0 1 4 ${(h - 4 - size * (i + 1) * 1.2).toFixed(2)} Tm (${esc(l)}) Tj`).join(' ')} ET`;
    const apNumber = next++;
    objects.set(apNumber, concatBytes(enc.encode(`<< /Type /XObject /Subtype /Form /BBox [0 0 ${w} ${h}] /Resources << /Font << /Helv << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> >> >> /Length ${latin1(stream).length} >>\nstream\n`), latin1(stream), enc.encode('\nendstream')));
    ap = ` /AP << /N ${apNumber} 0 R >>`;
  }
  objects.set(widgetNumber, enc.encode(`<< /Type /Annot /Subtype /Widget /FT /Sig /T ${text(`${base}${k}`)} /V ${sigNumber} 0 R /F 132 /Rect [${box.join(' ')}] /P ${page.ref.toString()}${ap} >>`));
  const widgetRef = PDFRef.of(widgetNumber);
  // The page's annotation list and the form's field list gain the widget.
  const annots = page.node.get(N('Annots'));
  if (annots instanceof PDFRef) { const list = ctx.lookup(annots) as PDFArray; list.push(widgetRef); objects.set(annots.objectNumber, serialize(list)); }
  else { if (annots instanceof PDFArray) annots.push(widgetRef); else page.node.set(N('Annots'), ctx.obj([widgetRef])); objects.set(page.ref.objectNumber, serialize(page.node)); }
  const catalogRef = ctx.trailerInfo.Root as PDFRef;
  let catalogChanged = !!extra;
  if (fieldsObject instanceof PDFRef) { fields!.push(widgetRef); objects.set(fieldsObject.objectNumber, serialize(fields!)); }
  else if (form) { if (fields) fields.push(widgetRef); else form.set(N('Fields'), ctx.obj([widgetRef])); }
  if (form) {
    form.set(N('SigFlags'), PDFNumber.of(3));
    const formRef = pdf.catalog.get(N('AcroForm'));
    if (formRef instanceof PDFRef) objects.set(formRef.objectNumber, serialize(form)); else catalogChanged = true;
  } else { pdf.catalog.set(N('AcroForm'), ctx.obj({ Fields: [widgetRef], SigFlags: 3 })); catalogChanged = true; }
  extra?.(pdf.catalog);
  if (catalogChanged) objects.set(catalogRef.objectNumber, serialize(pdf.catalog));
  return appendUpdate(bytes, pdf, objects);
}

/** Fills the byte range and returns the signed bytes' digest location. */
function placeholders(bytes: Uint8Array): { start: number; end: number; rangeAt: number } {
  const rangeAt = findLast(bytes, '/ByteRange [0 0000000000 0000000000 0000000000]');
  const start = findFrom(bytes, '/Contents <', rangeAt) + '/Contents '.length;
  const end = findFrom(bytes, '>', start) + 1;
  if (rangeAt < 0 || start < rangeAt || end <= start) throw new Error('The signature placeholder could not be found.');
  const range = `[0 ${start} ${end} ${bytes.length - end}]`;
  const slot = '[0 0000000000 0000000000 0000000000]';
  bytes.set(latin1(range.padEnd(slot.length, ' ')), rangeAt + '/ByteRange '.length);
  return { start, end, rangeAt };
}
async function fill(bytes: Uint8Array, sign: (digest: Uint8Array, signed: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  const { start, end } = placeholders(bytes);
  const signed = concatBytes(bytes.subarray(0, start), bytes.subarray(end));
  const signature = await sign(await sha256(signed), signed);
  const encoded = hex(signature);
  if (encoded.length > CONTENTS_BYTES * 2) throw new Error('The signature is larger than the space reserved for it.');
  bytes.set(latin1(encoded), start + 1);
  return bytes;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); } catch (error) {
    if (/encrypt/i.test(String(error))) throw new Error('This PDF is password-protected. Remove its protection before signing, or sign a copy.');
    throw new Error('This PDF could not be read because it is invalid or damaged.');
  }
}

/** Certificates and CRLs needed to validate `certs` (each CRL fetched from the certificate's distribution point). */
async function revocationData(certs: Certificate[], transport: Transport, when: Date): Promise<{ certs: Certificate[]; crls: Crl[] }> {
  const crls: Crl[] = [];
  for (const cert of certs) {
    if (selfIssued(cert)) continue;
    const issuer = certs.find((c) => issuedBy(cert, c));
    if (!issuer) throw new Error(`The issuer certificate of ${commonName(cert)} is missing, so its revocation cannot be checked.`);
    if (!cert.crlUrls.length) throw new Error(`${commonName(cert)} names no revocation list (CRL), which PAdES B-LT needs. Choose B-T instead.`);
    let crl: Crl | null = null;
    for (const url of cert.crlUrls.filter((u) => /^https?:\/\//i.test(u))) {
      try { crl = parseCrl(await transport({ method: 'GET', url })); break; } catch { /* try the next distribution point */ }
    }
    if (!crl) throw new Error(`The revocation list for ${commonName(cert)} could not be downloaded from ${cert.crlUrls.join(', ')}.`);
    if (!equalBytes(crl.issuer, issuer.subject.bytes) || !(await verifyWith(issuer, crl.sigAlg, crl.signature, crl.tbs))) throw new Error(`The revocation list for ${commonName(cert)} is not signed by its issuer.`);
    if (crl.revoked.some((r) => equalBytes(r.serial, cert.serial) && r.date <= when)) throw new Error(`${commonName(cert)} has been revoked; it cannot be used to sign.`);
    if (!crls.some((c) => equalBytes(c.der, crl!.der))) crls.push(crl);
  }
  return { certs, crls };
}
function addDss(pdf: PDFDocument, certs: Certificate[], crls: Crl[]) {
  return (catalog: PDFDict) => {
    const ctx = pdf.context;
    const existing = catalog.lookupMaybe(N('DSS'), PDFDict);
    const stream = (der: Uint8Array) => ctx.register(ctx.flateStream(der));
    const list = (key: string, items: Uint8Array[]) => { const old = existing?.lookupMaybe(N(key), PDFArray)?.asArray() ?? []; return ctx.obj([...old, ...items.map(stream)]); };
    catalog.set(N('DSS'), ctx.obj({ Type: 'DSS', Certs: list('Certs', certs.map((c) => c.der)), CRLs: list('CRLs', crls.map((c) => c.der)) }));
    catalog.set(N('Extensions'), ctx.obj({ ESIC: { BaseVersion: N('1.7'), ExtensionLevel: 2 } }));
  };
}

export async function signPdf(bytes: Uint8Array, identity: SigningIdentity, options: SignOptions): Promise<{ bytes: Uint8Array; level: PadesProfile }> {
  const now = options.now ?? new Date();
  const transport = options.transport ?? fetchTransport;
  const needsTsa = options.profile !== 'B-B';
  if (needsTsa && !options.tsaUrl) throw new Error('PAdES B-T and above need a timestamp authority address.');
  if (now < identity.certificate.notBefore || now > identity.certificate.notAfter) throw new Error(`The signing certificate is not valid now (valid ${identity.certificate.notBefore.toISOString().slice(0, 10)} to ${identity.certificate.notAfter.toISOString().slice(0, 10)}).`);
  const signer = identity.certificate;
  if (((signer.keyUsage >> 15) & 1) === 0 && ((signer.keyUsage >> 14) & 1) === 0 && signer.keyUsage !== 0) throw new Error('This certificate is not allowed to make digital signatures.');
  // Revocation is checked before signing for B-LT and B-LTA, so a revoked certificate never produces a signature.
  const chain = [signer, ...identity.chain];
  const revocation = options.profile === 'B-LT' || options.profile === 'B-LTA' ? await revocationData(chain, transport, now) : null;
  const pdf = await load(bytes);
  let out = prepareSignature(Uint8Array.from(bytes), pdf, 'signature', { ...options, now }, commonName(signer));
  let tsaChain: Certificate[] = [];
  out = await fill(out, async (digest) => {
    const cms = await buildSignedData(identity, digest);
    if (!needsTsa) return cms.der;
    const token = await requestTimestamp(options.tsaUrl!, cms.signature, transport);
    tsaChain = parseSignedData(token).certificates;
    return cms.addUnsigned([timestampAttribute(token)]);
  });
  if (!revocation) return { bytes: out, level: options.profile };
  // B-LT: the Document Security Store, in a second incremental update.
  const tsaRevocation = await revocationData(tsaChain, transport, now);
  const certs = [...revocation.certs, ...tsaChain].filter((c, i, all) => all.findIndex((x) => equalBytes(x.der, c.der)) === i);
  out = await appendDss(out, certs, [...revocation.crls, ...tsaRevocation.crls]);
  if (options.profile === 'B-LT') return { bytes: out, level: 'B-LT' };
  // B-LTA: a document timestamp over the signature and its validation data.
  const ltaPdf = await load(out);
  let lta = prepareSignature(out, ltaPdf, 'timestamp', { ...options, now, appearance: null }, 'Document timestamp');
  lta = await fill(lta, async (_digest, signed) => requestTimestamp(options.tsaUrl!, signed, transport));
  return { bytes: lta, level: 'B-LTA' };
}

/** A DSS update: certificate and CRL streams plus the new catalog. */
async function appendDss(bytes: Uint8Array, certs: Certificate[], crls: Crl[]): Promise<Uint8Array> {
  const pdf = await load(bytes);
  const ctx = pdf.context;
  const first = nextObjectNumber(bytes, pdf);
  // Make pdf-lib number the new streams past the file's /Size.
  while (ctx.largestObjectNumber + 1 < first) ctx.nextRef();
  addDss(pdf, certs, crls)(pdf.catalog);
  const objects = new Map<number, Uint8Array>();
  for (const [ref, object] of ctx.enumerateIndirectObjects()) if (ref.objectNumber >= first) objects.set(ref.objectNumber, serialize(object));
  objects.set((ctx.trailerInfo.Root as PDFRef).objectNumber, serialize(pdf.catalog));
  return appendUpdate(bytes, pdf, objects);
}
