import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readPkcs12, Pkcs12PasswordError } from '../../src/suite/pdf/signing/pkcs12';
import { appendUpdate, nextObjectNumber, serialize, signPdf, type PadesProfile } from '../../src/suite/pdf/signing/pdfSign';
import { verifyPdfSignatures } from '../../src/suite/pdf/signing/pdfVerify';
import { readCertificateFile } from '../../src/suite/pdf/signing/x509';
import { PDFName } from 'pdf-lib';
import { HAS_OPENSSL, opensslTransport, opensslVerify, pki, pyhankoValidate } from './signingHelpers';

async function doc(objectStreams: boolean) {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText('Agreement', { x: 72, y: 700, size: 18, font: await pdf.embedFont(StandardFonts.Helvetica) });
  return pdf.save({ useObjectStreams: objectStreams });
}
const TSA = 'http://127.0.0.1:47811/tsa';

describe('Certificate-based PDF signing (MAL-065)', () => {
  it('reads PKCS#12 identities and refuses a wrong password', async () => {
    const id = await readPkcs12(pki('signer.p12'), 'test-pass');
    expect(id.certificate.subjectName).toContain('CN=Dana Signer'); expect(id.keyType).toBe('RSA'); expect(id.chain.map((c) => c.subjectName)).toEqual(['CN=MALENJO Test Root CA, O=MALENJO Tests']);
    expect((await readPkcs12(pki('signer-ec.p12'), 'test-pass')).keyType).toBe('EC');
    await expect(readPkcs12(pki('signer.p12'), 'wrong')).rejects.toBeInstanceOf(Pkcs12PasswordError);
  });

  for (const [profile, objectStreams, p12] of [['B-B', false, 'signer.p12'], ['B-T', true, 'signer-ec.p12'], ['B-LT', true, 'signer.p12'], ['B-LTA', false, 'signer.p12']] as [PadesProfile, boolean, string][]) {
    it.skipIf(!HAS_OPENSSL)(`signs at PAdES ${profile} (${objectStreams ? 'cross-reference stream' : 'classic cross-reference'}, ${p12}), verified by OpenSSL and pyHanko`, async () => {
      const log: string[] = [];
      const identity = await readPkcs12(pki(p12), 'test-pass');
      const source = await doc(objectStreams);
      const { bytes } = await signPdf(source, identity, { profile, reason: 'Approval', location: 'Lahore', tsaUrl: TSA, transport: opensslTransport(log), appearance: { pageNumber: 1, box: [72, 600, 300, 660] } });
      expect(Buffer.from(bytes.subarray(0, source.length)).equals(Buffer.from(source))).toBe(true); // incremental: the original bytes are untouched
      expect(opensslVerify(bytes)).toBe('OK');
      expect(log.filter((l) => l.startsWith('POST')).length).toBe(profile === 'B-B' ? 0 : profile === 'B-LTA' ? 2 : 1);
      const report = pyhankoValidate(bytes, profile);
      if (report !== null) {
        expect(report).not.toMatch(/^FAILED/);
        expect(report).toMatch(/The signature is judged VALID\./); expect(report).toMatch(/The signer's certificate is trusted\./);
        expect(report).toMatch(profile === 'B-LT' || profile === 'B-LTA' ? /All modifications relate to signature maintenance/ : /The signature covers the entire file\./);
        expect(report).toMatch(/The signature is cryptographically sound/);
        if (profile !== 'B-B') { expect(report).toMatch(/The timestamp token is cryptographically sound/); expect(report).toMatch(/The TSA certificate is trusted/); }
      }
    });
  }

  it.skipIf(!HAS_OPENSSL)('validates signatures: level, trust, timestamps, revocation and changes after signing', async () => {
    const trusted = readCertificateFile(pki('ca.pem'));
    const identity = await readPkcs12(pki('signer.p12'), 'test-pass');
    const { bytes: lta } = await signPdf(await doc(true), identity, { profile: 'B-LTA', tsaUrl: TSA, transport: opensslTransport(), reason: 'Approval' });
    const [signature, archive] = await verifyPdfSignatures(lta, trusted);
    expect(signature).toMatchObject({ kind: 'signature', signer: 'Dana Signer', integrity: true, certificateTrusted: true, revocation: 'not-revoked', coverage: 'later-updates', changes: 'signature-maintenance', level: 'PAdES B-LTA', status: 'valid', reason: 'Approval' });
    expect(signature.chain).toEqual(['Dana Signer', 'MALENJO Test Root CA']); expect(signature.timestamp?.trusted).toBe(true);
    expect(archive).toMatchObject({ kind: 'document-timestamp', integrity: true, certificateTrusted: true, coverage: 'whole-file', status: 'valid', signer: 'MALENJO Test TSA' });
    // Not trusting the root: the signature is intact but untrusted.
    const [untrusted] = await verifyPdfSignatures(lta, []);
    expect(untrusted.status).toBe('warning'); expect(untrusted.problems).toContain('MALENJO Test Root CA is self-signed and not in your trusted certificates.');
    // A self-signed signer nobody trusts.
    const { bytes: rogue } = await signPdf(await doc(false), await readPkcs12(pki('rogue.p12'), 'test-pass'), { profile: 'B-B' });
    const [r] = await verifyPdfSignatures(rogue, trusted);
    expect(r).toMatchObject({ integrity: true, certificateTrusted: false, level: 'PAdES B-B', status: 'warning' });
    // One byte changed inside the signed range.
    const { bytes: bb } = await signPdf(await doc(false), identity, { profile: 'B-B' });
    const tampered = bb.slice();
    tampered[200] ^= 0x01;
    expect((await verifyPdfSignatures(tampered, trusted))[0]).toMatchObject({ integrity: false, status: 'invalid' });
    // A later incremental update that draws on the page.
    const later = await PDFDocument.load(bb);
    const page = later.getPage(0);
    const n = nextObjectNumber(bb, later);
    const contents = page.node.get(PDFName.of('Contents'))!;
    page.node.set(PDFName.of('Contents'), later.context.obj([contents, PDFName.of('X') as never]));
    const stream = later.context.stream('BT /F1 30 Tf 100 100 Td (Forged) Tj ET');
    const pageBody = new TextDecoder('latin1').decode(serialize(page.node)).replace('/X', `${n} 0 R`);
    const modified = appendUpdate(bb, later, new Map([[page.ref.objectNumber, new TextEncoder().encode(pageBody)], [n, serialize(stream)]]));
    expect((await verifyPdfSignatures(modified, trusted))[0]).toMatchObject({ integrity: true, coverage: 'later-updates', changes: 'modified', status: 'invalid' });
  });
});
