import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { inspectPdfProtection, unlockPdf } from '../../src/suite/pdf/security/pdfDecrypt';

// Files encrypted by qpdf (through pikepdf): an independent producer of AES-256 (revision 6) protection.
const fixture = (name: string) => new Uint8Array(readFileSync(`testing/suite/fixtures/pdf/${name}`));
async function read(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice() } as never);
  const doc = await loading.promise;
  try { return { pages: doc.numPages }; } finally { await loading.destroy(); }
}

describe('Unlock PDF (MAL-062) on files protected by qpdf', () => {
  it('removes AES-256 protection written by qpdf, with the owner password', async () => {
    const protectedPdf = fixture('encrypted-user-password.pdf');
    expect(await inspectPdfProtection(protectedPdf)).toMatchObject({ encrypted: true, method: 'AES-256', opensWithoutPassword: false });
    await expect(unlockPdf(protectedPdf, 'nope')).rejects.toThrow(/Incorrect password/);
    const result = await unlockPdf(protectedPdf, 'owner');
    expect(result).toMatchObject({ authenticatedAs: 'owner', method: 'AES-256' });
    expect((await read(result.bytes)).pages).toBe(3);
    expect((await inspectPdfProtection(result.bytes)).encrypted).toBe(false);
  });

  it('needs the owner password when the open password does not grant every permission', async () => {
    await expect(unlockPdf(fixture('encrypted-user-password.pdf'), 'secret')).rejects.toThrow(/needs the owner \(permissions\) password/);
    const restricted = fixture('encrypted-owner-restricted.pdf');
    expect(await inspectPdfProtection(restricted)).toMatchObject({ opensWithoutPassword: true, permissions: { modify: false, copy: false } });
    await expect(unlockPdf(restricted, '')).rejects.toThrow(/owner/);
    expect((await read((await unlockPdf(restricted, 'owner')).bytes)).pages).toBe(3);
  });

});
