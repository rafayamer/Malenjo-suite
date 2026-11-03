import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { clearPdfDocumentInfo, isoFromPdfDate, readPdfDocumentInfo, writePdfDocumentInfo, type PdfDocumentInfoUpdate } from './pdfDocumentInfo';

async function source() {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.setTitle('Old title'); pdf.setAuthor('Old author'); pdf.setCreationDate(new Date(Date.UTC(2020, 0, 2, 3, 4, 5)));
  pdf.context.lookup(pdf.context.trailerInfo.Info, PDFDict).set(PDFName.of('Department'), PDFName.of('Legacy')); // non-text custom entries are not listed
  return pdf.save();
}

const update = (over: Partial<PdfDocumentInfoUpdate> = {}): PdfDocumentInfoUpdate => ({
  standard: { Title: 'Q3 report & plan', Author: 'Ada; Grace', Subject: 'Quarterly <summary>', Keywords: 'finance, q3', Creator: 'Writer', Producer: 'MALENJO' },
  custom: [['Department', 'Finance'], ['Reviewed', 'yes']], xmp: 'sync', now: new Date(Date.UTC(2026, 10, 3, 9, 0, 0)), ...over,
});

/** Independent read with PDF.js (Info and XMP as a reader sees them). */
async function pdfjsMetadata(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const doc = await loading.promise;
  const meta = await doc.getMetadata();
  await loading.destroy();
  return meta as { info: Record<string, unknown>; metadata: { get(name: string): unknown } | null };
}

describe('document information (MAL-021)', () => {
  it('converts PDF dates with offsets to UTC for XMP', () => {
    expect(isoFromPdfDate("D:20260101100000+05'30'")).toBe('2026-01-01T04:30:00Z');
    expect(isoFromPdfDate("D:20260101100000-02'00'")).toBe('2026-01-01T12:00:00Z');
    expect(isoFromPdfDate('D:20260101100000Z')).toBe('2026-01-01T10:00:00Z');
    expect(isoFromPdfDate('D:2026')).toBe('2026-01-01T00:00:00Z');
    expect(isoFromPdfDate('garbage')).toBeUndefined();
  });

  it('reads, writes standard and custom Info entries, and writes matching XMP', async () => {
    const before = await readPdfDocumentInfo(await source());
    expect(before.standard.Title).toBe('Old title');
    expect(before.xmp).toBeNull();
    expect(before.creationDate).toMatch(/^D:20200102030405/);

    const bytes = await writePdfDocumentInfo(await source(), update());
    const after = await readPdfDocumentInfo(bytes);
    expect(after.standard).toEqual(update().standard);
    expect(after.custom).toEqual([['Department', 'Finance'], ['Reviewed', 'yes']]);
    expect(after.creationDate).toMatch(/^D:20200102030405/);
    expect(after.modDate).toBe('D:20261103090000Z');
    expect(after.xmpFields).toEqual({ title: 'Q3 report & plan', creator: 'Ada', description: 'Quarterly <summary>', keywords: 'finance, q3', producer: 'MALENJO', creatorTool: 'Writer' });
    expect(after.xmp).toContain('<xmp:CreateDate>2020-01-02T03:04:05Z</xmp:CreateDate>');

    const reader = await pdfjsMetadata(bytes);
    expect(reader.info.Title).toBe('Q3 report & plan');
    expect((reader.info.Custom as Map<string, string>).get('Department')).toBe('Finance');
    expect(reader.metadata?.get('dc:title')).toBe('Q3 report & plan');
    expect(reader.metadata?.get('dc:creator')).toEqual(['Ada', 'Grace']);
  });

  it('removes XMP on request, clears everything, and validates input', async () => {
    const synced = await writePdfDocumentInfo(await source(), update());
    const noXmp = await writePdfDocumentInfo(synced, update({ xmp: 'remove', custom: [] }));
    expect((await readPdfDocumentInfo(noXmp)).xmp).toBeNull();
    expect((await readPdfDocumentInfo(noXmp)).custom).toEqual([]);

    // The old packet is gone from the file, not just disconnected.
    const latin = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
    expect(latin(synced)).toContain('Q3 report &amp; plan');
    expect(latin(noXmp)).not.toContain('x:xmpmeta');
    const cleared = await clearPdfDocumentInfo(synced);
    expect(latin(cleared)).not.toContain('x:xmpmeta');
    const info = await readPdfDocumentInfo(cleared);
    expect(Object.values(info.standard).every((value) => value === '')).toBe(true);
    expect([info.custom, info.xmp, info.creationDate, info.modDate]).toEqual([[], null, null, null]);
    expect((await pdfjsMetadata(cleared)).info.Title).toBeUndefined();

    await expect(writePdfDocumentInfo(await source(), update({ custom: [['bad name', 'x']] }))).rejects.toThrow(/not a valid property name/);
    await expect(writePdfDocumentInfo(await source(), update({ custom: [['Title', 'x']] }))).rejects.toThrow(/standard property/);
    await expect(writePdfDocumentInfo(await source(), update({ custom: [['A', '1'], ['A', '2']] }))).rejects.toThrow(/twice/);
    await expect(readPdfDocumentInfo(new TextEncoder().encode('%PDF-1.7 no'))).rejects.toThrow(/could not be read/);
  });
});
