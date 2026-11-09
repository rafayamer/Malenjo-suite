import { useEffect, useRef, useState } from 'react';
import { FilePlus2, X } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { exportConversionFile } from './api';
import { disposePdf, loadPdfForConversion, type PdfLoadResult } from './engine';
import { compareReportHtml, comparePageTexts, comparePixels, type PageTextDiff } from './pdfCompare';
import { describePdfError } from './pdfUserErrors';

interface Revision { index: number; label: string; bytes: Uint8Array }
interface Props {
  domIdPrefix: string;
  sourceName: string;
  getBytes(): Uint8Array | null;
  /** Earlier revisions of the open document (oldest first), from the edit history. */
  revisions: Revision[];
  onClose(): void;
}
type Mode = 'side' | 'overlay' | 'text';
const SCALE = 1.25;

async function pageTexts(doc: PDFDocumentProxy): Promise<string[]> {
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) out.push(((await (await doc.getPage(n)).getTextContent()).items as { str?: string }[]).map((i) => i.str ?? '').join(' '));
  return out;
}
/** Renders a page onto a white canvas of the given size (pages of different sizes share the larger box). */
async function render(doc: PDFDocumentProxy, pageNumber: number, width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
  if (pageNumber <= doc.numPages) {
    const page = await doc.getPage(pageNumber);
    await page.render({ canvasContext: context, canvas, viewport: page.getViewport({ scale: SCALE }) } as never).promise;
  }
  return canvas;
}
async function pageSize(doc: PDFDocumentProxy, n: number) {
  if (n > doc.numPages) return [0, 0];
  const v = (await doc.getPage(n)).getViewport({ scale: SCALE });
  return [Math.ceil(v.width), Math.ceil(v.height)];
}

