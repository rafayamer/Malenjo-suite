import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { strToU8, zipSync } from 'fflate';
import { exportConversionFile, exportPdfBytes } from './api';
import { docxToPdf } from './convert/docxToPdf';
import { htmlToPdf } from './convert/htmlToPdf';
import { imagesToPdf, type PageSizeName } from './convert/imagesToPdf';
import { pptxToPdf } from './convert/pptxToPdf';
import { xlsxToPdf } from './convert/xlsxToPdf';
import { describePdfError } from './pdfUserErrors';

type Mode = 'images' | 'word' | 'powerpoint' | 'excel' | 'html';
const MODES: [Mode, string, string][] = [
  ['images', 'Images (JPG, PNG, TIFF, WebP, BMP)', '.jpg,.jpeg,.png,.tif,.tiff,.webp,.bmp,.gif'], ['word', 'Word (DOCX)', '.docx'],
  ['powerpoint', 'PowerPoint (PPTX)', '.pptx'], ['excel', 'Excel (XLSX)', '.xlsx'], ['html', 'HTML', '.html,.htm'],
];
const SIZES: [PageSizeName, string][] = [['image', 'Same as the image'], ['a4', 'A4'], ['letter', 'Letter'], ['legal', 'Legal'], ['a3', 'A3'], ['a5', 'A5']];
interface Result { source: string; pdf: File | null; pages: number; notes: string[] }
interface Props { domIdPrefix: string; onOpenPdfs?(files: File[]): void; onNotice(message: string): void; onClose(): void }

/** Browser-decoded formats (WebP, BMP, GIF) become PNG before the image engine sees them. */
async function asSupportedImage(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!/\.(webp|bmp|gif)$/i.test(file.name)) return bytes;
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  try {
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    if (!blob) throw new Error(`${file.name} could not be read.`);
    return new Uint8Array(await blob.arrayBuffer());
  } finally { bitmap.close(); canvas.width = 0; }
}

