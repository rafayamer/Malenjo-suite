/**
 * Signature validation (MAL-065): for every signature in a PDF — integrity of the signed bytes, the signer's
 * certificate chain against the trusted certificates you choose, the signature timestamp, revocation from the
 * embedded Document Security Store, what changed after signing, and the PAdES level the signature reaches.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import { OID, child, concatBytes, equalBytes, oidToString, parseDer } from './asn1';
import { digestOf, parseCrl, parseSignedData, verifySigner, verifyTimestampToken, type Crl, type TimestampInfo } from './cms';
import { buildChain, commonName, parseCertificate, verifyWith, type Certificate } from './x509';

export type ChangeKind = 'none' | 'signature-maintenance' | 'modified';
export interface SignatureReport {
  field: string; kind: 'signature' | 'document-timestamp'; subFilter: string; signer: string; signedAt: Date | null;
  integrity: boolean; certificateTrusted: boolean; chain: string[]; problems: string[];
  timestamp: (TimestampInfo & { trusted: boolean }) | null; revocation: 'not-revoked' | 'revoked' | 'no-data';
  coverage: 'whole-file' | 'later-updates'; changes: ChangeKind; level: string; reason?: string; location?: string;
  /** Overall: valid, valid but untrusted (or with changes), or invalid. */
  status: 'valid' | 'warning' | 'invalid';
}

const N = PDFName.of;
const str = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : undefined);
function pdfDate(s?: string): Date | null {
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s ?? '');
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  const offset = m[7] === '+' || m[7] === '-' ? (m[7] === '+' ? 1 : -1) * (Number(m[8] ?? 0) * 60 + Number(m[9] ?? 0)) : 0;
  return new Date(utc - offset * 60000);
}

/** The text of every page's content, and its annotations other than signature widgets: what a change would show. */
async function fingerprint(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  return pdf.getPages().map((page) => {
    const contents = page.node.Contents();
    const parts = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
    const body = parts.map((p) => { try { return p instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(p).decode()) : ''; } catch { return '?'; } }).join('\n');
    const annots = (page.node.lookupMaybe(N('Annots'), PDFArray)?.asArray() ?? []).map((r) => pdf.context.lookup(r)).filter((a): a is PDFDict => a instanceof PDFDict)
      .filter((a) => !(a.get(N('Subtype'))?.toString() === '/Widget' && (a.get(N('FT'))?.toString() === '/Sig')))
      .map((a) => `${a.get(N('Subtype'))}${str(a.lookup(N('Contents'))) ?? ''}${a.lookup(N('V'))?.toString() ?? ''}`);
    return `${body}\u0000${annots.join('|')}`;
  });
}

