import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface PdfOutlineEntry {
  id: string;
  title: string;
  depth: number;
  dest: unknown;
  url: string | null;
}

export interface PdfOutlineModel {
  entries: PdfOutlineEntry[];
  truncated: boolean;
}

export interface PdfAttachmentEntry {
  id: string;
  name: string;
  sizeBytes: number;
  content: Uint8Array;
  downloadable: boolean;
  reason: string | null;
}

export interface PdfAttachmentModel {
  entries: PdfAttachmentEntry[];
  truncated: boolean;
}

interface RawOutlineNode {
  title?: unknown;
  dest?: unknown;
  url?: unknown;
  unsafeUrl?: unknown;
  items?: unknown;
}

interface RawAttachment {
  filename?: unknown;
  content?: unknown;
}

const MAX_TITLE_CHARS = 240;
const MAX_ATTACHMENT_NAME_CHARS = 180;

function cleanText(value: unknown, fallback: string, max = MAX_TITLE_CHARS): string {
  const text = typeof value === 'string' ? value : fallback;
  const cleaned = text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, max);
}

export function flattenPdfOutline(input: unknown, maxEntries = 1000): PdfOutlineModel {
  const roots = Array.isArray(input) ? input : [];
  const entries: PdfOutlineEntry[] = [];
  let truncated = false;

  function visit(nodes: unknown[], depth: number, path: string) {
    for (let index = 0; index < nodes.length; index += 1) {
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }

      const node = (nodes[index] ?? {}) as RawOutlineNode;
      const title = cleanText(node.title, `Untitled bookmark ${entries.length + 1}`);
      const url = typeof node.url === 'string'
        ? node.url
        : typeof node.unsafeUrl === 'string'
          ? node.unsafeUrl
          : null;

      entries.push({
        id: `${path}${index}`,
        title,
        depth: Math.min(depth, 12),
        dest: node.dest ?? null,
        url,
      });

      if (Array.isArray(node.items) && node.items.length) {
        visit(node.items, depth + 1, `${path}${index}.`);
        if (truncated) return;
      }
    }
  }

  visit(roots, 0, 'outline-');
  return { entries, truncated };
}

export async function resolvePdfOutlinePage(
  document: Pick<PDFDocumentProxy, 'numPages' | 'getDestination' | 'getPageIndex'>,
  destination: unknown,
): Promise<number | null> {
  let explicit = destination;
  if (typeof explicit === 'string') {
    explicit = await document.getDestination(explicit);
  }

  if (!Array.isArray(explicit) || !explicit.length) return null;
  const target = explicit[0];

  if (typeof target === 'number' && Number.isFinite(target)) {
    const zeroBased = Math.trunc(target);
    if (zeroBased < 0 || zeroBased >= document.numPages) return null;
    return zeroBased + 1;
  }

  if (!target || typeof target !== 'object') return null;

  try {
    const pageIndex = await document.getPageIndex(target as never);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= document.numPages) return null;
    return pageIndex + 1;
  } catch {
    return null;
  }
}

export function sanitizePdfAttachmentName(value: unknown, fallback: string): string {
  const raw = cleanText(value, fallback, MAX_ATTACHMENT_NAME_CHARS)
    .replace(/\.{2,}/g, '_')
    .replace(/[\\/\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return (raw || fallback).slice(0, MAX_ATTACHMENT_NAME_CHARS);
}

function attachmentBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  return new Uint8Array();
}

export function normalizePdfAttachments(
  input: unknown,
  maxEntries = 200,
  maxDownloadBytes = 100 * 1024 * 1024,
): PdfAttachmentModel {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { entries: [], truncated: false };
  }

  const rawEntries = Object.entries(input as Record<string, RawAttachment>);
  const truncated = rawEntries.length > maxEntries;
  const entries = rawEntries.slice(0, maxEntries).map(([key, attachment], index) => {
    const content = attachmentBytes(attachment?.content);
    const name = sanitizePdfAttachmentName(
      attachment?.filename,
      `attachment-${index + 1}.bin`,
    );
    const tooLarge = content.byteLength > maxDownloadBytes;

    return {
      id: `attachment-${index + 1}-${key.slice(0, 40)}`,
      name,
      sizeBytes: content.byteLength,
      content,
      downloadable: content.byteLength > 0 && !tooLarge,
      reason: !content.byteLength
        ? 'Attachment has no extractable byte content.'
        : tooLarge
          ? `Attachment exceeds the ${Math.round(maxDownloadBytes / 1024 / 1024)} MB extraction limit.`
          : null,
    };
  });

  return { entries, truncated };
}
