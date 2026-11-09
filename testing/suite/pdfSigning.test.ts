import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readPkcs12, Pkcs12PasswordError } from '../../src/suite/pdf/signing/pkcs12';
import { signPdf, type PadesProfile } from '../../src/suite/pdf/signing/pdfSign';
import { opensslTransport, opensslVerify, pki, pyhankoValidate } from './signingHelpers';

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
    it(`signs at PAdES ${profile} (${objectStreams ? 'cross-reference stream' : 'classic cross-reference'}, ${p12}), verified by OpenSSL and pyHanko`, async () => {
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
});
