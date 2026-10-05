import { PDFDocument, StandardFonts } from 'pdf-lib';

export interface SearchablePdfPage {
  image: Blob;
  text: string;
}

function searchableAscii(value: string): string {
  return value
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20_000);
}

export async function buildSearchablePdf(pages: SearchablePdfPage[]): Promise<Uint8Array> {
  if (!pages.length) throw new Error('Add at least one scan page before exporting PDF.');

  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (const item of pages) {
    const bytes = new Uint8Array(await item.image.arrayBuffer());
    const embedded = item.image.type === 'image/png'
      ? await document.embedPng(bytes)
      : await document.embedJpg(bytes);

    const maximum = 842;
    const scale = Math.min(1, maximum / Math.max(embedded.width, embedded.height));
    const width = Math.max(72, embedded.width * scale);
    const height = Math.max(72, embedded.height * scale);
    const page = document.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });

    const text = searchableAscii(item.text);
    if (text) {
      const chunks = text.match(/.{1,500}/g) ?? [];
      chunks.slice(0, 30).forEach((chunk, index) => {
        page.drawText(chunk, {
          x: 2,
          y: Math.min(height - 2, 2 + index),
          size: 1,
          font,
          opacity: 0.01,
        });
      });
    }
  }

  document.setProducer('MALENJO Suite');
  document.setCreator('MALENJO Scanner/OCR');
  return document.save();
}

export function downloadBytes(bytes: Uint8Array, name: string, type: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
