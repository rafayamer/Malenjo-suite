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
  Search,
  Square,
  Type,
  Undo2,
  Redo2,
} from 'lucide-react';
import type { DocumentSession } from '../files/session';
import type { RegisterDocumentCommands } from '../commands/types';
import { isDesktopRuntime } from '../files/api';
import { exportPdfBytes, readPdfDocumentBytes } from './api';
import {
  addPdfRectangleOverlay,
  addPdfTextOverlay,
  appendPdf,
  deletePdfPage,
  deletePdfPages,
  duplicatePdfPage,
  extractPdfPages,
  insertBlankPdfPage,
  insertPdfAfter,
  movePdfPage,
  rotatePdfPagePermanent,
  rotatePdfPagesPermanent,
  splitPdfAtPage,
} from './editor';
import { disposePdf, loadPdfBytes, type PdfLoadResult } from './engine';
import {
  canRedoPdfHistory,
  canUndoPdfHistory,
  createPdfHistory,
  recordPdfHistory,
  redoPdfHistory,
  undoPdfHistory,
  type PdfHistory,
} from './history';
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
  active: boolean;
  notice: string;
  onBackToFiles(): void;
  onDirtyChange?(dirty:boolean): void;
  registerCommands?: RegisterDocumentCommands;
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

export default function PdfWorkspace({ session, active, notice, onBackToFiles, onDirtyChange, registerCommands }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appendInputRef = useRef<HTMLInputElement>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  const activeLoadRef = useRef<PdfLoadResult | null>(null);
  const requestIdRef = useRef(0);
  const loadStartedRef = useRef(0);
  const firstPageReportedRef = useRef(false);
  const previewIdRef = useRef(`pdf-preview-${Math.random().toString(36).slice(2)}`);
  const historyRef = useRef<PdfHistory | null>(null);

  const [pdf, setPdf] = useState<PdfLoadResult | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [sourceName, setSourceName] = useState('PDF Workspace');
  const [browserFile, setBrowserFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(() => new Set([1]));
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
  const [historyRevision, setHistoryRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{page:number;excerpt:string}>>([]);
  const [textOverlay, setTextOverlay] = useState({ text:'', x:0.12, y:0.82, size:12 });
  const [shapeOverlay, setShapeOverlay] = useState({ x:0.12, y:0.68, width:0.35, height:0.08, mode:'highlight' as 'highlight'|'outline' });
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
      if(!preserveDirty){
        setSelectedPages(new Set([1]));
        selectionAnchorRef.current=1;
      }
      setFitMode('width');
      setZoom(1);
      setRotation(0);
      setForceRenderAll(false);
      if(!preserveDirty){
        setDirty(false);
        historyRef.current=createPdfHistory(owned,1);
        setHistoryRevision((value)=>value+1);
      }
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
  }, [installPdf, session?.id]);

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

  function selectThumbnail(page:number,additive:boolean,range:boolean){
    goToPage(page);
    setSelectedPages((current)=>{
      const anchor=selectionAnchorRef.current;
      if(range&&anchor){
        const next=additive?new Set(current):new Set<number>();
        const start=Math.min(anchor,page);
        const end=Math.max(anchor,page);
        for(let value=start;value<=end;value+=1)next.add(value);
        return next;
      }
      if(additive){
        const next=new Set(current);
        if(next.has(page))next.delete(page);else next.add(page);
        selectionAnchorRef.current=page;
        return next;
      }
      selectionAnchorRef.current=page;
      return new Set([page]);
    });
  }

  const selectedPageNumbers=Array.from(selectedPages)
    .filter(page=>page>=1&&page<=pageCount)
    .sort((a,b)=>a-b);
  const operationPages=selectedPageNumbers.length?selectedPageNumbers:[currentPage];


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
      const targetPage=Math.max(1,preferredPage);
      await installPdf(result,sourceName,browserFile,true);
      historyRef.current=historyRef.current
        ? recordPdfHistory(historyRef.current,result,targetPage,label)
        : recordPdfHistory(createPdfHistory(sourceBytes,currentPage),result,targetPage,label);
      setHistoryRevision((value)=>value+1);
      setCurrentPage(targetPage);
      setSelectedPages(new Set([targetPage]));
      selectionAnchorRef.current=targetPage;
      setDirty(true);
      onDirtyChange?.(true);
      setActionNotice(label);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setMutating(false);
    }
  }

  async function insertDocuments(event:React.ChangeEvent<HTMLInputElement>){
    const files=Array.from(event.target.files??[]);
    event.target.value='';
    if(!files.length||!sourceBytes)return;
    const ordered=[...files].reverse();
    await mutate(
      `Inserted ${files.length} PDF file(s) after page ${currentPage}.`,
      async(bytes)=>{
        let result=bytes;
        for(const file of ordered){
          if(file.size>512*1024*1024)throw new Error(`${file.name} exceeds the 512 MB safety limit.`);
          result=await insertPdfAfter(result,new Uint8Array(await file.arrayBuffer()),currentPage);
        }
        return result;
      },
      currentPage+1,
    );
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
        const merged=await appendPdf(result,new Uint8Array(await file.arrayBuffer()));
        const owned=new Uint8Array(merged.byteLength);
        owned.set(merged);
        result=owned;
      }
      const label=`Appended ${files.length} PDF file(s).`;
      await installPdf(result,sourceName,browserFile,true);
      historyRef.current=historyRef.current
        ? recordPdfHistory(historyRef.current,result,currentPage,label)
        : recordPdfHistory(createPdfHistory(sourceBytes,currentPage),result,currentPage,label);
      setHistoryRevision((value)=>value+1);
      setDirty(true);
      onDirtyChange?.(true);
      setActionNotice(label);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setMutating(false);
    }
  }

  async function undoEdit(){
    const history=historyRef.current;
    if(!history||mutating||!canUndoPdfHistory(history))return;
    const undoneLabel=history.entries[history.cursor]?.label??'PDF edit';
    const transition=undoPdfHistory(history);
    if(!transition.changed)return;
    setMutating(true);
    setError('');
    try{
      await installPdf(transition.entry.bytes,sourceName,browserFile,true);
      historyRef.current=transition.history;
      setHistoryRevision((value)=>value+1);
      setCurrentPage(transition.entry.page);
      setDirty(transition.entry.dirty);
      onDirtyChange?.(transition.entry.dirty);
      setActionNotice(`Undid: ${undoneLabel}`);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setMutating(false);
    }
  }

  async function redoEdit(){
    const history=historyRef.current;
    if(!history||mutating||!canRedoPdfHistory(history))return;
    const transition=redoPdfHistory(history);
    if(!transition.changed)return;
    setMutating(true);
    setError('');
    try{
      await installPdf(transition.entry.bytes,sourceName,browserFile,true);
      historyRef.current=transition.history;
      setHistoryRevision((value)=>value+1);
      setCurrentPage(transition.entry.page);
      setDirty(transition.entry.dirty);
      onDirtyChange?.(transition.entry.dirty);
      setActionNotice(`Redid: ${transition.entry.label}`);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setMutating(false);
    }
  }

  useEffect(()=>{
    if(!active)return;
    const onKeyDown=(event:KeyboardEvent)=>{
      if(!(event.ctrlKey||event.metaKey))return;
      const target=event.target as HTMLElement|null;
      if(target?.closest('input,textarea,[contenteditable="true"]'))return;
      const key=event.key.toLowerCase();
      if(key==='z'&&!event.shiftKey){
        event.preventDefault();
        void undoEdit();
      }else if((key==='z'&&event.shiftKey)||key==='y'){
        event.preventDefault();
        void redoEdit();
      }
    };
    window.addEventListener('keydown',onKeyDown);
    return()=>window.removeEventListener('keydown',onKeyDown);
  },[active,historyRevision,mutating]);

  async function searchPdf(){
    if(!pdf||!searchQuery.trim())return;
    const needle=searchQuery.trim().toLocaleLowerCase();
    setSearching(true);
    setError('');
    try{
      const results:Array<{page:number;excerpt:string}>=[];
      const count=Math.min(pdf.document.numPages,500);
      for(let pageNumber=1;pageNumber<=count&&results.length<100;pageNumber+=1){
        const page=await pdf.document.getPage(pageNumber);
        const content=await page.getTextContent();
        const text=content.items
          .map((item)=>'str' in item?String(item.str):'')
          .join(' ')
          .replace(/\s+/g,' ')
          .trim();
        const index=text.toLocaleLowerCase().indexOf(needle);
        if(index>=0){
          results.push({
            page:pageNumber,
            excerpt:text.slice(Math.max(0,index-70),Math.min(text.length,index+needle.length+120)),
          });
        }
      }
      setSearchResults(results);
      setActionNotice(results.length?`Found ${results.length} matching page(s).`:'No matching PDF text was found.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setSearching(false);
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

  async function extractSelected(){
    if(!sourceBytes)return;
    try{
      const pages=operationPages;
      const bytes=await extractPdfPages(sourceBytes,pages);
      const base=sourceName.replace(/\.pdf$/i,'')||'MALENJO-document';
      const label=pages.length===1?`page-${pages[0]}`:`pages-${pages[0]}-${pages[pages.length-1]}`;
      await exportPdfBytes(`${base}-${label}.pdf`,bytes);
      setActionNotice(`Extracted ${pages.length} selected page(s) as a new PDF.`);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }
  }

  async function splitCurrent(){
    if(!sourceBytes||currentPage>=pageCount)return;
    try{
      const [left,right]=await splitPdfAtPage(sourceBytes,currentPage);
      const base=sourceName.replace(/\.pdf$/i,'')||'MALENJO-document';
      await exportPdfBytes(`${base}-part-1.pdf`,left);
      await exportPdfBytes(`${base}-part-2.pdf`,right);
      setActionNotice(`Split after page ${currentPage} and exported two PDFs.`);
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


  useEffect(() => {
    if (!session || !registerCommands) return;
    registerCommands({
      list: () => [
        {
          id:'export',
          label:'Export current PDF',
          keywords:'export download copy save as pdf',
          detail:dirty ? 'Export edited PDF bytes as a new file' : 'Export a copy of the current PDF',
          enabled:!!sourceBytes && !mutating,
          disabledReason:!sourceBytes ? 'No PDF is loaded.' : mutating ? 'Wait for the current PDF edit to finish.' : undefined,
          run:()=>exportCurrent(),
        },
        {
          id:'undo',
          label:'Undo PDF edit',
          keywords:'undo ctrl z history',
          detail:'Undo the most recent PDF mutation in this tab',
          enabled:!!historyRef.current && !mutating && canUndoPdfHistory(historyRef.current),
          disabledReason:mutating ? 'Wait for the current PDF edit to finish.' : 'There is no PDF edit to undo.',
          run:()=>undoEdit(),
        },
        {
          id:'redo',
          label:'Redo PDF edit',
          keywords:'redo ctrl y history',
          detail:'Redo the next PDF mutation in this tab',
          enabled:!!historyRef.current && !mutating && canRedoPdfHistory(historyRef.current),
          disabledReason:mutating ? 'Wait for the current PDF edit to finish.' : 'There is no PDF edit to redo.',
          run:()=>redoEdit(),
        },
        {
          id:'print',
          label:'Print current PDF',
          keywords:'print printer ctrl p',
          detail:'Render all pages and open the browser/system print path',
          enabled:!!pdf && !mutating,
          disabledReason:!pdf ? 'No PDF is loaded.' : 'Wait for the current PDF edit to finish.',
          run:()=>printDocument(),
        },
      ],
    });
    return () => registerCommands(null);
  }, [session, registerCommands, sourceBytes, pdf, dirty, mutating, historyRevision]);

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
    <input
      ref={insertInputRef}
      className="visually-hidden"
      type="file"
      accept="application/pdf,.pdf"
      multiple
      onChange={(event)=>void insertDocuments(event)}
    />

    <div className="pdf-toolbar">
      <div className="pdf-toolbar-group">
        <button onClick={onBackToFiles} title="Back to MALENJO Files"><FolderOpen size={16}/> Files</button>
        <button disabled={!!session} onClick={() => fileInputRef.current?.click()} title={session ? "Use Files / Library to open another PDF in a new tab" : "Open a temporary PDF in this workspace"}><FileText size={16}/> Open PDF</button>
        <button disabled={!pdf||mutating} onClick={() => void exportCurrent()} title="Export current PDF bytes"><Download size={16}/> Export</button>
        <button disabled={!historyRef.current||mutating||!canUndoPdfHistory(historyRef.current)} onClick={()=>void undoEdit()} title="Undo PDF edit (Ctrl+Z)"><Undo2 size={16}/> Undo</button>
        <button disabled={!historyRef.current||mutating||!canRedoPdfHistory(historyRef.current)} onClick={()=>void redoEdit()} title="Redo PDF edit (Ctrl+Y / Ctrl+Shift+Z)"><Redo2 size={16}/> Redo</button>
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
        <div className="pdf-selection-bar">
          <span>{selectedPageNumbers.length || 1} selected</span>
          <button onClick={()=>{setSelectedPages(new Set(Array.from({length:pageCount},(_,index)=>index+1)));selectionAnchorRef.current=1;}}>All</button>
          <button onClick={()=>{setSelectedPages(new Set([currentPage]));selectionAnchorRef.current=currentPage;}}>Current</button>
        </div>
        <div className="pdf-thumbnail-list">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) =>
            <PdfThumbnail
              key={page}
              document={pdf.document}
              pageNumber={page}
              active={page === currentPage}
              selected={selectedPages.has(page)}
              onSelect={selectThumbnail}
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
          <div><dt>History</dt><dd>{historyRef.current?`${historyRef.current.cursor+1}/${historyRef.current.entries.length} · ${formatBytes(historyRef.current.totalBytes)}`:'—'}</dd></div>
          <div><dt>View</dt><dd>{fitMode === 'custom' ? `${Math.round(zoom * 100)}%` : fitMode} · {rotation}°</dd></div>
        </dl>

        <div className="pdf-pane-title">Find in document</div>
        <div className="pdf-find">
          <div><Search size={14}/><input value={searchQuery} onChange={(event)=>setSearchQuery(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter')void searchPdf();}} placeholder="Search PDF text"/></div>
          <button disabled={searching||!searchQuery.trim()} onClick={()=>void searchPdf()}>{searching?'Searching…':'Find'}</button>
          {!!searchResults.length&&<div className="pdf-search-results">{searchResults.map((result)=><button key={result.page} onClick={()=>goToPage(result.page)}><b>Page {result.page}</b><span>{result.excerpt}</span></button>)}</div>}
        </div>

        <div className="pdf-pane-title">Edit current page</div>
        <div className="pdf-edit-form">
          <label><Type size={13}/> Add text<textarea value={textOverlay.text} onChange={(event)=>setTextOverlay({...textOverlay,text:event.target.value})} placeholder="Text to place on the current page"/></label>
          <div className="pdf-coordinate-grid">
            <label>X<input type="number" min="0" max="1" step="0.01" value={textOverlay.x} onChange={(event)=>setTextOverlay({...textOverlay,x:Number(event.target.value)})}/></label>
            <label>Y<input type="number" min="0" max="1" step="0.01" value={textOverlay.y} onChange={(event)=>setTextOverlay({...textOverlay,y:Number(event.target.value)})}/></label>
            <label>Pt<input type="number" min="4" max="144" step="1" value={textOverlay.size} onChange={(event)=>setTextOverlay({...textOverlay,size:Number(event.target.value)})}/></label>
          </div>
          <button disabled={mutating||!textOverlay.text.trim()} onClick={()=>void mutate('Added permanent text to the PDF.',bytes=>addPdfTextOverlay(bytes,{pageNumber:currentPage,...textOverlay}),currentPage)}>Place text</button>

          <label><Square size={13}/> Rectangle<select value={shapeOverlay.mode} onChange={(event)=>setShapeOverlay({...shapeOverlay,mode:event.target.value as 'highlight'|'outline'})}><option value="highlight">Highlight</option><option value="outline">Outline</option></select></label>
          <div className="pdf-coordinate-grid">
            <label>X<input type="number" min="0" max="1" step="0.01" value={shapeOverlay.x} onChange={(event)=>setShapeOverlay({...shapeOverlay,x:Number(event.target.value)})}/></label>
            <label>Y<input type="number" min="0" max="1" step="0.01" value={shapeOverlay.y} onChange={(event)=>setShapeOverlay({...shapeOverlay,y:Number(event.target.value)})}/></label>
            <label>W<input type="number" min="0.01" max="1" step="0.01" value={shapeOverlay.width} onChange={(event)=>setShapeOverlay({...shapeOverlay,width:Number(event.target.value)})}/></label>
            <label>H<input type="number" min="0.01" max="1" step="0.01" value={shapeOverlay.height} onChange={(event)=>setShapeOverlay({...shapeOverlay,height:Number(event.target.value)})}/></label>
          </div>
          <button disabled={mutating} onClick={()=>void mutate(`Added ${shapeOverlay.mode} rectangle.`,bytes=>addPdfRectangleOverlay(bytes,{pageNumber:currentPage,...shapeOverlay}),currentPage)}>Apply rectangle</button>
          <small>Coordinates are normalized 0–1 from the page’s bottom-left corner. A later visual drag/selection layer will replace manual coordinate entry.</small>
        </div>

        <div className="pdf-pane-title">Page tools</div>
        <div className="pdf-page-tools">
          <button disabled={mutating||operationPages.length>=pageCount} onClick={()=>void mutate(
            `Deleted ${operationPages.length} selected page(s).`,
            bytes=>operationPages.length===1?deletePdfPage(bytes,operationPages[0]):deletePdfPages(bytes,operationPages),
            Math.max(1,Math.min(operationPages[0],pageCount-operationPages.length)),
          )}>Delete selected</button>
          <button disabled={mutating||operationPages.length!==1} onClick={()=>void mutate(`Duplicated page ${currentPage}.`,bytes=>duplicatePdfPage(bytes,currentPage),currentPage+1)}>Duplicate</button>
          <button disabled={mutating||operationPages.length!==1||currentPage<=1} onClick={()=>void mutate('Moved page earlier.',bytes=>movePdfPage(bytes,currentPage,currentPage-1),currentPage-1)}>Move earlier</button>
          <button disabled={mutating||operationPages.length!==1||currentPage>=pageCount} onClick={()=>void mutate('Moved page later.',bytes=>movePdfPage(bytes,currentPage,currentPage+1),currentPage+1)}>Move later</button>
          <button disabled={mutating} onClick={()=>void mutate(
            `Permanently rotated ${operationPages.length} selected page(s) by 90°.`,
            bytes=>operationPages.length===1?rotatePdfPagePermanent(bytes,operationPages[0]):rotatePdfPagesPermanent(bytes,operationPages),
            operationPages[0],
          )}>Rotate selected</button>
          <button disabled={mutating} onClick={()=>void mutate(`Inserted a blank page after page ${currentPage}.`,bytes=>insertBlankPdfPage(bytes,currentPage),currentPage+1)}>Blank after</button>
          <button disabled={mutating} onClick={()=>void extractSelected()}>Extract selected</button>
          <button disabled={mutating} onClick={()=>insertInputRef.current?.click()}>Insert PDF here…</button>
          <button disabled={mutating||currentPage>=pageCount} onClick={()=>void splitCurrent()}>Split here</button>
          <button disabled={mutating} onClick={()=>appendInputRef.current?.click()}>Append PDF…</button>
        </div>
        <div className="pdf-edit-note">Click a thumbnail to select one page; Ctrl/Cmd-click toggles pages and Shift-click selects a range. Mutations use the bounded per-tab Undo/Redo history and never overwrite the source document; use Export to create the edited file.</div>

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
