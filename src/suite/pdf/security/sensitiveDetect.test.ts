import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { redactPdf } from './pdfRedact';
import { customRule, detectSensitiveInformation, ibanValid, luhn, SENSITIVE_CATEGORIES } from './sensitiveDetect';

const LINES = [
  'Patient: Sarah Connor', 'Email: sarah.connor@example.com Phone: +1 415-555-0123', 'Card 4111 1111 1111 1111 and 4111 1111 1111 1112',
  'IBAN GB82 WEST 1234 5698 7654 32', 'SSN 123-45-6789 CNIC 35202-1234567-1', 'Address: 221 Baker Street, London NW1 6XE',
  'DOB: 12/03/1985', 'Reference ORD-7781', 'Invoice total 1234.56 on 2024-01-05 for the Annual Review',
];
async function sample() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([500, 400]);
  LINES.forEach((line, i) => page.drawText(line, { x: 20, y: 370 - i * 20, size: 11, font }));
  return pdf.save();
}

describe('Smart sensitive-information detection (MAL-064)', () => {
  it('checks card and IBAN check digits', () => {
    expect(luhn('4111 1111 1111 1111')).toBe(true); expect(luhn('4111 1111 1111 1112')).toBe(false);
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true); expect(ibanValid('GB82 WEST 1234 5698 7654 33')).toBe(false);
  });

  it('proposes candidates by category for review, and redacting them removes them', async () => {
    const source = await sample();
    const all = SENSITIVE_CATEGORIES.map(([c]) => c);
    const found = await detectSensitiveInformation(source, all, ['/ORD-\\d+/']);
    const by = (c: string) => found.filter((f) => f.category === c).map((f) => f.text);
    expect(by('name')).toEqual(['Sarah Connor']);
    expect(by('email')).toEqual(['sarah.connor@example.com']);
    expect(by('phone')).toEqual(['+1 415-555-0123']);
    expect(by('card')).toEqual(['4111 1111 1111 1111']);
    expect(by('bank')).toEqual(['GB82 WEST 1234 5698 7654 32']);
    expect(by('national-id')).toEqual(['123-45-6789', '35202-1234567-1']);
    expect(by('address')).toEqual(expect.arrayContaining(['221 Baker Street, London', 'NW1 6XE']));
    expect(by('date')).toEqual(['12/03/1985']);
    expect(by('custom')).toEqual(['ORD-7781']);
    expect(found.some((f) => /1234\.56|2024-01-05|Annual Review|1112/.test(f.text))).toBe(false);
    // Only the chosen kinds are looked for.
    expect((await detectSensitiveInformation(source, ['email'])).map((f) => f.category)).toEqual(['email']);
    // The reviewer drops the address candidates; the rest is redacted.
    const chosen = found.filter((f) => f.category !== 'address');
    const { bytes } = await redactPdf(source, { marks: chosen.flatMap((f) => f.marks) });
    const loading = getDocument({ data: bytes } as never);
    const doc = await loading.promise;
    const text = ((await (await doc.getPage(1)).getTextContent()).items as { str: string }[]).map((i) => i.str).join('\n');
    await loading.destroy();
    for (const f of chosen) expect(text).not.toContain(f.text);
    expect(text).toContain('221 Baker Street'); expect(text).toContain('Invoice total 1234.56');
    expect(text).toContain('Patient:'); expect(text).toContain('Email:');
  });

  it('refuses custom patterns that could hang', () => {
    expect(() => customRule('/(a+)+b/')).toThrow('too complex');
    expect(customRule('Project Falcon').test('the project  falcon plan')).toBe(true);
  });
});
