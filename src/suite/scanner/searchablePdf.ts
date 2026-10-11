import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';

export interface SearchablePdfPage {
  image: Blob;
  text: string;
}

function searchableText(value: string, font: PDFFont): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  // Never claim that text is searchable after silently discarding OCR glyphs
  // or truncating it. Helvetica supports WinAnsi but not every Unicode script.
  if (normalized.length > 20_000)
    throw new Error('OCR page exceeds the 20,000-character searchable-PDF limit; text was not truncated or exported.');
  try {
    font.encodeText(normalized);
  } catch {
    throw new Error('OCR text contains characters unsupported by the PDF font. Export UTF-8 text instead; multilingual searchable PDF requires an embedded Unicode font.');
  }
  return normalized;
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

    const text = searchableText(item.text, font);
    if (text) {
      const chunks = text.match(/.{1,500}/g) ?? [];
      chunks.forEach((chunk, index) => {
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
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Immediate revocation races the browser download reader.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
