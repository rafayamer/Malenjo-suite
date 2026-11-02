import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { describePdfError, ENCRYPTED_EDIT_MESSAGE, isEncryptedPdfError, looksEncryptedPdf } from './pdfUserErrors';

describe('plain-language PDF errors', () => {
  it('replaces the pdf-lib encryption error with an actionable message', () => {
    // Exact pdf-lib 1.17 EncryptedPDFError text; the real-file case is in
    // testing/suite/pdfEncryptedFixtures.test.ts.
    const failure = Object.assign(new Error('Input document to `PDFDocument.load` is encrypted. You can use `PDFDocument.load(..., { ignoreEncryption: true })` if you wish to load the document anyways.'), { name: 'EncryptedPDFError' });
    expect(isEncryptedPdfError(failure)).toBe(true);
    const message = describePdfError(failure);
    expect(message).toBe(ENCRYPTED_EDIT_MESSAGE);
    expect(message).not.toMatch(/ignoreEncryption|PDFDocument\.load/);
  });

  it('explains invalid PDFs without library jargon', () => {
    const invalid = Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' });
    expect(describePdfError(invalid)).toMatch(/not a valid PDF/);
    expect(describePdfError(new Error('Failed to parse PDF document: No PDF header found'))).toMatch(/not a valid PDF/);
  });

  it('keeps ordinary MALENJO messages and handles non-Error values', () => {
    expect(describePdfError(new Error('Choose at least one page.'))).toBe('Choose at least one page.');
    expect(describePdfError('plain text')).toBe('plain text');
    expect(describePdfError({ name: 'PasswordException', message: 'No password given' })).toMatch(/password-protected/);
  });
});

describe('encrypted PDF detection', () => {
  it('detects an /Encrypt trailer entry in small files', () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << /Root 1 0 R /Encrypt << /Filter /Standard /V 5 >> >>\n%%EOF');
    expect(looksEncryptedPdf(bytes)).toBe(true);
  });

  it('does not flag ordinary PDFs, including text that mentions /Encrypt', async () => {
    const plain = await PDFDocument.create();
    plain.addPage().drawText('Docs about the /Encrypt key and /EncryptMetadata');
    expect(looksEncryptedPdf(await plain.save({ useObjectStreams: false }))).toBe(false);
  });

  it('scans the tail of large files where the trailer lives', () => {
    const big = new Uint8Array(2 * 1024 * 1024);
    const trailer = new TextEncoder().encode('trailer << /Size 9 /Root 1 0 R /Encrypt 7 0 R >>');
    big.set(trailer, big.length - trailer.length - 10);
    expect(looksEncryptedPdf(big)).toBe(true);
    big.fill(0, big.length - trailer.length - 10);
    expect(looksEncryptedPdf(big)).toBe(false);
  });

  it('ignores /Encrypt text outside the trailer (metadata, comments, content streams)', () => {
    const pdf = [
      '%PDF-1.7',
      '% /Encrypt 7 0 R in a comment',
      '1 0 obj << /Type /Catalog >> endobj',
      '2 0 obj << /Subject (Documentation for /Encrypt 7 0 R) /Keywords <2F456E6372797074> >> endobj',
      '3 0 obj << /Length 30 >> stream\nBT (/Encrypt << >>) Tj ET\nendstream endobj',
      'trailer << /Size 4 /Root 1 0 R /Info 2 0 R /ID [<00ff><00ff>] >>',
      '%%EOF',
    ].join('\n');
    expect(looksEncryptedPdf(new TextEncoder().encode(pdf))).toBe(false);
  });

  it('ignores /Encrypt nested inside another trailer value', () => {
    const pdf = '%PDF-1.7\ntrailer << /Root 1 0 R /Extra << /Encrypt 7 0 R >> >>\n%%EOF';
    expect(looksEncryptedPdf(new TextEncoder().encode(pdf))).toBe(false);
  });

  it('detects /Encrypt in a cross-reference stream dictionary', () => {
    const pdf = '%PDF-1.7\n9 0 obj << /Type /XRef /Size 10 /Root 1 0 R /Encrypt 8 0 R /W [1 2 1] /Length 0 >> stream\nendstream endobj\n%%EOF';
    expect(looksEncryptedPdf(new TextEncoder().encode(pdf))).toBe(true);
  });
});
