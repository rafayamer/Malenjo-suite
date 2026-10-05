import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  Minus,
  Plus,
  Printer,
  RotateCw,
} from 'lucide-react';
import type { DocumentSession } from '../files/session';
import { isDesktopRuntime } from '../files/api';
import { exportPdfBytes, readPdfDocumentBytes } from './api';
import {
  appendPdf,
  deletePdfPage,
  duplicatePdfPage,
  extractPdfPage,
  insertBlankPdfPage,
  movePdfPage,
  rotatePdfPagePermanent,
} from './editor';
import { disposePdf, loadPdfBytes, type PdfLoadResult } from './engine';
import {
  clampPdfPage,
  rotatePdfClockwise,
  stepPdfZoom,
  type PdfFitMode,
} from './layout';
import PdfPageCanvas from './PdfPageCanvas';
import PdfThumbnail from './PdfThumbnail';
import { useScrollFps } from './useScrollFps';

interface Props {
  session: DocumentSession | null;
  notice: string;
  onBackToFiles(): void;
  onDirtyChange?(dirty:boolean): void;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function editedName(name:string,suffix='edited'):string{
  const base=name.replace(/\.pdf$/i,'')||'MALENJO-document';
  return `${base}-${suffix}.pdf`;
}

export default function PdfWorkspace({ session, notice, onBackToFiles, onDirtyChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appendInputRef = useRef<HTMLInputElement>(null);
  const activeLoadRef = useRef<PdfLoadResult | null>(null);
  const requestIdRef = useRef(0);
  const loadStartedRef = useRef(0);
  const firstPageReportedRef = useRef(false);
  const previewIdRef = useRef(`pdf-preview-${Math.random().toString(36).slice(2)}`);

  const [pdf, setPdf] = useState<PdfLoadResult | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [sourceName, setSourceName] = useState('PDF Workspace');
  const [browserFile, setBrowserFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [fitMode, setFitMode] = useState<PdfFitMode>('width');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [firstPageMs, setFirstPageMs] = useState<number | null>(null);
  const [forceRenderAll, setForceRenderAll] = useState(false);
  const [viewport, setViewport] = useState({ width: 900, height: 700 });
  const scrollFps = useScrollFps(scrollRef);
  const domIdPrefix=session?.id??previewIdRef.current;

  const installPdf = useCallback(async (
    input: ArrayBuffer | Uint8Array,
    name: string,
    file: File | null = null,
    preserveDirty = false,
  ) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    setActionNotice('');
    setFirstPageMs(null);
    firstPageReportedRef.current = false;
    loadStartedRef.current = performance.now();

    try {
      const owned = input instanceof Uint8Array ? Uint8Array.from(input) : new Uint8Array(input.slice(0));
      const result = await loadPdfBytes(owned);
      if (requestId !== requestIdRef.current) {
        await disposePdf(result);
        return;
      }

      await disposePdf(activeLoadRef.current);
      activeLoadRef.current = result;
      setPdf(result);
      setSourceBytes(owned);
      setBrowserFile(file);
      setSourceName(name);
      setPageCount(result.document.numPages);
      setCurrentPage(1);
      setFitMode('width');
      setZoom(1);
      setRotation(0);
      setForceRenderAll(false);
      if(!preserveDirty)setDirty(false);
    } catch (reason) {
      if (requestId === requestIdRef.current) {
        setPdf(null);
        setSourceBytes(null);
        setPageCount(0);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const document = session?.document;
    if (!document || document.kind !== 'pdf') return;

    let cancelled = false;

    if (document.browserFile) {
      const file = document.browserFile;
      void file.arrayBuffer()
        .then((bytes) => {
          if (!cancelled) return installPdf(bytes, document.name, file);
        })
        .catch((reason) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
        });
      return () => { cancelled = true; };
    }

    if (!isDesktopRuntime()) return;

    void readPdfDocumentBytes(document.id)
      .then((bytes) => {
        if (!cancelled) return installPdf(bytes, document.name);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => { cancelled = true; };
  }, [installPdf, session]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    void disposePdf(activeLoadRef.current);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const update = () => setViewport({
      width: node.clientWidth,
      height: node.clientHeight,
    });
    update();

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pdf]);

  const goToPage = useCallback((requested: number) => {
    const page = clampPdfPage(requested, pageCount);
    setCurrentPage(page);
    document.getElementById(`${domIdPrefix}-page-${page}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [domIdPrefix,pageCount]);

  const onPageVisible = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const onPageRendered = useCallback((page: number) => {
    if (page === 1 && !firstPageReportedRef.current) {
      firstPageReportedRef.current = true;
      setFirstPageMs(Math.round(performance.now() - loadStartedRef.current));
    }
  }, []);

  async function chooseBrowserPdf(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > 512 * 1024 * 1024) {
      setError('The selected PDF exceeds the 512 MB safety limit.');
      return;
    }

    const bytes = await file.arrayBuffer();
    await installPdf(bytes, file.name, file);
  }

  async function mutate(
    label:string,
    operation:(bytes:Uint8Array)=>Promise<Uint8Array>,
    preferredPage=currentPage,
  ){
    if(!sourceBytes||mutating)return;
    setMutating(true);
    setError('');
    try{
      const result=await operation(Uint8Array.from(sourceBytes));
      await installPdf(result,sourceName,browserFile,true);
      setCurrentPage(Math.max(1,preferredPage));
      setDirty(true);
      onDirtyChange?.(true);
      setActionNotice(label);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setMutating(false);
    }
  }

  async function appendDocuments(event:React.ChangeEvent<HTMLInputElement>){
    const files=Array.from(event.target.files??[]);
    event.target.value='';
    if(!files.length||!sourceBytes)return;
    setMutating(true);
    setError('');
    try{
      let result=Uint8Array.from(sourceBytes);
      for(const file of files){
        if(file.size>512*1024*1024)throw new Error(`${file.name} exceeds the 512 MB safety limit.`);
        result=await appendPdf(result,new Uint8Array(await file.arrayBuffer()));
      }
      await installPdf(result,sourceName,browserFile,true);
      setDirty(true);
      onDirtyChange?.(true);
      setActionNotice(`Appended ${files.length} PDF file(s).`);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setMutating(false);
    }
  }

  async function exportCurrent(){
    if(!sourceBytes){
      setActionNotice('Open a PDF first.');
      return;
    }
    try{
      const name=dirty?editedName(sourceName):editedName(sourceName,'copy');
      const saved=await exportPdfBytes(name,sourceBytes);
      if(saved)setActionNotice(dirty?'Exported the edited PDF as a new file.':'Exported a PDF copy.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }
  }

  async function extractCurrent(){
    if(!sourceBytes)return;
    try{
      const bytes=await extractPdfPage(sourceBytes,currentPage);
      const base=sourceName.replace(/\.pdf$/i,'')||'MALENJO-document';
      await exportPdfBytes(`${base}-page-${currentPage}.pdf`,bytes);
      setActionNotice(`Extracted page ${currentPage} as a new PDF.`);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }
  }

  function printDocument() {
    if (!pdf) return;
    setForceRenderAll(true);
    setActionNotice('Preparing all PDF pages for printing…');
    const delay = Math.min(2500, 700 + pageCount * 15);
    window.setTimeout(() => {
      setActionNotice('');
      window.print();
    }, delay);
  }

  const zoomLabel = fitMode === 'width'
    ? 'Fit width'
    : fitMode === 'page'
      ? 'Fit page'
      : `${Math.round(zoom * 100)}%`;

  return <div className="pdf-workspace">
    <input
      ref={fileInputRef}
      className="visually-hidden"
      type="file"
      accept="application/pdf,.pdf"
      onChange={(event) => void chooseBrowserPdf(event)}
    />
    <input
      ref={appendInputRef}
      className="visually-hidden"
      type="file"
      accept="application/pdf,.pdf"
      multiple
      onChange={(event)=>void appendDocuments(event)}
    />

    <div className="pdf-toolbar">
      <div className="pdf-toolbar-group">
        <button onClick={onBackToFiles} title="Back to MALENJO Files"><FolderOpen size={16}/> Files</button>
        <button onClick={() => fileInputRef.current?.click()} title="Open a temporary PDF in this workspace"><FileText size={16}/> Open PDF</button>
        <button disabled={!pdf||mutating} onClick={() => void exportCurrent()} title="Export current PDF bytes"><Download size={16}/> Export</button>
        <button disabled={!pdf||mutating} onClick={printDocument} title="Print rendered PDF pages"><Printer size={16}/> Print</button>
      </div>

      <div className="pdf-toolbar-group pdf-page-nav">
        <button disabled={!pdf || currentPage <= 1} onClick={() => goToPage(currentPage - 1)} aria-label="Previous page"><ChevronLeft size={16}/></button>
        <input
          aria-label="Current PDF page"
          disabled={!pdf}
          value={pdf ? currentPage : ''}
          onChange={(event) => setCurrentPage(clampPdfPage(Number(event.target.value), pageCount))}
          onBlur={() => goToPage(currentPage)}
          onKeyDown={(event) => { if (event.key === 'Enter') goToPage(currentPage); }}
        />
        <span>/ {pageCount || '—'}</span>
        <button disabled={!pdf || currentPage >= pageCount} onClick={() => goToPage(currentPage + 1)} aria-label="Next page"><ChevronRight size={16}/></button>
      </div>

      <div className="pdf-toolbar-group">
        <button disabled={!pdf} onClick={() => { setFitMode('custom'); setZoom((value) => stepPdfZoom(value, -1)); }} aria-label="Zoom out"><Minus size={16}/></button>
        <button className="pdf-zoom-label" disabled={!pdf} onClick={() => setFitMode((mode) => mode === 'width' ? 'page' : 'width')}>{zoomLabel}</button>
        <button disabled={!pdf} onClick={() => { setFitMode('custom'); setZoom((value) => stepPdfZoom(value, 1)); }} aria-label="Zoom in"><Plus size={16}/></button>
        <button disabled={!pdf} onClick={() => setFitMode('width')}>Width</button>
        <button disabled={!pdf} onClick={() => setFitMode('page')}>Page</button>
        <button disabled={!pdf} onClick={() => setRotation((value) => rotatePdfClockwise(value))} title="Rotate view clockwise"><RotateCw size={16}/></button>
      </div>
    </div>

    {(notice || actionNotice) && <div className="pdf-notice">{notice || actionNotice}</div>}
    {error && <div className="pdf-notice error">{error}</div>}

    {!pdf && <div className="pdf-empty">
      <div className="empty-icon">M</div>
      <h1>PDF Workspace</h1>
      <p>{loading
        ? 'Loading PDF with the local PDF.js renderer…'
        : 'Open PDFs from MALENJO Files to keep several documents in tabs, or choose one here for a temporary workspace preview.'}</p>
      <button className="primary-action" disabled={loading} onClick={() => fileInputRef.current?.click()}>
        <FileText size={17}/> {loading ? 'Loading…' : 'Choose PDF'}
      </button>
      <small>For multi-document work in Codespaces, add several files from Files / Library first.</small>
    </div>}

    {pdf && <div className="pdf-layout">
      <aside className="pdf-thumbnails" aria-label="PDF page thumbnails">
        <div className="pdf-pane-title"><span>Pages</span><b>{pageCount}</b></div>
        <div className="pdf-thumbnail-list">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) =>
            <PdfThumbnail
              key={page}
              document={pdf.document}
              pageNumber={page}
              active={page === currentPage}
              onSelect={goToPage}
            />
          )}
        </div>
      </aside>

      <div ref={scrollRef} className="pdf-scroll">
        <div className="pdf-stage">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) =>
            <PdfPageCanvas
              key={page}
              document={pdf.document}
              pageNumber={page}
              fitMode={fitMode}
              zoom={zoom}
              rotation={rotation}
              availableWidth={viewport.width}
              availableHeight={viewport.height}
              forceRender={forceRenderAll}
              domIdPrefix={domIdPrefix}
              onVisible={onPageVisible}
              onRendered={onPageRendered}
            />
          )}
        </div>
      </div>

      <aside className="pdf-inspector">
        <div className="pdf-pane-title">Document</div>
        <dl>
          <div><dt>Name</dt><dd title={sourceName}>{sourceName}</dd></div>
          <div><dt>Pages</dt><dd>{pageCount}</dd></div>
          <div><dt>Size</dt><dd>{sourceBytes ? formatBytes(sourceBytes.byteLength) : session?.document ? formatBytes(session.document.sizeBytes) : '—'}</dd></div>
          <div><dt>Renderer</dt><dd>PDF.js 6.4.299</dd></div>
          <div><dt>Edit state</dt><dd>{dirty?'Modified':'Original'}</dd></div>
          <div><dt>View</dt><dd>{fitMode === 'custom' ? `${Math.round(zoom * 100)}%` : fitMode} · {rotation}°</dd></div>
        </dl>

        <div className="pdf-pane-title">Page tools</div>
        <div className="pdf-page-tools">
          <button disabled={mutating||pageCount<=1} onClick={()=>void mutate(`Deleted page ${currentPage}.`,bytes=>deletePdfPage(bytes,currentPage),Math.min(currentPage,pageCount-1))}>Delete</button>
          <button disabled={mutating} onClick={()=>void mutate(`Duplicated page ${currentPage}.`,bytes=>duplicatePdfPage(bytes,currentPage),currentPage+1)}>Duplicate</button>
          <button disabled={mutating||currentPage<=1} onClick={()=>void mutate('Moved page earlier.',bytes=>movePdfPage(bytes,currentPage,currentPage-1),currentPage-1)}>Move earlier</button>
          <button disabled={mutating||currentPage>=pageCount} onClick={()=>void mutate('Moved page later.',bytes=>movePdfPage(bytes,currentPage,currentPage+1),currentPage+1)}>Move later</button>
          <button disabled={mutating} onClick={()=>void mutate(`Permanently rotated page ${currentPage} by 90°.`,bytes=>rotatePdfPagePermanent(bytes,currentPage),currentPage)}>Rotate page</button>
          <button disabled={mutating} onClick={()=>void mutate(`Inserted a blank page after page ${currentPage}.`,bytes=>insertBlankPdfPage(bytes,currentPage),currentPage+1)}>Blank after</button>
          <button disabled={mutating} onClick={()=>void extractCurrent()}>Extract page</button>
          <button disabled={mutating} onClick={()=>appendInputRef.current?.click()}>Append PDF…</button>
        </div>
        <div className="pdf-edit-note">Page operations rebuild the PDF file and mark this tab modified. They do not overwrite the source document; use Export to create the edited file.</div>

        <div className="pdf-pane-title">Performance</div>
        <dl>
          <div><dt>First page</dt><dd>{firstPageMs === null ? 'measuring…' : `${firstPageMs} ms`}</dd></div>
          <div><dt>Scroll</dt><dd className={scrollFps !== null && scrollFps < 55 ? 'metric-warn' : 'metric-good'}>{scrollFps === null ? 'scroll to measure' : `${scrollFps} FPS`}</dd></div>
        </dl>

        <div className="pdf-security-note">
          Rendering is local. PDF JavaScript evaluation is disabled in the MALENJO PDF.js adapter.
        </div>
      </aside>
    </div>}
  </div>;
}
