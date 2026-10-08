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
  /** Original PDF.js attachment ID; must be passed unchanged to getAttachmentContent. */
  id: string;
  name: string;
  /** Declared metadata size, not an independently verified decompressed size. */
  sizeBytes: number | null;
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
  size?: unknown;
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

export function safePdfAttachmentExportName(filename:string):string {
  const cleaned=sanitizePdfAttachmentName(filename,'attachment.bin')
    .replace(/[<>:"|?*]/g,'_')
    .replace(/[.\s]+$/g,'');
  const safe=/\.(pdf|zip|png|jpe?g|webp|tiff?|bmp|txt|csv|json|xml|md|docx?|odt|rtf|xlsx?|ods|pptx?|odp|bin)$/i.test(cleaned);
  return safe?cleaned:cleaned+'.bin';
}

export function normalizePdfAttachments(
  input: unknown,
  maxEntries = 200,
  maxDownloadBytes = 32 * 1024 * 1024,
): PdfAttachmentModel {
  // PDF.js 6.4.299 returns Map<string, CatalogAttachment> (metadata only).
  // Never read or clone the attachment's content while building the list.
  if (!(input instanceof Map)) return { entries: [], truncated: false };
  const entries:PdfAttachmentEntry[]=[];
  const truncated=input.size>maxEntries;
  for(const [id, metadata] of input.entries()){
    if(entries.length>=maxEntries)break;
    if(typeof id!=='string'||!id||typeof metadata!=='object'||!metadata)continue;
    const item=metadata as RawAttachment;
    const size=typeof item.size==='number'&&Number.isSafeInteger(item.size)&&item.size>=0
      ? item.size : null;
    const exceedsLimit=size!==null&&size>maxDownloadBytes;
    const unknownSize=size===null;
    entries.push({
      id,
      name:sanitizePdfAttachmentName(item.filename,'attachment-'+(entries.length+1)+'.bin'),
      sizeBytes:size,
      // Unknown sizes are not extracted: the PDF.js worker currently cannot
      // enforce a hard decompression quota before materializing a stream.
      downloadable:!unknownSize&&!exceedsLimit,
      reason:unknownSize
        ? 'Attachment size is unavailable; extraction is disabled for safety.'
        : exceedsLimit
          ? 'Attachment exceeds the '+Math.round(maxDownloadBytes/1024/1024)+' MB extraction limit.'
          : null,
    });
  }
  return { entries, truncated };
}

/** Validate the separately requested bytes, then clone only bounded output. */
export function readPdfAttachmentBytes(value:unknown,maxDownloadBytes=32*1024*1024):Uint8Array{
  const candidate=(typeof value==='object'&&value!==null&&'content' in value)
    ? (value as {content:unknown}).content : value;
  let bytes:Uint8Array;
  if(candidate instanceof Uint8Array)bytes=candidate;
  else if(candidate instanceof ArrayBuffer)bytes=new Uint8Array(candidate);
  else if(ArrayBuffer.isView(candidate)){
    const view=candidate as ArrayBufferView;
    bytes=new Uint8Array(view.buffer,view.byteOffset,view.byteLength);
  }else throw new Error('This attachment has no supported binary content.');
  if(!bytes.byteLength)throw new Error('Attachment content is empty.');
  if(bytes.byteLength>maxDownloadBytes)throw new Error('Attachment content exceeds the 32 MB safety limit.');
  return Uint8Array.from(bytes);
}
