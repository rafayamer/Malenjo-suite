import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';
export type FidelityLevel = 'exact-copy' | 'structure-preserving' | 'reflow-warning';

export interface DocxModel {
  kind: 'docx';
  paragraphs: string[];
  fidelity: FidelityLevel;
}

export interface XlsxModel {
  kind: 'xlsx';
  sheetPath: string;
  sheetName: string;
  cells: string[][];
  fidelity: FidelityLevel;
}

export interface PptxSlide {
  path: string;
  texts: string[];
}

export interface PptxModel {
  kind: 'pptx';
  slides: PptxSlide[];
  fidelity: FidelityLevel;
}

export type OfficeModel = DocxModel | XlsxModel | PptxModel;

const textDecoder = new TextDecoder();

function packageFiles(bytes: Uint8Array): Unzipped {
  return unzipSync(bytes);
}

function xmlText(files: Unzipped, path: string): string {
  const data = files[path];
  if (!data) throw new Error(`OOXML package is missing ${path}.`);
  return strFromU8(data);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function textRuns(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  return Array.from(xml.matchAll(regex), (match) => decodeXml(match[1].replace(/<[^>]+>/g, '')));
}

function replaceFile(files: Unzipped, path: string, content: string): Uint8Array {
  return zipSync({
    ...files,
    [path]: strToU8(content),
  }, { level: 6 });
}

export function detectOfficeKind(bytes: Uint8Array): OfficeKind {
  const files = packageFiles(bytes);
  if (files['word/document.xml']) return 'docx';
  if (files['xl/workbook.xml']) return 'xlsx';
  if (files['ppt/presentation.xml']) return 'pptx';
  throw new Error('Unsupported OOXML package. Expected DOCX, XLSX, or PPTX content.');
}

export function parseDocx(bytes: Uint8Array): DocxModel {
  const files = packageFiles(bytes);
  const xml = xmlText(files, 'word/document.xml');
  const paragraphs = Array.from(xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g), (match) =>
    textRuns(match[1], 'w:t').join(''),
  );
  return {
    kind: 'docx',
    paragraphs: paragraphs.length ? paragraphs : [''],
    fidelity: 'structure-preserving',
  };
}

