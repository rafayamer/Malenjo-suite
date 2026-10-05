import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { disposePdf, loadPdfBytes } from '../pdf/engine';
import type { RedactionRect } from './types';

const MAGIC = new TextEncoder().encode('MALENJOSEC1');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 250_000;

export function validateRedaction(rect: RedactionRect): boolean {
  return Number.isInteger(rect.page)
    && rect.page >= 1
    && [rect.x, rect.y, rect.width, rect.height].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && rect.x + rect.width <= 1
    && rect.y + rect.height <= 1
    && rect.width > 0
    && rect.height > 0;
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Unable to encode sanitized PDF page.')), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function destructivePdfCdr(
  bytes: Uint8Array,
  options: { redactions?: RedactionRect[]; watermark?: string; maxPages?: number } = {},
): Promise<Uint8Array> {
  const input = await loadPdfBytes(bytes);
  const output = await PDFDocument.create();
  const maxPages = Math.min(options.maxPages ?? 120, 120);
  if (input.document.numPages > maxPages) {
    await disposePdf(input);
    throw new Error(`CDR is limited to ${maxPages} pages per Phase 6 operation.`);
  }

  try {
    for (let pageNumber = 1; pageNumber <= input.document.numPages; pageNumber += 1) {
      const page = await input.document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, Math.max(1, 1800 / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas rendering is unavailable.');

      await page.render({ canvas, canvasContext: context, viewport }).promise;

      for (const rect of options.redactions ?? []) {
        if (rect.page !== pageNumber || !validateRedaction(rect)) continue;
        context.fillStyle = '#000';
        context.fillRect(
          rect.x * canvas.width,
          rect.y * canvas.height,
          rect.width * canvas.width,
          rect.height * canvas.height,
        );
      }

      if (options.watermark?.trim()) {
        const text = options.watermark.trim().slice(0, 80);
        context.save();
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(-Math.PI / 6);
        context.globalAlpha = 0.22;
        context.fillStyle = '#0f4f75';
        context.font = `700 ${Math.max(22, Math.floor(canvas.width / 13))}px sans-serif`;
        context.textAlign = 'center';
        context.fillText(text, 0, 0);
        context.restore();
      }

      const png = await output.embedPng(await canvasPng(canvas));
      const outPage = output.addPage([base.width, base.height]);
      outPage.drawImage(png, { x: 0, y: 0, width: base.width, height: base.height });
    }

    output.setTitle('');
    output.setAuthor('');
    output.setSubject('');
    output.setKeywords([]);
    output.setCreator('MALENJO Security Center CDR');
    output.setProducer('MALENJO Security Center CDR');
    output.setCreationDate(new Date(0));
    output.setModificationDate(new Date(0));
    return Uint8Array.from(await output.save({ useObjectStreams: false }));
  } finally {
    await disposePdf(input);
  }
}

async function deriveKey(password: string, salt: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (password.length < 10) throw new Error('Use a password of at least 10 characters for secure export.');
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const ownedSalt = Uint8Array.from(salt);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', hash:'SHA-256', salt:ownedSalt.buffer, iterations:PBKDF2_ITERATIONS },
    material,
    { name:'AES-GCM', length:256 },
    false,
    usages,
  );
}

export async function encryptMalenjoEnvelope(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, ['encrypt']);
  const plain = Uint8Array.from(bytes);
  const ownedIv = Uint8Array.from(iv);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv:ownedIv.buffer }, key, plain.buffer));
  const out = new Uint8Array(MAGIC.length + SALT_BYTES + IV_BYTES + cipher.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC.length);
  out.set(iv, MAGIC.length + SALT_BYTES);
  out.set(cipher, MAGIC.length + SALT_BYTES + IV_BYTES);
  return out;
}

export async function decryptMalenjoEnvelope(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const magic = bytes.slice(0, MAGIC.length);
  if (new TextDecoder().decode(magic) !== new TextDecoder().decode(MAGIC)) {
    throw new Error('This is not a MALENJO secure envelope.');
  }
  const saltStart = MAGIC.length;
  const ivStart = saltStart + SALT_BYTES;
  const cipherStart = ivStart + IV_BYTES;
  const salt = bytes.slice(saltStart, ivStart);
  const iv = bytes.slice(ivStart, cipherStart);
  const cipher = bytes.slice(cipherStart);
  const key = await deriveKey(password, salt, ['decrypt']);
  try {
    const ownedIv = Uint8Array.from(iv);
    const ownedCipher = Uint8Array.from(cipher);
    const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv:ownedIv.buffer }, key, ownedCipher.buffer);
    return new Uint8Array(plain);
  } catch {
    throw new Error('Unable to decrypt secure envelope. The password or file may be incorrect.');
  }
}

export async function watermarkPdfPreservingContent(bytes: Uint8Array, text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    page.drawText(text.slice(0, 80), {
      x: width * 0.15,
      y: height * 0.5,
      size: Math.max(24, width / 13),
      font,
      color: rgb(0.15, 0.45, 0.65),
      opacity: 0.18,
      rotate: degrees(-30),
    });
  }
  return Uint8Array.from(await pdf.save());
}
