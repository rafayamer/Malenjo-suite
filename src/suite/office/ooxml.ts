import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';

export type OfficeKind = 'docx' | 'xlsx' | 'pptx';
export type FidelityLevel = 'exact-copy' | 'structure-preserving' | 'reflow-warning';

export interface DocxModel {
  kind: 'docx';
  paragraphs: string[];
  fidelity: FidelityLevel;
}

export interface XlsxSheet {
  path: string;
  name: string;
  hidden?: boolean;
  cells: string[][];
}

export interface XlsxModel {
  kind: 'xlsx';
  // Compatibility fields for the first sheet; sheets contains all editable tabs.
  sheetPath: string;
  sheetName: string;
  cells: string[][];
  sheets?: XlsxSheet[];
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


const MAX_OOXML_COMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_OOXML_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_OOXML_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_OOXML_ENTRIES = 4096;

function packageFiles(bytes: Uint8Array): Unzipped {
  if (bytes.length === 0 || bytes.length > MAX_OOXML_COMPRESSED_BYTES)
    throw new Error('OOXML archive exceeds compressed-size limit of 32 MB.');
  let count = 0, total = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      count++;
      total += file.originalSize;
      if (count > MAX_OOXML_ENTRIES || !Number.isSafeInteger(total) ||
        file.originalSize > MAX_OOXML_ENTRY_BYTES || total > MAX_OOXML_EXPANDED_BYTES)
        throw new Error('OOXML archive exceeds safe entry count or expanded-size budget.');
      return true;
    },
  });
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

/** Update paragraph text without flattening DOCX body, tables, styles,
 * drawings, bookmarks, section properties, comments, or relationships.
 *
 * This editor cannot safely create/delete whole rich paragraphs or redistribute
 * text among mixed styled runs. Refuse those unsupported edits explicitly.
 */
export function writeDocx(bytes: Uint8Array, paragraphs: string[]): Uint8Array {
  const files = packageFiles(bytes);
  const xml = xmlText(files, 'word/document.xml');
  const matches = Array.from(xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g));
  if (matches.length !== paragraphs.length) {
    throw new Error('This DOCX editor cannot safely add/remove rich paragraphs; original file unchanged.');
  }
  let index = 0;
  const next = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    const requested = paragraphs[index++];
    const original = textRuns(paragraphXml, 'w:t').join('');
    if (original === requested) return paragraphXml;
    // Rich structures must not be modified by flattening them into plain text.
    if (/<w:(?:hyperlink|fldChar|instrText|drawing|object|footnoteReference|endnoteReference|commentRangeStart|sdt)\b/.test(paragraphXml)) {
      throw new Error('Editing a paragraph with rich DOCX objects requires a rich-text editor; source preserved.');
    }
    const runs = Array.from(paragraphXml.matchAll(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g));
    if (!runs.length) {
      throw new Error('Adding text to a DOCX paragraph without a text run is not supported without structural changes.');
    }
    // Exact text replacement within existing run skeleton. Intentionally
    // preserve paragraph properties, run properties, and adjacent objects.
    let runIndex = 0;
    return paragraphXml.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
      const replacement = runIndex++ === 0 ? escapeXml(requested) : '';
      return '<w:t xml:space="preserve">' + replacement + '</w:t>';
    });
  });
  if (next === xml && paragraphs.some((p,i)=>p!==textRuns(matches[i][0], 'w:t').join(''))) {
    throw new Error('No DOCX paragraph changes were committed.');
  }
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


function xmlAttribute(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'))?.[1];
}

