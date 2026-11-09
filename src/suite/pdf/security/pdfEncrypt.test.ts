import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { md5, rc4 } from './pdfCrypto';
import { ALL_PERMISSIONS, permissionBits, permissionsFromBits, protectPdf } from './pdfEncrypt';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
async function sample() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([300, 200]).drawText('Confidential plan', { x: 20, y: 150, size: 14, font });
  pdf.setTitle('Secret title');
  return pdf.save();
}
async function open(bytes: Uint8Array, password?: string) {
  const loading = getDocument({ data: bytes.slice(), ...(password === undefined ? {} : { password }) } as never);
  const doc = await loading.promise;
  try {
    const text = ((await (await doc.getPage(1)).getTextContent()).items as { str: string }[]).map((i) => i.str).join('');
    return { text, permissions: await doc.getPermissions(), info: (await doc.getMetadata()).info as Record<string, unknown> };
  } finally { await loading.destroy(); }
}

describe('PDF crypto primitives', () => {
  it('computes MD5 and RC4 test vectors', () => {
    expect(hex(md5(new TextEncoder().encode('')))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex(md5(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')))).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(hex(rc4(new TextEncoder().encode('Key'), new TextEncoder().encode('Plaintext')))).toBe('bbf316e8d940af0ad3');
  });
});

describe('Protect PDF (MAL-061)', () => {
  it('encrypts with AES-256 so readers need a password, and reports the chosen permissions', async () => {
    const permissions = { ...ALL_PERMISSIONS, print: 'low' as const, copy: false, modify: false };
    const protectedPdf = await protectPdf(await sample(), { userPassword: 'open-me', ownerPassword: 'own-it', permissions });
    const raw = new TextDecoder('latin1').decode(protectedPdf);
    expect(raw).toMatch(/\/Filter\s*\/Standard/); expect(raw).toMatch(/\/V 5/); expect(raw).toMatch(/\/R 6/); expect(raw).toMatch(/\/CFM \/AESV3/);
    expect(raw).not.toContain('Confidential'); expect(raw).not.toContain('Secret title');
    await expect(open(protectedPdf)).rejects.toMatchObject({ name: 'PasswordException' });
    await expect(open(protectedPdf, 'wrong')).rejects.toMatchObject({ name: 'PasswordException' });
    const asUser = await open(protectedPdf, 'open-me');
    expect(asUser.text).toBe('Confidential plan');
    expect(asUser.info.Title).toBe('Secret title');
    expect(permissionsFromBits(permissionBits(permissions))).toEqual(permissions);
    // PDF.js reports the permission flags (bit positions) that are granted.
    expect(new Set(asUser.permissions as unknown as number[])).toEqual(new Set([4, 32, 256, 512, 1024]));
    expect((await open(protectedPdf, 'own-it')).text).toBe('Confidential plan');
  });

  it('protects without an open password: anyone can read, permissions still apply', async () => {
    const protectedPdf = await protectPdf(await sample(), { userPassword: '', ownerPassword: 'own-it', permissions: { ...ALL_PERMISSIONS, copy: false } });
    const read = await open(protectedPdf);
    expect(read.text).toBe('Confidential plan');
    expect(read.permissions).not.toContain(16);
  });

  it('refuses a missing or repeated owner password', async () => {
    await expect(protectPdf(await sample(), { userPassword: 'a', ownerPassword: '', permissions: ALL_PERMISSIONS })).rejects.toThrow(/owner password/);
    await expect(protectPdf(await sample(), { userPassword: 'a', ownerPassword: 'a', permissions: ALL_PERMISSIONS })).rejects.toThrow(/different owner password/);
  });
});

describe('AES-256 key derivation across many random salts', () => {
  it('always matches PDF.js (Algorithm 2.B stops on the right round)', async () => {
    // Each protection draws new salts, so the hash loop ends on varied rounds; every file must open and decode.
    for (let i = 0; i < 40; i++) {
      const protectedPdf = await protectPdf(await sample(), { userPassword: `user-${i}`, ownerPassword: `owner-${i}`, permissions: ALL_PERMISSIONS });
      expect((await open(protectedPdf, `user-${i}`)).text).toBe('Confidential plan');
    }
  }, 120000);
});
