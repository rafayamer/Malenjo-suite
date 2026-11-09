import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { strToU8, zipSync } from 'fflate';
import { exportConversionFile } from './api';
import { loadPdfForConversion, disposePdf } from './engine';
import { pdfToImages, type RasterOptions } from './convert/rasterExport';
import { readPdfStructure } from './convert/pdfStructure';
import { pdfToSvg } from './convert/svgExport';
import { pdfToHtml, pdfToMarkdown, pdfToPlainText, type ConversionResult, type PageSeparator } from './convert/textFormats';
import type { ReadingOrder } from './convert/pdfStructure';
import { describePdfError } from './pdfUserErrors';

export type ExportFormat = 'png' | 'jpeg' | 'tiff' | 'markdown' | 'html' | 'svg' | 'text';
export const EXPORT_FORMATS: [ExportFormat, string][] = [['png', 'PNG image'], ['jpeg', 'JPG image'], ['tiff', 'TIFF image'], ['markdown', 'Markdown'],
  ['html', 'HTML'], ['svg', 'SVG'], ['text', 'Plain text']];
export interface ExportRegion { pageNumber: number; x: number; y: number; width: number; height: number; /** View rotation the region was drawn in. */ viewRotation?: number }
interface Props {
  domIdPrefix: string; bytes: Uint8Array; sourceName: string; pageCount: number; currentPage: number; busy: boolean;
  region: ExportRegion | null; picking: boolean; onPickRegion(on: boolean): void; onClearRegion(): void;
  onNotice(message: string): void; onClose(): void;
}