/** MAL-059: compares the open document with another file or an earlier revision. */
export default function PdfCompareDialog({ domIdPrefix, sourceName, getBytes, revisions, onClose }: Props) {
  const [before, setBefore] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [docs, setDocs] = useState<{ before: PdfLoadResult; after: PdfLoadResult } | null>(null);
  const [texts, setTexts] = useState<PageTextDiff[] | null>(null);
  const [mode, setMode] = useState<Mode>('side'); const [pageNumber, setPageNumber] = useState(1);
  const [visual, setVisual] = useState<(number | null)[]>([]);
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null); const ref = useRef<HTMLElement>(null);
  const beforeHost = useRef<HTMLDivElement>(null); const afterHost = useRef<HTMLDivElement>(null); const overlayHost = useRef<HTMLDivElement>(null);
  const [changed, setChanged] = useState<number | null>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }, []);
  useEffect(() => () => { if (docs) { void disposePdf(docs.before); void disposePdf(docs.after); } }, [docs]);

  async function start(choice: { name: string; bytes: Uint8Array }) {
    setWorking(true); setError(''); setBefore(choice); setTexts(null); setVisual([]); setPageNumber(1);
    try {
      const afterBytes = getBytes();
      if (!afterBytes) throw new Error('The open document is not loaded.');
      const loaded = { before: await loadPdfForConversion(choice.bytes), after: await loadPdfForConversion(afterBytes) };
      setDocs((old) => { if (old) { void disposePdf(old.before); void disposePdf(old.after); } return loaded; });
      setTexts(comparePageTexts(await pageTexts(loaded.before.document), await pageTexts(loaded.after.document)));
    } catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); }
  }

  // Draw the chosen page in the chosen mode.
  useEffect(() => {
    if (!docs || !texts || mode === 'text') return;
    let live = true;
    (async () => {
      const [bw, bh] = await pageSize(docs.before.document, pageNumber); const [aw, ah] = await pageSize(docs.after.document, pageNumber);
      const width = Math.max(bw, aw, 1), height = Math.max(bh, ah, 1);
      const [b, a] = [await render(docs.before.document, pageNumber, width, height), await render(docs.after.document, pageNumber, width, height)];
      if (!live) return;
      const read = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, width, height);
      const overlay = document.createElement('canvas'); overlay.width = width; overlay.height = height;
      const image = overlay.getContext('2d')!.createImageData(width, height);
      const diff = comparePixels(read(b).data, read(a).data, width, height, image.data);
      overlay.getContext('2d')!.putImageData(image, 0, 0);
      setChanged(diff.changed); setVisual((v) => { const next = [...v]; next[pageNumber - 1] = diff.changed / diff.total; return next; });
      const show = (host: HTMLDivElement | null, canvas: HTMLCanvasElement, label: string) => {
        if (!host) return;
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label); canvas.dataset.changedPixels = String(diff.changed);
        canvas.style.width = '100%'; canvas.style.height = 'auto'; host.replaceChildren(canvas);
      };
      show(beforeHost.current, b, `Before, page ${pageNumber}`); show(afterHost.current, a, `After, page ${pageNumber}`);
      show(overlayHost.current, overlay, `Overlay of page ${pageNumber}: red is new, blue is removed`);
    })().catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [docs, texts, mode, pageNumber]);

  const pages = texts?.length ?? 0;
  const differing = texts?.filter((p) => p.added || p.removed).length ?? 0;
  const titleId = `${domIdPrefix}-compare-title`;
  async function saveReport() {
    try {
      const html = compareReportHtml(before!.name, sourceName, texts!, visual);
      const name = `${sourceName.replace(/\.pdf$/i, '') || 'document'}-comparison.html`;
      if (await exportConversionFile(name, new TextEncoder().encode(html), 'text/html')) setError('');
    } catch (reason) { setError(describePdfError(reason)); }
  }

  return <section ref={ref} className="pdf-tool-dialog pdf-compare-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <header><h2 id={titleId}>Compare</h2><button type="button" aria-label="Close compare" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button></header>
    <p>Compare the open document (after) with:</p>
    <input ref={inputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" aria-hidden="true" tabIndex={-1}
      onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void file.arrayBuffer().then((b) => start({ name: file.name, bytes: new Uint8Array(b) })); }}/>
    <div className="pdf-compare-sources">
      <button type="button" data-autofocus disabled={working} onClick={() => inputRef.current?.click()}><FilePlus2 size={15} aria-hidden="true"/> Another PDF…</button>
      {revisions.length > 0 && <label>Earlier revision<select aria-label="Earlier revision" value="" disabled={working}
        onChange={(e) => { const r = revisions.find((x) => x.index === Number(e.target.value)); if (r) void start({ name: `revision: ${r.label}`, bytes: r.bytes }); }}>
        <option value="" disabled>Choose…</option>{revisions.map((r) => <option key={r.index} value={r.index}>{r.label}</option>)}</select></label>}
    </div>
    {working && <p>Comparing…</p>}
    {texts && before && <>
      <p role="status">Before: {before.name}. {differing} of {pages} page{pages === 1 ? '' : 's'} have text changes; {texts.reduce((n, p) => n + p.added, 0)} word(s) added, {texts.reduce((n, p) => n + p.removed, 0)} removed.</p>
      <div role="tablist" aria-label="Comparison view" className="pdf-compare-modes">
        {([['side', 'Side by side'], ['overlay', 'Overlay'], ['text', 'Text changes']] as [Mode, string][]).map(([m, label]) =>
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>{label}</button>)}
      </div>
      {mode !== 'text' && <>
        <label>Page<select aria-label="Compared page" value={pageNumber} onChange={(e) => setPageNumber(Number(e.target.value))}>
          {Array.from({ length: pages }, (_, i) => <option key={i} value={i + 1}>{i + 1}{texts[i].added || texts[i].removed ? ' (text changed)' : ''}</option>)}</select></label>
        <p>{changed === null ? 'Rendering…' : changed ? `${changed.toLocaleString()} pixel(s) differ on this page.` : 'This page looks the same.'}</p>
      </>}
      {mode === 'side' && <div className="pdf-compare-side"><figure><figcaption>Before</figcaption><div ref={beforeHost}/></figure><figure><figcaption>After</figcaption><div ref={afterHost}/></figure></div>}
      {mode === 'overlay' && <figure className="pdf-compare-overlay"><figcaption>Red: new in the open document. Blue: no longer there.</figcaption><div ref={overlayHost}/></figure>}
      {mode === 'text' && <div className="pdf-compare-text" aria-label="Text changes by page">
        {texts.filter((p) => p.added || p.removed).map((p) => <section key={p.pageNumber}><h3>Page {p.pageNumber}</h3>
          <ul>{p.parts.filter((part) => part.kind !== 'same').map((part, i) => <li key={i} className={part.kind}>{part.kind === 'added' ? 'Added: ' : 'Removed: '}{part.text}</li>)}</ul></section>)}
        {!differing && <p>No text changed.</p>}
      </div>}
      <button type="button" onClick={() => void saveReport()}>Save comparison report (HTML)</button>
    </>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <small>Pages are paired by position. Text changes compare the words on each page; the overlay compares the rendered pages pixel by pixel.</small>
  </section>;
}
