import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, StandardFonts, type PDFObject, PDFArray, PDFDict } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { aesEncrypt, concat, legacyFileKey, legacyObjectKey, md5, padPassword, rc4, randomBytes } from './pdfCrypto';
import { ALL_PERMISSIONS, permissionBits, protectPdf, toHex } from './pdfEncrypt';
import { inspectPdfProtection, unlockPdf } from './pdfDecrypt';

async function sample(text = 'Quarterly numbers') {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 200]).drawText(text, { x: 20, y: 150, size: 14, font: await pdf.embedFont(StandardFonts.Helvetica) });
  pdf.setTitle('Plan');
  return pdf.save({ useObjectStreams: false });
}
async function read(bytes: Uint8Array, password?: string) {
  const loading = getDocument({ data: bytes.slice(), ...(password === undefined ? {} : { password }) } as never);
  const doc = await loading.promise;
  try { return { pages: doc.numPages, text: ((await (await doc.getPage(1)).getTextContent()).items as { str: string }[]).map((i) => i.str).join(''), title: ((await doc.getMetadata()).info as { Title?: string }).Title }; }
  finally { await loading.destroy(); }
}

/** A revision 3 (RC4 128-bit) or 4 (AES-128) file, made with the legacy algorithms, for PDF.js to verify independently. */
async function legacyEncrypt(bytes: Uint8Array, user: string, owner: string, r: 3 | 4, p: number) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const id0 = randomBytes(16);
  // Algorithm 3 (O) and Algorithm 5 (U).
  let h = md5(padPassword(owner)); for (let i = 0; i < 50; i++) h = md5(h);
  let o = rc4(h.subarray(0, 16), padPassword(user)); for (let i = 1; i <= 19; i++) o = rc4(h.subarray(0, 16).map((b) => b ^ i), o);
  const q = { r, o, u: new Uint8Array(32), p, id0, lengthBytes: 16, encryptMetadata: true };
  const key = legacyFileKey(padPassword(user), q);
  let u = rc4(key, md5(concat(padPassword(''), id0)).subarray(0, 16));
  u = rc4(key, md5(concat(Uint8Array.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]), id0)));
  for (let i = 1; i <= 19; i++) u = rc4(key.map((b) => b ^ i), u);
  u = concat(u, new Uint8Array(16));
  const aes = r === 4;
  const enc = async (data: Uint8Array, num: number, gen: number) => { const k = legacyObjectKey(key, num, gen, aes); if (!aes) return rc4(k, data); const iv = randomBytes(16); return concat(iv, await aesEncrypt(k, iv, data)); };
  const walk = async (v: PDFObject, num: number, gen: number): Promise<PDFObject> => {
    if (v instanceof PDFString || v instanceof PDFHexString) return PDFHexString.of(toHex(await enc(v.asBytes(), num, gen)));
    if (v instanceof PDFArray) { for (let i = 0; i < v.size(); i++) v.set(i, await walk(v.get(i), num, gen)); return v; }
    if (v instanceof PDFDict) { for (const [k, x] of v.entries()) v.set(k, await walk(x, num, gen)); return v; }
    return v;
  };
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) { const data = await enc(obj.contents, ref.objectNumber, ref.generationNumber); const d = await walk(obj.dict, ref.objectNumber, ref.generationNumber) as PDFDict; d.set(PDFName.of('Length'), PDFNumber.of(data.length)); doc.context.assign(ref, PDFRawStream.of(d, data)); }
    else doc.context.assign(ref, await walk(obj, ref.objectNumber, ref.generationNumber));
  }
  const encrypt = doc.context.obj({ Filter: 'Standard', V: r === 4 ? 4 : 2, R: r, Length: 128, P: p, O: PDFHexString.of(toHex(o)), U: PDFHexString.of(toHex(u)),
    ...(aes ? { CF: { StdCF: { CFM: 'AESV2', AuthEvent: 'DocOpen', Length: 16 } }, StmF: 'StdCF', StrF: 'StdCF' } : {}) });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);
  doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of(toHex(id0)), PDFHexString.of(toHex(id0))]);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

describe('Unlock PDF (MAL-062)', () => {
  it('removes protection MALENJO wrote, keeping text and metadata; an unrestricted file unlocks with its open password', async () => {
    const restricted = await protectPdf(await sample(), { userPassword: 'u', ownerPassword: 'o', permissions: { ...ALL_PERMISSIONS, copy: false } });
    const opened = await read((await unlockPdf(restricted, 'o')).bytes);
    expect(opened).toMatchObject({ text: 'Quarterly numbers', title: 'Plan' });
    const open = await protectPdf(await sample(), { userPassword: 'u', ownerPassword: 'o', permissions: ALL_PERMISSIONS });
    expect((await unlockPdf(open, 'u')).authenticatedAs).toBe('user');
  });

  for (const r of [3, 4] as const) {
    it(`removes revision ${r} protection (${r === 3 ? 'RC4 128-bit' : 'AES-128'})`, async () => {
      const p = permissionBits({ ...ALL_PERMISSIONS, modify: false });
      const protectedPdf = await legacyEncrypt(await sample('Legacy text'), 'user', 'owner', r, p);
      // PDF.js reads it with either password: the legacy algorithms are verified independently.
      expect((await read(protectedPdf, 'user')).text).toBe('Legacy text');
      expect((await read(protectedPdf, 'owner')).text).toBe('Legacy text');
      expect(await inspectPdfProtection(protectedPdf)).toMatchObject({ method: r === 3 ? 'RC4 128-bit' : 'AES-128' });
      await expect(unlockPdf(protectedPdf, 'user')).rejects.toThrow(/owner/);
      const unlocked = await read((await unlockPdf(protectedPdf, 'owner')).bytes);
      expect(unlocked).toMatchObject({ text: 'Legacy text', title: 'Plan' });
    });
  }
});