/** MAL-030 – MAL-034: images, Word, PowerPoint, Excel and HTML to PDF, each with a fidelity report. */
export default function PdfCreateDialog({ domIdPrefix, onOpenPdfs, onNotice, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('images');
  const [files, setFiles] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState<PageSizeName>('a4');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [margin, setMargin] = useState('36');
  const [fit, setFit] = useState<'fit' | 'actual'>('fit');
  const [sheetOrientation, setSheetOrientation] = useState<'sheet' | 'portrait' | 'landscape'>('sheet');
  const [gridlines, setGridlines] = useState<'sheet' | 'on' | 'off'>('sheet');
  const [sheets, setSheets] = useState<'all' | 'visible'>('visible');
  const [openResults, setOpenResults] = useState(true);
  const [running, setRunning] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>('select')?.focus(); }, []);
  const accept = MODES.find(([m]) => m === mode)![2];
  const move = (i: number, d: number) => { const next = [...files]; const [f] = next.splice(i, 1); next.splice(i + d, 0, f); setFiles(next); };
  const docSize = (pageSize === 'image' ? 'a4' : pageSize) as Exclude<PageSizeName, 'image'>;

  async function create() {
    setError(''); setResults([]);
    if (!files.length) { setError('Add at least one file.'); return; }
    const out: Result[] = [];
    const pdfFile = (bytes: Uint8Array, name: string) => new File([bytes.slice().buffer as ArrayBuffer], name, { type: 'application/pdf' });
    try {
      if (mode === 'images') {
        setRunning('Reading images…');
        const images = [];
        for (const file of files) images.push({ name: file.name, bytes: await asSupportedImage(file) });
        setRunning('Creating the PDF…');
        const result = await imagesToPdf(images, { pageSize, orientation, margin: Number(margin), fit });
        out.push({ source: files.length > 1 ? `${files.length} images` : files[0].name, pdf: pdfFile(result.bytes, `${files[0].name.replace(/\.[^.]+$/, '')}${files.length > 1 ? '-images' : ''}.pdf`), pages: result.pages, notes: result.notes });
      } else {
        for (const [i, file] of files.entries()) {
          setRunning(`Converting ${file.name} (${i + 1} of ${files.length})…`);
          try {
            if (file.size > 64 * 1024 * 1024) throw new Error('Files over 64 MB are not converted here.');
            const bytes = new Uint8Array(await file.arrayBuffer());
            const result = mode === 'word' ? await docxToPdf(bytes) : mode === 'powerpoint' ? await pptxToPdf(bytes)
              : mode === 'excel' ? await xlsxToPdf(bytes, { pageSize: docSize, orientation: sheetOrientation, gridlines, sheets })
                : await htmlToPdf(new TextDecoder().decode(bytes), { pageSize: docSize, landscape: orientation === 'landscape', margin: Number(margin) });
            out.push({ source: file.name, pdf: pdfFile(result.bytes, file.name.replace(/\.[^.]+$/, '') + '.pdf'), pages: result.pages, notes: result.notes });
          } catch (reason) { out.push({ source: file.name, pdf: null, pages: 0, notes: [describePdfError(reason)] }); }
        }
      }
    } catch (reason) { setError(describePdfError(reason)); }
    setRunning(''); setResults(out);
    const done = out.filter((r) => r.pdf);
    if (done.length) onNotice(`Created ${done.length} PDF${done.length > 1 ? 's' : ''}.`);
    if (openResults && done.length && onOpenPdfs) onOpenPdfs(done.map((r) => r.pdf!));
  }
  async function download() {
    try {
      const done = results.filter((r) => r.pdf);
      if (done.length === 1) { if (await exportPdfBytes(done[0].pdf!.name, new Uint8Array(await done[0].pdf!.arrayBuffer()))) onNotice(`Exported ${done[0].pdf!.name}.`); return; }
      const zip: Record<string, Uint8Array> = {};
      for (const r of done) zip[r.pdf!.name] = new Uint8Array(await r.pdf!.arrayBuffer());
      zip['conversion-report.json'] = strToU8(JSON.stringify(results.map((r) => ({ source: r.source, output: r.pdf?.name ?? null, pages: r.pages, report: r.notes })), null, 2));
      if (await exportConversionFile('created-pdfs.zip', zipSync(zip), 'application/zip')) onNotice('Exported created-pdfs.zip.');
    } catch (reason) { setError(describePdfError(reason)); }
  }

  const id = (s: string) => `${domIdPrefix}-create-${s}`;
  return <section ref={panelRef} className="pdf-markup-panel pdf-form-panel" role="dialog" aria-modal="false" aria-labelledby={id('title')}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={id('title')}>Create PDF from files</h2>
      <button type="button" aria-label="Close create PDF" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <fieldset>
      <legend>Files</legend>
      <label><span>Convert from</span><select aria-label="Convert from" value={mode} onChange={(e) => { setMode(e.target.value as Mode); setFiles([]); setResults([]); }}>
        {MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></label>
      <button type="button" onClick={() => fileRef.current?.click()}>Add files…</button>
      <input ref={fileRef} type="file" hidden multiple accept={accept} aria-label="Files to convert" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 200)); e.target.value = ''; }}/>
      {files.length > 0 && <ol className="pdf-merge-list static" aria-label="Files in order">{files.map((f, i) => <li key={`${f.name}-${i}`}>
        <span className="pdf-merge-name">{f.name}</span>
        <button type="button" aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} aria-hidden="true"/></button>
        <button type="button" aria-label={`Move ${f.name} down`} disabled={i === files.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} aria-hidden="true"/></button>
        <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, k) => k !== i))}><X size={14} aria-hidden="true"/></button>
      </li>)}</ol>}
    </fieldset>
    {(mode === 'images' || mode === 'excel' || mode === 'html') && <fieldset>
      <legend>Page settings</legend>
      <label><span>Page size</span><select aria-label="Page size" value={mode !== 'images' && pageSize === 'image' ? 'a4' : pageSize} onChange={(e) => setPageSize(e.target.value as PageSizeName)}>
        {SIZES.filter(([s]) => mode === 'images' || s !== 'image').map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select></label>
      {mode !== 'excel' && <label><span>Orientation</span><select aria-label="Orientation" value={orientation} onChange={(e) => setOrientation(e.target.value as typeof orientation)}>
        <option value="auto">{mode === 'images' ? 'Match each image' : 'Portrait'}</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>}
      {mode !== 'excel' && <label><span>Margin (points, 72 = 1 inch)</span><input aria-label="Margin" type="number" min={0} max={144} value={margin} onChange={(e) => setMargin(e.target.value)}/></label>}
      {mode === 'images' && <label><span>Image size</span><select aria-label="Image fit" value={fit} onChange={(e) => setFit(e.target.value as 'fit' | 'actual')}>
        <option value="fit">Fit the page</option><option value="actual">Actual size (96 per inch)</option></select></label>}
      {mode === 'excel' && <>
        <label><span>Orientation</span><select aria-label="Sheet orientation" value={sheetOrientation} onChange={(e) => setSheetOrientation(e.target.value as typeof sheetOrientation)}>
          <option value="sheet">As set in each sheet</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
        <label><span>Gridlines</span><select aria-label="Gridlines" value={gridlines} onChange={(e) => setGridlines(e.target.value as typeof gridlines)}>
          <option value="sheet">As set in each sheet</option><option value="on">Print gridlines</option><option value="off">No gridlines</option></select></label>
        <label><span>Sheets</span><select aria-label="Sheets to print" value={sheets} onChange={(e) => setSheets(e.target.value as typeof sheets)}>
          <option value="visible">Visible sheets</option><option value="all">All sheets</option></select></label>
        <p>A sheet's print area is used when it has one.</p>
      </>}
    </fieldset>}
    {(mode === 'word' || mode === 'powerpoint') && <p>Pages use the document's own {mode === 'word' ? 'page size and margins' : 'slide size'}.</p>}
    <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={openResults} onChange={(e) => setOpenResults(e.target.checked)}/>Open the PDFs in MALENJO</label>
    <div className="pdf-tool-dialog-actions">
      <button type="button" className="primary-action" disabled={Boolean(running) || !files.length} onClick={() => void create()}>Create PDF</button>
      {results.some((r) => r.pdf) && <button type="button" onClick={() => void download()}>Download</button>}
    </div>
    {running && <p role="status">{running}</p>}
    {results.length > 0 && <section aria-label="Creation report"><p><strong>Fidelity report</strong></p>
      <ul>{results.map((r) => <li key={r.source}><strong>{r.source}</strong>: {r.pdf ? `${r.pdf.name}, ${r.pages} page(s)` : 'failed'}<ul>{r.notes.map((n) => <li key={n}>{n}</li>)}</ul></li>)}</ul></section>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <small>Office and HTML files are drawn by MALENJO's own renderers with standard PDF fonts; the report lists anything not reproduced. HTML scripts never run and nothing is downloaded.</small>
  </section>;
}
