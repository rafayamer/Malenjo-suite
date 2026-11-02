import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { describePdfError, ENCRYPTED_EDIT_MESSAGE, looksEncryptedPdf } from '../../src/suite/pdf/pdfUserErrors';

const fixture = (name: string) => new Uint8Array(readFileSync(`testing/suite/fixtures/pdf/${name}`));

describe('encrypted PDF fixtures (real AES-256 files)', () => {
  it('are detected as encrypted', () => {
    expect(looksEncryptedPdf(fixture('encrypted-user-password.pdf'))).toBe(true);
    expect(looksEncryptedPdf(fixture('encrypted-owner-restricted.pdf'))).toBe(true);
  });

  it('turn the real pdf-lib edit failure into the plain-language message', async () => {
    for (const name of ['encrypted-user-password.pdf', 'encrypted-owner-restricted.pdf']) {
      const failure = await PDFDocument.load(fixture(name)).then(() => null, (reason: unknown) => reason);
      expect(failure, name).not.toBeNull();
      expect(describePdfError(failure)).toBe(ENCRYPTED_EDIT_MESSAGE);
    }
  });
});