export async function verifyPdfSignatures(bytes: Uint8Array, trusted: Certificate[], now = new Date()): Promise<SignatureReport[]> {
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true }); } catch { throw new Error('This PDF could not be read because it is invalid or damaged.'); }
  const ctx = pdf.context;
  // Revocation data and extra certificates from the Document Security Store.
  const dss = pdf.catalog.lookupMaybe(N('DSS'), PDFDict);
  const dssStreams = (key: string) => (dss?.lookupMaybe(N(key), PDFArray)?.asArray() ?? []).map((r) => ctx.lookup(r)).filter((s): s is PDFRawStream => s instanceof PDFRawStream).map((s) => decodePDFRawStream(s).decode());
  const dssCerts = dssStreams('Certs').flatMap((d) => { try { return [parseCertificate(d)]; } catch { return []; } });
  const dssCrls = dssStreams('CRLs').flatMap((d) => { try { return [parseCrl(d)]; } catch { return []; } });
  const hasOcsp = dssStreams('OCSPs').length > 0;
  // Signature fields, wherever they sit in the field tree.
  const fields: { name: string; value: PDFDict }[] = [];
  const walk = (refs: PDFArray | undefined, prefix: string, depth: number) => {
    for (const ref of refs?.asArray() ?? []) {
      const field = ctx.lookup(ref);
      if (!(field instanceof PDFDict) || depth > 32) continue;
      const name = [prefix, str(field.lookup(N('T')))].filter(Boolean).join('.');
      const value = field.lookup(N('V'));
      if (field.get(N('FT'))?.toString() === '/Sig' && value instanceof PDFDict) fields.push({ name, value });
      walk(field.lookupMaybe(N('Kids'), PDFArray), name, depth + 1);
    }
  };
  walk(pdf.catalog.lookupMaybe(N('AcroForm'), PDFDict)?.lookupMaybe(N('Fields'), PDFArray), '', 0);
  const reports: SignatureReport[] = [];
  const documentTimestamps: { end: number; info: TimestampInfo }[] = [];

  for (const { name, value } of fields) {
    const range = value.lookupMaybe(N('ByteRange'), PDFArray)?.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : -1)) ?? [];
    const subFilter = value.get(N('SubFilter'))?.toString().slice(1) ?? '';
    const kind = subFilter === 'ETSI.RFC3161' ? 'document-timestamp' : 'signature';
    const report: SignatureReport = { field: name, kind, subFilter, signer: '', signedAt: pdfDate(str(value.lookup(N('M')))), integrity: false, certificateTrusted: false, chain: [], problems: [],
      timestamp: null, revocation: 'no-data', coverage: 'whole-file', changes: 'none', level: '', reason: str(value.lookup(N('Reason'))), location: str(value.lookup(N('Location'))), status: 'invalid' };
    reports.push(report);
    const [a, b, c, d] = range;
    if (range.length !== 4 || a !== 0 || !(b > 0 && c > b && d >= 0) || c + d > bytes.length || bytes[b] !== 0x3c || bytes[c - 1] !== 0x3e) { report.problems.push('The signed byte range is malformed.'); continue; }
    const signed = concatBytes(bytes.subarray(0, b), bytes.subarray(c, c + d));
    const hexText = new TextDecoder('latin1').decode(bytes.subarray(b + 1, c - 1)).replace(/\s+/g, '');
    if (!/^[0-9a-fA-F]*$/.test(hexText)) { report.problems.push('The signature contents are not hexadecimal.'); continue; }
    const raw = Uint8Array.from(hexText.match(/../g) ?? [], (h) => parseInt(h, 16));
    let der: Uint8Array;
    try { der = parseDer(raw).bytes; } catch { report.problems.push('The signature container is damaged.'); continue; }
    report.coverage = c + d === bytes.length ? 'whole-file' : 'later-updates';
    if (report.coverage === 'later-updates') {
      try {
        const before = await fingerprint(bytes.subarray(0, c + d)); const after = await fingerprint(bytes);
        report.changes = before.length === after.length && before.every((f, i) => f === after[i]) ? 'signature-maintenance' : 'modified';
      } catch { report.changes = 'modified'; }
      if (report.changes === 'modified') report.problems.push('The document was changed after this signature (pages, text or annotations differ).');
    }
    try {
      const sd = parseSignedData(der);
      const signer = sd.signers[0];
      if (!signer) { report.problems.push('The signature has no signer.'); continue; }
      if (kind === 'document-timestamp') {
        const info = await verifyTimestampToken(der, signed);
        report.integrity = info.signatureOk && !info.problems.length; report.problems.push(...info.problems);
        report.signer = info.tsa ? commonName(info.tsa) : 'unknown timestamp authority'; report.signedAt = info.time;
        const chain = info.tsa ? await buildChain(info.tsa, [...sd.certificates, ...dssCerts], trusted, info.time) : null;
        report.certificateTrusted = !!chain?.trusted; report.chain = chain?.chain.map(commonName) ?? []; report.problems.push(...(chain?.problems ?? []));
        report.timestamp = { ...info, trusted: report.certificateTrusted };
        documentTimestamps.push({ end: c + d, info });
      } else {
        const result = await verifySigner(sd, signer, await digestOf(signer.digestAlg, signed));
        report.integrity = result.digestOk && result.signatureOk;
        if (!result.digestOk) report.problems.push('The signed bytes do not match the signature (the document was altered).');
        else if (!result.signatureOk) report.problems.push('The signature value does not verify with the signer’s certificate.');
        const cert = result.certificate;
        if (!cert) { report.problems.push('The signer’s certificate is not in the signature.'); continue; }
        report.signer = commonName(cert);
        const token = signer.unsigned.find((u) => oidToString(child(u, 0)) === OID.timeStampToken)?.children[1]?.children[0];
        if (token) {
          const info = await verifyTimestampToken(token.bytes, signer.signature);
          const tsaChain = info.tsa ? await buildChain(info.tsa, [...parseSignedData(token.bytes).certificates, ...dssCerts], trusted, info.time) : null;
          report.timestamp = { ...info, trusted: !!tsaChain?.trusted && info.signatureOk && !info.problems.length };
          if (!info.signatureOk || info.problems.length) report.problems.push(`The signature timestamp does not verify${info.problems.length ? `: ${info.problems.join(' ')}` : '.'}`);
          else if (!tsaChain?.trusted) report.problems.push(...(tsaChain?.problems ?? []).map((p) => `Timestamp: ${p}`));
        }
        const when = report.timestamp?.trusted ? report.timestamp.time : report.signedAt ?? now;
        const chain = await buildChain(cert, [...sd.certificates, ...dssCerts], trusted, when);
        report.certificateTrusted = chain.trusted; report.chain = chain.chain.map(commonName); report.problems.push(...chain.problems);
        report.revocation = await revocationStatus(chain.chain, dssCrls, when);
        if (report.revocation === 'revoked') { report.problems.push('The signer’s certificate was revoked before the signing time.'); report.certificateTrusted = false; }
        const essOk = !!signer.attr(OID.signingCertificateV2) && !signer.attr(OID.signingTime);
        const cades = subFilter === 'ETSI.CAdES.detached' && essOk;
        const lt = (dssCrls.length > 0 || hasOcsp) && report.revocation === 'not-revoked';
        report.level = !cades ? (subFilter === 'adbe.pkcs7.detached' ? 'PKCS#7 (not PAdES)' : subFilter) : !report.timestamp ? 'PAdES B-B' : !lt ? 'PAdES B-T' : 'PAdES B-LT';
      }
    } catch (error) { report.problems.push(`The signature could not be read: ${error instanceof Error ? error.message : String(error)}`); }
  }
  // B-LTA: a valid document timestamp after the signature, covering its validation data.
  for (const r of reports) {
    if (r.level === 'PAdES B-LT' && documentTimestamps.some((t) => t.info.signatureOk && !t.info.problems.length)) r.level = 'PAdES B-LTA';
    r.status = !r.integrity || r.changes === 'modified' ? 'invalid' : r.certificateTrusted && (!r.timestamp || r.timestamp.trusted) && r.revocation !== 'revoked' ? 'valid' : 'warning';
    if (r.kind === 'document-timestamp' && r.level === '') r.level = 'Document timestamp';
  }
  return reports;
}

async function revocationStatus(chain: Certificate[], crls: Crl[], when: Date): Promise<SignatureReport['revocation']> {
  let checked = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const cert = chain[i]; const issuer = chain[i + 1];
    const crl = crls.find((l) => equalBytes(l.issuer, issuer.subject.bytes));
    if (!crl || !(await verifyWith(issuer, crl.sigAlg, crl.signature, crl.tbs))) continue;
    if (crl.revoked.some((r) => equalBytes(r.serial, cert.serial) && r.date <= when)) return 'revoked';
    checked++;
  }
  return chain.length > 1 && checked === chain.length - 1 ? 'not-revoked' : 'no-data';
}