function workbookSheets(files: Unzipped): { path: string; name: string; hidden: boolean }[] {
  const workbook = xmlText(files, 'xl/workbook.xml');
  const tabs = Array.from(workbook.matchAll(/<sheet\b([^>]*)\/?>/g));
  if (!tabs.length) throw new Error('XLSX workbook has no sheet tabs.');
  // The lightweight grid has a bounded worksheet capability. Never silently
  // omit workbook tabs and then pretend the export covered the entire workbook.
  if (tabs.length > 64) throw new Error('This spreadsheet editor supports at most 64 worksheets.');
  const relIds = tabs.map((tab) => xmlAttribute(tab[1], 'r:id'));
  if (relIds.some(Boolean)) {
    if (relIds.some((id) => !id))
      throw new Error('XLSX workbook contains a sheet without a relationship.');
    const rels = xmlText(files, 'xl/_rels/workbook.xml.rels');
    const relationships = new Map(Array.from(rels.matchAll(/<Relationship\b([^>]*)\/?>/g))
      .map((match) => [xmlAttribute(match[1], 'Id'), xmlAttribute(match[1], 'Target')]));
    const used = new Set<string>();
    return tabs.map((tab, index) => {
      const target = relationships.get(relIds[index]);
      if (!target || target.includes('\\') || /^(?:[a-z]+:|\/\/)/i.test(target))
        throw new Error('XLSX worksheet relationship is missing or unsafe.');
      let path: string;
      if (target.startsWith('/')) path = target.slice(1);
      else {
        const parts = ['xl'];
        for (const segment of target.split('/')) {
          if (segment === '..') {
            if (!parts.length) throw new Error('XLSX worksheet relationship escapes package root.');
            parts.pop();
          } else if (segment && segment !== '.') parts.push(segment);
        }
        path = parts.join('/');
      }
      if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(path) || !files[path] || used.has(path))
        throw new Error('XLSX worksheet relationship is missing, duplicated or unsafe.');
      used.add(path);
      return { path, name: decodeXml(xmlAttribute(tab[1], 'name') ?? 'Sheet' + (index + 1)),
        hidden: /^(hidden|veryHidden)$/.test(xmlAttribute(tab[1], 'state') ?? '') };
    });
  }
  // Legacy minimal one-sheet fixtures may omit workbook relationships.
  // Multi-sheet packages without relationships are ambiguous: fail closed.
  const paths = Object.keys(files).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path));
  if (tabs.length !== 1 || paths.length !== 1)
    throw new Error('XLSX sheet tab order requires workbook relationships.');
  return [{ path: paths[0], name: decodeXml(xmlAttribute(tabs[0][1], 'name') ?? 'Sheet1'), hidden: false }];
}

function parseXlsxSheet(files: Unzipped, path: string): string[][] {
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
  return rows;
}

export function parseXlsx(bytes: Uint8Array): XlsxModel {
  const files = packageFiles(bytes);
  const sheets = workbookSheets(files).map(({ path, name, hidden }) =>
    ({ path, name, hidden, cells: parseXlsxSheet(files, path) }));
  const firstVisible = sheets.find((sheet) => !sheet.hidden);
  if (!firstVisible) throw new Error('XLSX workbook has no visible worksheet.');
  return {
    kind: 'xlsx',
    sheetPath: firstVisible.path,
    sheetName: firstVisible.name,
    cells: firstVisible.cells,
    sheets,
    fidelity: 'structure-preserving',
  };
}

function numeric(value: string): boolean {
  // Preserve leading-zero IDs, long numbers and scientific-notation text.
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) &&
    value.replace(/[^0-9]/g, '').length <= 15 && Number.isFinite(Number(value));
}

function changedCell(ref: string, value: string, existing?: string): string {
  if (!value) return '';
  const originalAttributes = existing?.match(/^<c\b([^>]*)>/)?.[1] ?? '';
  const style = xmlAttribute(originalAttributes, 's');
  const s = style === undefined ? '' : ' s="' + escapeXml(style) + '"';
  const oldType = xmlAttribute(originalAttributes, 't');
  const asNumber = existing && oldType !== 'inlineStr' && oldType !== 's' && numeric(value);
  return asNumber
    ? '<c r="' + ref + '"' + s + '><v>' + escapeXml(value) + '</v></c>'
    : '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' +
      escapeXml(value) + '</t></is></c>';
}

function patchCell(xml: string, ref: string, value: string): string {
  const cells = Array.from(xml.matchAll(/<c\b[^>]*>[\s\S]*?<\/c>|<c\b[^>]*\/>/g));
  const current = cells.find((match) => {
    const open = match[0].match(/^<c\b([^>]*?)(?:\/?)>/)?.[1] ?? '';
    return xmlAttribute(open, 'r') === ref;
  });
  if (current) return xml.replace(current[0], changedCell(ref, value, current[0]));
  if (!value) return xml;
  const cell = changedCell(ref, value);
  const rowNumber = rowIndex(ref) + 1;
  const rows = Array.from(xml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g));
  const currentRow = rows.find((match) =>
    Number(xmlAttribute(match[0].match(/^<row\b([^>]*)>/)?.[1] ?? '', 'r')) === rowNumber);
  if (currentRow)
    return xml.replace(currentRow[0], currentRow[0].replace('</row>', cell + '</row>'));
  const newRow = '<row r="' + rowNumber + '">' + cell + '</row>';
  const nextRow = rows.find((match) =>
    Number(xmlAttribute(match[0].match(/^<row\b([^>]*)>/)?.[1] ?? '', 'r')) > rowNumber);
  if (nextRow) return xml.replace(nextRow[0], newRow + nextRow[0]);
  if (xml.includes('</sheetData>')) return xml.replace('</sheetData>', newRow + '</sheetData>');
  if (/<sheetData\b[^>]*\/>/.test(xml))
    return xml.replace(/<sheetData\b[^>]*\/>/, '<sheetData>' + newRow + '</sheetData>');
  if (xml.includes('</worksheet>'))
    return xml.replace('</worksheet>', '<sheetData>' + newRow + '</sheetData></worksheet>');
  throw new Error('XLSX worksheet XML has no safe row insertion point.');
}