/** Pages from text like "1-3, 5, 8-" (or "all"). */
function pagesFrom(text: string, count: number): number[] {
  const value = text.trim().toLowerCase();
  if (!value || value === 'all') return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (const piece of value.split(',').map((p) => p.trim()).filter(Boolean)) {
    const match = /^(\d+)\s*(?:-\s*(\d*))?$/.exec(piece);
    if (!match) throw new Error(`“${piece}” is not a page or range. Use forms like 4, 2-7 or 8-.`);
    const from = Number(match[1]), to = match[2] === undefined ? from : match[2] === '' ? count : Number(match[2]);
    if (from < 1 || to > count || from > to) throw new Error(`Pages ${piece} are outside 1–${count}.`);
    for (let p = from; p <= to; p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}
const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** MAL-029, 036, 041 – 044: export pages as images, Markdown, HTML, SVG or plain text, with a fidelity report. */
export default function PdfExportDialog({ domIdPrefix, bytes, sourceName, pageCount, currentPage, busy, region, picking, onPickRegion, onClearRegion, onNotice, onClose }: Props) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [pages, setPages] = useState('all');
  const [dpi, setDpi] = useState('150');
  const [quality, setQuality] = useState('85');
  const [transparent, setTransparent] = useState(true);
  const [removeOn, setRemoveOn] = useState(false);
  const [removeColor, setRemoveColor] = useState('#ffffff');
  const [tolerance, setTolerance] = useState('16');
  const [tiffCompression, setTiffCompression] = useState<'none' | 'deflate'>('deflate');
  const [tiffMultipage, setTiffMultipage] = useState(true);
  const [images, setImages] = useState(true);
  const [layout, setLayout] = useState<'semantic' | 'positioned'>('semantic');
  const [order, setOrder] = useState<ReadingOrder>('rows');
  const [separator, setSeparator] = useState<PageSeparator>('blank');
  const [template, setTemplate] = useState('--- Page {n} of {total} ---');
  const [running, setRunning] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>('select')?.focus(); }, []);
  useEffect(() => () => abortRef.current?.abort(), []);
  const raster = format === 'png' || format === 'jpeg' || format === 'tiff';
  const title = (sourceName || 'document.pdf').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-') || 'document';

  async function run() {
    setError(''); setReport([]);
    const controller = new AbortController(); abortRef.current = controller;
    let loaded: Awaited<ReturnType<typeof loadPdfForConversion>> | null = null;
    try {
      const chosen = pagesFrom(pages, pageCount);
      setRunning('Preparing…');
      let result: ConversionResult;
      if (format === 'svg') result = await pdfToSvg(bytes, chosen, title);
      else {
        loaded = await loadPdfForConversion(bytes);
        if (raster) {
          const options: RasterOptions = {
            format, dpi: Number(dpi), quality: Number(quality) / 100, transparent: format !== 'jpeg' && transparent,
            removeColor: format !== 'jpeg' && removeOn ? { rgb: hexRgb(removeColor), tolerance: Number(tolerance) } : null,
            region: format === 'png' && region ? region : null, tiffCompression, tiffMultipage,
          };
          result = await pdfToImages(loaded.document, chosen, options, title, (done, total) => setRunning(`Page ${done} of ${total}…`), controller.signal);
        } else {
          const structure = await readPdfStructure(loaded.document, chosen, { images: format !== 'text' && images, signal: controller.signal });
          result = format === 'markdown' ? pdfToMarkdown(structure, { images, title })
            : format === 'html' ? pdfToHtml(structure, { images, title, layout })
              : pdfToPlainText(structure, pageCount, { order, separator, template, title });
        }
      }
      // Cancelled (or closed) while converting: nothing is saved.
      if (controller.signal.aborted) return;
      // One file downloads as itself; several (pages, or a document with its images) as a ZIP.
      const [file] = result.files;
      const single = result.files.length === 1;
      const name = single ? file.name : `${title}-${format}.zip`;
      const out = single ? file.bytes : zipSync(Object.fromEntries([...result.files.map((f) => [f.name, f.bytes] as const), ['export-report.txt', strToU8(result.notes.join('\n') + '\n')] as const]), { level: 6 });
      if (await exportConversionFile(name, out, single ? file.mime : 'application/zip')) {
        onNotice(`Exported ${name}.`);
        setReport(result.notes);
      }
    } catch (reason) {
      setError(reason instanceof Error && reason.name === 'AbortError' ? 'The export was cancelled.' : describePdfError(reason));
    } finally { await disposePdf(loaded); setRunning(''); abortRef.current = null; }
  }

  const id = (s: string) => `${domIdPrefix}-export-${s}`;
  return <section ref={panelRef} className="pdf-markup-panel pdf-form-panel" role="dialog" aria-modal="false" aria-labelledby={id('title')}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (picking) onPickRegion(false); else onClose(); } }}>
    <header>
      <h2 id={id('title')}>Export as</h2>
      <button type="button" aria-label="Close export" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <fieldset>
      <legend>What to export</legend>
      <label><span>Format</span><select aria-label="Export format" value={format} onChange={(e) => { setFormat(e.target.value as ExportFormat); setReport([]); }}>
        {EXPORT_FORMATS.map(([f, l]) => <option key={f} value={f}>{l}</option>)}</select></label>
      <label><span>Pages (for example 1-3, 5 or all)</span><input aria-label="Export pages" value={pages} disabled={format === 'png' && Boolean(region)} onChange={(e) => setPages(e.target.value)}/></label>
      <button type="button" onClick={() => setPages(String(currentPage))}>Current page only</button>
    </fieldset>
    {raster && <fieldset>
      <legend>Image settings</legend>
      <label><span>Resolution (dpi)</span><input aria-label="Export resolution" type="number" min={36} max={600} value={dpi} onChange={(e) => setDpi(e.target.value)}/></label>
      {format === 'jpeg' && <label><span>Quality (30 – 100)</span><input aria-label="JPEG quality" type="number" min={30} max={100} value={quality} onChange={(e) => setQuality(e.target.value)}/></label>}
      {format !== 'jpeg' && <>
        <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)}/>Transparent page background</label>
        <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={removeOn} onChange={(e) => setRemoveOn(e.target.checked)}/>Remove a background colour</label>
        {removeOn && <>
          <label><span>Colour to remove</span><input aria-label="Background colour to remove" type="color" value={removeColor} onChange={(e) => setRemoveColor(e.target.value)}/></label>
          <label><span>Tolerance (0 – 255)</span><input aria-label="Background removal tolerance" type="number" min={0} max={255} value={tolerance} onChange={(e) => setTolerance(e.target.value)}/></label>
        </>}
      </>}
      {format === 'png' && <div className="pdf-tool-dialog-actions">
        <button type="button" aria-pressed={picking} onClick={() => onPickRegion(!picking)}>Drag a region on the page</button>
        {region && <button type="button" onClick={onClearRegion}>Whole pages</button>}
      </div>}
      {format === 'png' && picking && <p role="status">Drag over the part of a page to export; press Escape to stop.</p>}
      {format === 'png' && region && <p>Region on page {region.pageNumber}: {Math.round(region.width * 100)}% × {Math.round(region.height * 100)}% of the page.</p>}
      {format === 'tiff' && <>
        <label><span>Compression</span><select aria-label="TIFF compression" value={tiffCompression} onChange={(e) => setTiffCompression(e.target.value as 'none' | 'deflate')}>
          <option value="deflate">Deflate (lossless)</option><option value="none">None</option></select></label>
        <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={tiffMultipage} onChange={(e) => setTiffMultipage(e.target.checked)}/>One multi-page TIFF</label>
      </>}
    </fieldset>}
    {(format === 'markdown' || format === 'html') && <fieldset>
      <legend>Document settings</legend>
      <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)}/>Include images (saved as PNG files)</label>
      {format === 'html' && <label><span>Layout</span><select aria-label="HTML layout" value={layout} onChange={(e) => setLayout(e.target.value as 'semantic' | 'positioned')}>
        <option value="semantic">Structured (headings, lists, tables)</option><option value="positioned">As on the page (positioned text)</option></select></label>}
    </fieldset>}
    {format === 'text' && <fieldset>
      <legend>Text settings</legend>
      <label><span>Reading order</span><select aria-label="Reading order" value={order} onChange={(e) => setOrder(e.target.value as ReadingOrder)}>
        <option value="rows">Top to bottom, left to right</option><option value="columns">Columns, left column first</option><option value="stored">As stored in the file</option></select></label>
      <label><span>Between pages</span><select aria-label="Page separator" value={separator} onChange={(e) => setSeparator(e.target.value as PageSeparator)}>
        <option value="blank">Blank line</option><option value="none">Nothing</option><option value="formfeed">Page break (form feed)</option><option value="custom">Custom line</option></select></label>
      {separator === 'custom' && <label><span>Separator line ({'{n}'} = page, {'{total}'} = pages)</span><input aria-label="Page separator text" value={template} onChange={(e) => setTemplate(e.target.value)}/></label>}
      <p>Text comes from the PDF's text layer, including text added by OCR.</p>
    </fieldset>}
    <div className="pdf-tool-dialog-actions">
      <button type="button" className="primary-action" disabled={busy || Boolean(running)} onClick={() => void run()}>Export</button>
      {running && <button type="button" onClick={() => abortRef.current?.abort()}>Cancel</button>}
    </div>
    {running && <p role="status">{running}</p>}
    {report.length > 0 && <section aria-label="Export report"><p><strong>Export report</strong></p><ul>{report.map((note) => <li key={note}>{note}</li>)}</ul></section>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
  </section>;
}
