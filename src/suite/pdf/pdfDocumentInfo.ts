/**
 * MAL-021 PDF information and metadata: inspect, modify, clear and save the
 * Info dictionary (standard and custom entries) and the XMP metadata packet.
 *
 * Saving writes the Info dictionary and, unless XMP is removed, a fresh XMP
 * packet that mirrors it (dc:title, dc:creator, dc:description, pdf:Keywords,
 * pdf:Producer, xmp:CreatorTool, xmp:CreateDate, xmp:ModifyDate), so readers
 * that prefer XMP show the same values. Signed documents are refused.
 */
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFStream, PDFString, decodePDFRawStream } from 'pdf-lib';

export const PDF_DOCINFO_MAX_INPUT_BYTES = 256 * 1024 * 1024;
const MAX_VALUE = 4096;
const MAX_CUSTOM = 50;
export const STANDARD_INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'] as const;
type StandardKey = (typeof STANDARD_INFO_KEYS)[number];
const DATE_KEYS = ['CreationDate', 'ModDate'];

export interface PdfDocumentInfo {
  standard: Record<StandardKey, string>;
  custom: [string, string][];
  creationDate: string | null;
  modDate: string | null;
  /** Raw XMP packet, or null when the document has none. */
  xmp: string | null;
  /** Values read from the XMP packet, for comparison with the Info dictionary. */
  xmpFields: Partial<Record<'title' | 'creator' | 'description' | 'keywords' | 'producer' | 'creatorTool', string>>;
}

export interface PdfDocumentInfoUpdate {
  standard: Record<StandardKey, string>;
  custom: [string, string][];
  /** sync: write a fresh XMP packet from these values; remove: delete the XMP packet. */
  xmp: 'sync' | 'remove';
  now: Date;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > PDF_DOCINFO_MAX_INPUT_BYTES) {
    throw new Error('Document properties support PDFs up to 256 MB.');
  }
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() < 1) throw new Error('no pages');
    return pdf;
  } catch { throw new Error('This PDF could not be read because it is encrypted, invalid or damaged.'); }
}

function infoDict(pdf: PDFDocument, create: boolean): PDFDict | undefined {
  const ref = pdf.context.trailerInfo.Info;
  const existing = ref ? pdf.context.lookupMaybe(ref, PDFDict) : undefined;
  if (existing || !create) return existing;
  const dict = pdf.context.obj({});
  pdf.context.trailerInfo.Info = pdf.context.register(dict);
  return dict;
}

function text(value: unknown): string | null {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
}

function xmlUnescape(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** First text value of an XMP property, whether simple, rdf:Alt, rdf:Seq or rdf:Bag. */
function xmpValue(xmp: string, property: string): string | undefined {
  const escaped = property.replace(':', '\\:');
  const element = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`).exec(xmp);
  if (element) {
    const li = /<rdf:li(?:\s[^>]*)?>([\s\S]*?)<\/rdf:li>/.exec(element[1]);
    return xmlUnescape((li ? li[1] : element[1]).trim());
  }
  const attribute = new RegExp(`\\s${escaped}="([^"]*)"`).exec(xmp);
  return attribute ? xmlUnescape(attribute[1]) : undefined;
}

function readXmp(pdf: PDFDocument): string | null {
  const stream = pdf.catalog.lookupMaybe(PDFName.of('Metadata'), PDFStream);
  if (!stream) return null;
  const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  return new TextDecoder().decode(bytes);
}

/** Detaches the XMP packet and deletes its object, so the old metadata is not written to the file. */
function dropXmp(pdf: PDFDocument): void {
  const ref = pdf.catalog.get(PDFName.of('Metadata'));
  pdf.catalog.delete(PDFName.of('Metadata'));
  if (ref instanceof PDFRef) pdf.context.delete(ref);
}

function refuseSigned(pdf: PDFDocument): void {
  if (pdf.catalog.has(PDFName.of('Perms'))) throw new Error('This PDF is certified; changing its properties would invalidate the certification.');
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && (object.has(PDFName.of('ByteRange')) || object.get(PDFName.of('FT'))?.toString() === '/Sig')) {
      throw new Error('This PDF has signature fields; changing its properties could invalidate a signature.');
    }
  }
}