export function writeXlsx(bytes: Uint8Array, model: XlsxModel): Uint8Array {
  const files = packageFiles(bytes);
  const original = parseXlsx(bytes);
  if (original.sheetPath !== model.sheetPath)
    throw new Error('XLSX selected sheet identity changed; refusing unsafe export.');
  const beforeSheets = original.sheets!;
  const editedSheets = model.sheets ??
    [{ path: model.sheetPath, name: model.sheetName, cells: model.cells }];
  // Do not let an altered/incomplete sheet list silently redirect edits to
  // another tab, overwrite hidden sheets or discard a worksheet.
  if (model.sheets && (editedSheets.length !== beforeSheets.length ||
      editedSheets.some((sheet, i) => sheet.path !== beforeSheets[i].path ||
        sheet.name !== beforeSheets[i].name ||
        Boolean(sheet.hidden) !== Boolean(beforeSheets[i].hidden))))
    throw new Error('XLSX worksheet identities/order changed; original file preserved.');
  const updated: Unzipped = { ...files };
  for (let i = 0; i < editedSheets.length; i++) {
    const sheet = editedSheets[i];
    if (!beforeSheets.some((originalSheet) => originalSheet.path === sheet.path))
      throw new Error('XLSX edit references an unknown worksheet.');
    const before = beforeSheets.find((item) => item.path === sheet.path)!;
    const afterCells = sheet.path === model.sheetPath ? model.cells : sheet.cells;
    if (sheet.hidden && JSON.stringify(before.cells) !== JSON.stringify(afterCells))
      throw new Error('Editing hidden XLSX worksheets is not supported.');
    let xml = xmlText(files, sheet.path);
    for (let r = 0; r < Math.max(before.cells.length, afterCells.length); r++) {
      const oldRow = before.cells[r] ?? [];
      const newRow = afterCells[r] ?? [];
      for (let c = 0; c < Math.max(oldRow.length, newRow.length); c++) {
        if ((oldRow[c] ?? '') !== (newRow[c] ?? ''))
          xml = patchCell(xml, colName(c) + (r + 1), newRow[c] ?? '');
      }
    }
    if (xml !== xmlText(files, sheet.path)) updated[sheet.path] = strToU8(xml);
  }
  return zipSync(updated, { level: 6 });
}


function slidePaths(files: Unzipped): string[] {
  const presentation = xmlText(files, 'ppt/presentation.xml');
  const order = Array.from(presentation.matchAll(/<p:sldId\b([^>]*)\/?>/g))
    .map((match) => xmlAttribute(match[1], 'r:id'))
    .filter((id): id is string => Boolean(id));
  if (order.length) {
    const rels = xmlText(files, 'ppt/_rels/presentation.xml.rels');
    const relationships = new Map(Array.from(rels.matchAll(/<Relationship\b([^>]*)\/?>/g))
      .map((match) => [xmlAttribute(match[1], 'Id'), xmlAttribute(match[1], 'Target')]));
    const used = new Set<string>();
    return order.map((id) => {
      const target = relationships.get(id);
      if (!target || target.includes('\\') || /^(?:[a-z]+:|\/\/)/i.test(target))
        throw new Error('PowerPoint slide relationship is invalid or missing.');
      const segments = target.startsWith('/') ? [] : ['ppt'];
      for (const segment of target.replace(/^\//,'').split('/')) {
        if(segment==='..'){
          if (!segments.length) throw new Error('PowerPoint slide path escapes package root.');
          segments.pop();
        } else if(segment!=='.' && segment) segments.push(segment);
      }
      const path = segments.join('/');
      if (!/^ppt\/slides\/slide\d+\.xml$/i.test(path) || !files[path] || used.has(path))
        throw new Error('PowerPoint slide relationship is missing, duplicated or unsafe.');
      used.add(path);
      return path;
    });
  }
  // One-slide minimal fixtures can omit presentation relationship metadata.
  // Multi-slide presentations without the ordering table must not be silently
  // rendered in filename order.
  const paths = Object.keys(files).filter(path=>/^ppt\/slides\/slide\d+\.xml$/i.test(path));
  if (paths.length > 1)
    throw new Error('PowerPoint multi-slide package lacks canonical slide order.');
  return paths;
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
