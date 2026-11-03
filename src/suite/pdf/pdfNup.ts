/**
 * MAL-009 Multiple pages into one page (N-up): place several source pages on
 * each output sheet in a common grid, with sheet size and orientation,
 * margin and spacing, and row-first or column-first order.
 *
 * Pages are embedded as vector content (no rasterising). Each page's own
 * /Rotate is honoured. Annotations, links and form fields are not part of
 * embedded page content; the result reports how many were present so the
 * user is told rather than surprised.
 */
import { PDFArray, PDFDocument, PDFName, degrees, rgb } from 'pdf-lib';

export const PDF_NUP_MAX_INPUT_BYTES = 128 * 1024 * 1024;
export const PDF_NUP_MAX_PAGES = 1000;

export type NupPerSheet = 2 | 4 | 6 | 9 | 16;
export type NupSheet = 'letter' | 'a4' | 'source';
export interface NupOptions {
  perSheet: NupPerSheet;
  sheet: NupSheet;
  orientation: 'portrait' | 'landscape';
  /** Outer margin in points. */
  margin: number;
  /** Space between cells in points. */
  gap: number;
  /** rows: left to right, then down; columns: top to bottom, then right. */
  order: 'rows' | 'columns';
  borders: boolean;
}
export interface NupResult { bytes: Uint8Array; sheets: number; columns: number; rows: number; droppedAnnotations: number }

/** Grid for a count and orientation: wide sheets get more columns. */
export function nupGrid(perSheet: NupPerSheet, orientation: NupOptions['orientation']): { columns: number; rows: number } {
  const square: Partial<Record<NupPerSheet, number>> = { 4: 2, 9: 3, 16: 4 };
  if (square[perSheet]) return { columns: square[perSheet]!, rows: square[perSheet]! };
  const [wide, narrow] = perSheet === 2 ? [2, 1] : [3, 2];
  return orientation === 'landscape' ? { columns: wide, rows: narrow } : { columns: narrow, rows: wide };
}

/** Cell index (0-based) for a slot on a sheet in the chosen order. */
export function nupCell(slot: number, columns: number, rows: number, order: NupOptions['order']): { column: number; row: number } {
  return order === 'rows'
    ? { column: slot % columns, row: Math.floor(slot / columns) }
    : { column: Math.floor(slot / rows), row: slot % rows };
}

const SHEETS: Record<Exclude<NupSheet, 'source'>, [number, number]> = { letter: [612, 792], a4: [595.28, 841.89] };

export async function nupPdf(bytes: Uint8Array, options: NupOptions): Promise<NupResult> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > PDF_NUP_MAX_INPUT_BYTES) {
    throw new Error('N-up accepts PDFs up to 128 MB.');
  }
  if (![2, 4, 6, 9, 16].includes(options.perSheet)) throw new Error('Choose 2, 4, 6, 9 or 16 pages per sheet.');
  if (!(options.margin >= 0 && options.margin <= 144) || !(options.gap >= 0 && options.gap <= 144)) {
    throw new Error('Margin and spacing must be between 0 and 50 mm.');
  }
  let source: PDFDocument;
  let count: number;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
    count = source.getPageCount();
    if (count < 1) throw new Error('no pages');
  } catch { throw new Error('This file could not be arranged because it is encrypted, invalid or damaged.'); }
  if (count > PDF_NUP_MAX_PAGES) throw new Error(`N-up supports up to ${PDF_NUP_MAX_PAGES} pages.`);

  const firstSize = source.getPage(0).getSize();
  let [sheetWidth, sheetHeight] = options.sheet === 'source' ? [firstSize.width, firstSize.height] : SHEETS[options.sheet];
  if ((options.orientation === 'landscape') !== (sheetWidth > sheetHeight)) [sheetWidth, sheetHeight] = [sheetHeight, sheetWidth];

  const { columns, rows } = nupGrid(options.perSheet, options.orientation);
  const cellWidth = (sheetWidth - 2 * options.margin - (columns - 1) * options.gap) / columns;
  const cellHeight = (sheetHeight - 2 * options.margin - (rows - 1) * options.gap) / rows;
  if (cellWidth < 18 || cellHeight < 18) throw new Error('Margin and spacing leave no room for the pages; reduce them.');

  const output = await PDFDocument.create();
  const sourcePages = source.getPages();
  const embedded = await output.embedPages(sourcePages);
  let droppedAnnotations = 0;
  let sheet = output.addPage([sheetWidth, sheetHeight]);
  let sheets = 1;
  sourcePages.forEach((sourcePage, index) => {
    const annots = sourcePage.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    droppedAnnotations += annots?.size() ?? 0;
    const slot = index % options.perSheet;
    if (index > 0 && slot === 0) { sheet = output.addPage([sheetWidth, sheetHeight]); sheets++; }
    const { column, row } = nupCell(slot, columns, rows, options.order);
    const cellX = options.margin + column * (cellWidth + options.gap);
    const cellTop = sheetHeight - options.margin - row * (cellHeight + options.gap);
    const cellY = cellTop - cellHeight;

    const rotation = ((sourcePage.getRotation().angle % 360) + 360) % 360;
    const page = embedded[index];
    const [width, height] = [page.width, page.height];
    const [shownWidth, shownHeight] = rotation % 180 === 90 ? [height, width] : [width, height];
    const scale = Math.min(cellWidth / shownWidth, cellHeight / shownHeight);
    const boxX = cellX + (cellWidth - shownWidth * scale) / 2;
    const boxY = cellY + (cellHeight - shownHeight * scale) / 2;
    // Draw rotated clockwise by the page's /Rotate (pdf-lib rotates counter-clockwise).
    const origin = rotation === 90 ? [boxX, boxY + width * scale]
      : rotation === 180 ? [boxX + width * scale, boxY + height * scale]
        : rotation === 270 ? [boxX + height * scale, boxY] : [boxX, boxY];
    sheet.drawPage(page, { x: origin[0], y: origin[1], xScale: scale, yScale: scale, rotate: degrees(-rotation) });
    if (options.borders) {
      sheet.drawRectangle({ x: boxX, y: boxY, width: shownWidth * scale, height: shownHeight * scale, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
    }
  });
  output.setProducer('MALENJO');
  const out = Uint8Array.from(await output.save({ useObjectStreams: true }));
  return { bytes: out, sheets, columns, rows, droppedAnnotations };
}