export async function readPdfDocumentInfo(bytes: Uint8Array): Promise<PdfDocumentInfo> {
  const pdf = await load(bytes);
  const info = infoDict(pdf, false);
  const standard = Object.fromEntries(STANDARD_INFO_KEYS.map((key) => [key, text(info?.get(PDFName.of(key))) ?? ''])) as Record<StandardKey, string>;
  const custom: [string, string][] = [];
  for (const [key, value] of info?.entries() ?? []) {
    const name = key.decodeText();
    if ((STANDARD_INFO_KEYS as readonly string[]).includes(name) || DATE_KEYS.includes(name) || name === 'Trapped') continue;
    const decoded = text(value);
    if (decoded !== null) custom.push([name, decoded]);
  }
  const xmp = readXmp(pdf);
  const xmpFields: PdfDocumentInfo['xmpFields'] = {};
  if (xmp) {
    const pairs = [['title', 'dc:title'], ['creator', 'dc:creator'], ['description', 'dc:description'], ['keywords', 'pdf:Keywords'],
      ['producer', 'pdf:Producer'], ['creatorTool', 'xmp:CreatorTool']] as const;
    for (const [field, property] of pairs) { const value = xmpValue(xmp, property); if (value !== undefined) xmpFields[field] = value; }
  }
  return {
    standard, custom,
    creationDate: text(info?.get(PDFName.of('CreationDate'))),
    modDate: text(info?.get(PDFName.of('ModDate'))),
    xmp, xmpFields,
  };
}

function pdfDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** PDF date (D:YYYYMMDDHHmmSS...) to ISO 8601 for XMP; undefined when unreadable. */
function isoFromPdfDate(value: string | null): string | undefined {
  const match = value && /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value);
  if (!match) return undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

function buildXmp(standard: Record<StandardKey, string>, created: string | undefined, modified: string): string {
  const alt = (tag: string, value: string) => value ? `<${tag}><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(value)}</rdf:li></rdf:Alt></${tag}>` : '';
  const simple = (tag: string, value: string | undefined) => value ? `<${tag}>${xmlEscape(value)}</${tag}>` : '';
  const authors = standard.Author.split(/\s*;\s*/).filter(Boolean);
  return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">'
    + alt('dc:title', standard.Title)
    + (authors.length ? `<dc:creator><rdf:Seq>${authors.map((a) => `<rdf:li>${xmlEscape(a)}</rdf:li>`).join('')}</rdf:Seq></dc:creator>` : '')
    + alt('dc:description', standard.Subject)
    + simple('pdf:Keywords', standard.Keywords) + simple('pdf:Producer', standard.Producer)
    + simple('xmp:CreatorTool', standard.Creator) + simple('xmp:CreateDate', created) + simple('xmp:ModifyDate', modified)
    + '<dc:format>application/pdf</dc:format></rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>';
}

function checkValue(label: string, value: string): void {
  if (typeof value !== 'string' || value.length > MAX_VALUE) throw new Error(`${label} must be at most 4,096 characters.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) throw new Error(`${label} contains control characters.`);
}

export async function writePdfDocumentInfo(bytes: Uint8Array, update: PdfDocumentInfoUpdate): Promise<Uint8Array> {
  for (const key of STANDARD_INFO_KEYS) checkValue(key, update.standard[key] ?? '');
  if (update.custom.length > MAX_CUSTOM) throw new Error(`Up to ${MAX_CUSTOM} custom properties are supported.`);
  const seen = new Set<string>();
  for (const [key, value] of update.custom) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) throw new Error(`“${key}” is not a valid property name. Use letters, digits, _ . - (up to 64).`);
    if ((STANDARD_INFO_KEYS as readonly string[]).includes(key) || DATE_KEYS.includes(key) || key === 'Trapped') throw new Error(`${key} is a standard property; edit it above.`);
    if (seen.has(key)) throw new Error(`The property ${key} is listed twice.`);
    seen.add(key);
    checkValue(key, value);
  }
  const pdf = await load(bytes);
  refuseSigned(pdf);
  const info = infoDict(pdf, true)!;
  const created = text(info.get(PDFName.of('CreationDate')));
  for (const key of info.keys()) if (!DATE_KEYS.includes(key.decodeText()) && key.decodeText() !== 'Trapped') info.delete(key);
  for (const key of STANDARD_INFO_KEYS) {
    const value = update.standard[key].trim();
    if (value) info.set(PDFName.of(key), PDFHexString.fromText(value));
  }
  for (const [key, value] of update.custom) info.set(PDFName.of(key), PDFHexString.fromText(value));
  info.set(PDFName.of('ModDate'), PDFString.of(pdfDate(update.now)));
  if (update.xmp === 'remove') {
    dropXmp(pdf);
  } else {
    dropXmp(pdf);
    const xml = buildXmp(update.standard, isoFromPdfDate(created), update.now.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    const stream = pdf.context.stream(new TextEncoder().encode(xml), { Type: 'Metadata', Subtype: 'XML' });
    pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(stream));
  }
  return Uint8Array.from(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));
}

/** Removes every Info entry (including dates) and the XMP packet. */
export async function clearPdfDocumentInfo(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await load(bytes);
  refuseSigned(pdf);
  const info = infoDict(pdf, false);
  if (info) for (const key of info.keys()) info.delete(key);
  dropXmp(pdf);
  return Uint8Array.from(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));
}
