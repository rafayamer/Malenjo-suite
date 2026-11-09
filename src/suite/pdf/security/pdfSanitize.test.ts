import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { inspectPdfSanitization, sanitizePdf } from './pdfSanitize';

/** A PDF carrying one of everything MAL-070 looks for, plus visible text that must survive. */
async function loaded() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([400, 300]);
  page.drawText('Visible report', { x: 20, y: 250, size: 14, font });
  pdf.setTitle('Internal draft'); pdf.setAuthor('A. Person');
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(pdf.context.stream('<x:xmpmeta>secret</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })));
  await pdf.attach(new TextEncoder().encode('payroll'), 'payroll.csv', { mimeType: 'text/csv' });
  pdf.addJavaScript('init', 'app.alert("hi")');
  pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText('app.alert(1)') }));
  // An off layer, its content, and invisible (OCR-style) text.
  const ocg = pdf.context.register(pdf.context.obj({ Type: 'OCG', Name: PDFHexString.fromText('Notes') }));
  pdf.catalog.set(PDFName.of('OCProperties'), pdf.context.obj({ OCGs: [ocg], D: { OFF: [ocg] } }));
  page.node.Resources()!.set(PDFName.of('Properties'), pdf.context.obj({ MC0: ocg }));
  const fontKey = page.node.Resources()!.lookup(PDFName.of('Font')) as never as { keys(): PDFName[] };
  const f = fontKey.keys()[0].decodeText();
  page.node.addContentStream(pdf.context.register(pdf.context.stream(`/OC /MC0 BDC BT /${f} 12 Tf 20 200 Td (Layer secret) Tj ET EMC BT 3 Tr /${f} 12 Tf 20 150 Td (OCR secret) Tj ET`)));
  const annot = (o: Record<string, unknown>) => pdf.context.register(pdf.context.obj({ Type: 'Annot', Rect: [10, 10, 60, 30], ...o }));
  page.node.set(PDFName.of('Annots'), pdf.context.obj([
    annot({ Subtype: 'Link', A: { S: 'URI', URI: PDFHexString.fromText('https://example.com/track') } }),
    annot({ Subtype: 'FileAttachment', Contents: PDFHexString.fromText('notes.txt'), FS: { Type: 'Filespec', F: PDFHexString.fromText('notes.txt') } }),
    annot({ Subtype: 'Text', F: 2, Contents: PDFHexString.fromText('Hidden note') }),
    annot({ Subtype: 'Text', Contents: PDFHexString.fromText('Visible note') }),
  ]));
  return pdf.save({ useObjectStreams: false });
}
async function pdfjs(bytes: Uint8Array) {
  const loading = getDocument({ data: bytes.slice() } as never);
  const doc = await loading.promise;
  try {
    const page = await doc.getPage(1);
    return {
      text: ((await page.getTextContent()).items as { str: string }[]).map((i) => i.str).join('|'),
      info: (await doc.getMetadata()).info as Record<string, unknown>, xmp: (await doc.getMetadata()).metadata,
      attachments: await doc.getAttachments(), js: await doc.getJSActions(),
      annots: ((await page.getAnnotations()) as { subtype: string; contentsObj?: { str: string } }[]).map((a) => `${a.subtype}:${a.contentsObj?.str ?? ''}`),
    };
  } finally { await loading.destroy(); }
}

describe('Sanitize PDF (MAL-070)', () => {
  it('lists every kind of sensitive content it finds', async () => {
    const found = Object.fromEntries((await inspectPdfSanitization(await loaded())).map((f) => [f.category, f.items.join(' ; ')]));
    expect(found.metadata).toMatch(/Title.*Internal draft/); expect(found.metadata).toMatch(/XMP/);
    expect(found.attachments).toMatch(/payroll\.csv/); expect(found.attachments).toMatch(/FileAttachment/);
    expect(found.scripts).toMatch(/Document JavaScript “init”/); expect(found.scripts).toMatch(/Open action \(JavaScript\)/);
    expect(found.links).toMatch(/https:\/\/example\.com\/track/);
    expect(found.hidden).toMatch(/Text hidden from view/); expect(found.hidden).toMatch(/1 block\(s\) in layers that are off/); expect(found.hidden).toMatch(/1 invisible text object/);
  });

  it('removes only the selected categories, verified by an independent reader', async () => {
    const source = await loaded();
    const before = await pdfjs(source);
    expect(before.text).toContain('OCR secret'); expect(before.attachments).not.toBeNull();
    const { bytes } = await sanitizePdf(source, ['metadata', 'attachments', 'scripts', 'links', 'hidden']);
    const after = await pdfjs(bytes);
    expect(after.text).toBe('Visible report');
    expect(after.info.Title).toBeUndefined(); expect(after.info.Author).toBeUndefined(); expect(after.xmp).toBeNull();
    expect(after.attachments).toBeNull(); expect(after.js).toBeNull();
    expect(after.annots).toEqual(['Text:Visible note']);
    // What was removed is gone from the file itself, not only unreferenced.
    const raw = new TextDecoder('latin1').decode(bytes);
    for (const left of ['xmpmeta', '/EmbeddedFile', 'Internal draft', 'app.alert', 'Layer secret', 'OCR secret', 'example.com', 'Hidden note']) expect(raw).not.toContain(left);
    // Only the scripts: metadata and attachments stay.
    const scriptsOnly = await pdfjs((await sanitizePdf(source, ['scripts'])).bytes);
    expect(scriptsOnly.js).toBeNull(); expect(scriptsOnly.info.Title).toBe('Internal draft'); expect(scriptsOnly.attachments).not.toBeNull();
  });

  it('keeps hidden text that shares a text object with visible text, and says so', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 200]);
    page.drawText('Shown', { x: 20, y: 150, size: 12, font: await pdf.embedFont(StandardFonts.Helvetica) });
    const f = (page.node.Resources()!.lookup(PDFName.of('Font')) as never as { keys(): PDFName[] }).keys()[0].decodeText();
    page.node.addContentStream(pdf.context.register(pdf.context.stream(`BT /${f} 12 Tf 20 100 Td (Seen) Tj 3 Tr (Unseen) Tj ET`)));
    const result = await sanitizePdf(await pdf.save(), ['hidden']);
    expect(result.kept.join(' ')).toMatch(/mixed with visible content were kept/);
    expect((await pdfjs(result.bytes)).text).toContain('Seen');
  });
});