export function writeDocx(bytes: Uint8Array, paragraphs: string[]): Uint8Array {
  const files = packageFiles(bytes);
  const xml = xmlText(files, 'word/document.xml');
  const section = xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] ?? '';
  const body = paragraphs.map((paragraph) =>
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`,
  ).join('');
  const next = xml.replace(
    /<w:body\b[^>]*>[\s\S]*?<\/w:body>/,
    `<w:body>${body}${section}</w:body>`,
  );
  if (next === xml) throw new Error('DOCX document body could not be located.');
  return replaceFile(files, 'word/document.xml', next);
}

function sharedStrings(files: Unzipped): string[] {
  const data = files['xl/sharedStrings.xml'];
  if (!data) return [];
  const xml = textDecoder.decode(data);
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), (match) =>
    textRuns(match[1], 't').join(''),
  );
}

function colIndex(ref: string): number {
  const letters = ref.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A';
  let result = 0;
  for (const char of letters) result = result * 26 + char.charCodeAt(0) - 64;
  return Math.max(0, result - 1);
}

function rowIndex(ref: string): number {
  const row = Number(ref.match(/\d+/)?.[0] ?? '1');
  return Math.max(0, row - 1);
}

function colName(index: number): string {
  let value = index + 1;
  let out = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

function firstSheetPath(files: Unzipped): string {
  const paths = Object.keys(files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((a, b) => Number(a.match(/sheet(\d+)/i)?.[1] ?? 0) - Number(b.match(/sheet(\d+)/i)?.[1] ?? 0));
  if (!paths.length) throw new Error('XLSX package contains no worksheets.');
  return paths[0];
}

function firstSheetName(files: Unzipped): string {
  const workbook = xmlText(files, 'xl/workbook.xml');
  const match = workbook.match(/<sheet\b[^>]*name="([^"]+)"/);
  return decodeXml(match?.[1] ?? 'Sheet1');
}

export function parseXlsx(bytes: Uint8Array): XlsxModel {
  const files = packageFiles(bytes);
  const path = firstSheetPath(files);
  const xml = xmlText(files, path);
  const shared = sharedStrings(files);
  const rows: string[][] = [];

  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = match[1];
    const body = match[2];
    const ref = attrs.match(/\br="([^"]+)"/)?.[1] ?? 'A1';
    const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? '';
    const r = rowIndex(ref);
    const c = colIndex(ref);
    if (r >= 200 || c >= 50) continue;

    rows[r] ??= [];
    let value = '';
    if (type === 'inlineStr') value = textRuns(body, 't').join('');
    else {
      const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
      value = type === 's' ? shared[Number(raw)] ?? '' : decodeXml(raw);
    }
    rows[r][c] = value;
  }

  if (!rows.length) rows.push(['']);
  return {
    kind: 'xlsx',
    sheetPath: path,
    sheetName: firstSheetName(files),
    cells: rows,
    fidelity: 'structure-preserving',
  };
}

function numeric(value: string): boolean {
  if (!value.trim()) return false;
  return Number.isFinite(Number(value));
}

export function writeXlsx(bytes: Uint8Array, model: XlsxModel): Uint8Array {
  const files = packageFiles(bytes);
  const xml = xmlText(files, model.sheetPath);
  const sheetData = model.cells.map((row, r) => {
    const cells = row.map((value, c) => {
      if (value === undefined || value === '') return '';
      const ref = `${colName(c)}${r + 1}`;
      return numeric(value)
        ? `<c r="${ref}"><v>${escapeXml(value)}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    return cells ? `<row r="${r + 1}">${cells}</row>` : '';
  }).join('');

  const next = /<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/.test(xml)
    ? xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, `<sheetData>${sheetData}</sheetData>`)
    : xml.replace(/<worksheet\b([^>]*)>/, `<worksheet$1><sheetData>${sheetData}</sheetData>`);

  return replaceFile(files, model.sheetPath, next);
}

function slidePaths(files: Unzipped): string[] {
  return Object.keys(files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1] ?? 0) - Number(b.match(/slide(\d+)/i)?.[1] ?? 0));
}

export function parsePptx(bytes: Uint8Array): PptxModel {
  const files = packageFiles(bytes);
  const slides = slidePaths(files).map((path) => ({
    path,
    texts: textRuns(xmlText(files, path), 'a:t'),
  }));
  if (!slides.length) throw new Error('PPTX package contains no slides.');
  return { kind: 'pptx', slides, fidelity: 'structure-preserving' };
}

export function writePptx(bytes: Uint8Array, model: PptxModel): Uint8Array {
  let files = packageFiles(bytes);
  for (const slide of model.slides) {
    const xml = xmlText(files, slide.path);
    let index = 0;
    const next = xml.replace(/<a:t\b([^>]*)>[\s\S]*?<\/a:t>/g, (_full, attrs: string) => {
      const value = slide.texts[index++] ?? '';
      return `<a:t${attrs}>${escapeXml(value)}</a:t>`;
    });
    files = unzipSync(zipSync({ ...files, [slide.path]: strToU8(next) }, { level: 6 }));
  }
  return zipSync(files, { level: 6 });
}

export function parseOffice(bytes: Uint8Array): OfficeModel {
  const kind = detectOfficeKind(bytes);
  if (kind === 'docx') return parseDocx(bytes);
  if (kind === 'xlsx') return parseXlsx(bytes);
  return parsePptx(bytes);
}

export function writeOffice(bytes: Uint8Array, model: OfficeModel): Uint8Array {
  if (model.kind === 'docx') return writeDocx(bytes, model.paragraphs);
  if (model.kind === 'xlsx') return writeXlsx(bytes, model);
  return writePptx(bytes, model);
}

export function exactCopy(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}
