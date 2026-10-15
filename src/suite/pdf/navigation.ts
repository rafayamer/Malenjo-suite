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
  // A damaged or malicious PDF may contain a deeply nested or cyclic outline.
  // Bound output and walk iteratively so the UI never exhausts the JS call stack.
  const limit = Number.isSafeInteger(maxEntries)
    ? Math.min(10_000, Math.max(0, maxEntries))
    : 1000;
  const active = new WeakSet<object>();
  interface Frame {
    nodes: unknown[];
    index: number;
    depth: number;
    path: string;
    parent?: object;
  }
  const stack: Frame[] = [{ nodes: roots, index: 0, depth: 0, path: 'outline-' }];
  let truncated = false;

  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.nodes.length) {
      if (frame.parent) active.delete(frame.parent);
      stack.pop();
      continue;
    }
    if (entries.length >= limit) {
      truncated = true;
      break;
    }

    const index = frame.index++;
    const raw = frame.nodes[index];
    const node = (raw !== null && typeof raw === 'object' ? raw : {}) as RawOutlineNode;
    if (active.has(node)) {
      truncated = true; // Cyclic descendants are omitted, never followed.
      continue;
    }
    entries.push({
      id: `${frame.path}${index}`,
      title: cleanText(node.title, `Untitled bookmark ${entries.length + 1}`),
      depth: Math.min(frame.depth, 12),
      dest: node.dest ?? null,
      url: typeof node.url === 'string'
        ? node.url
        : typeof node.unsafeUrl === 'string' ? node.unsafeUrl : null,
    });

    if (Array.isArray(node.items) && node.items.length) {
      active.add(node);
      stack.push({
        nodes: node.items,
        index: 0,
        depth: frame.depth + 1,
        path: `${frame.path}${index}.`,
        parent: node,
      });
    }
  }
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
