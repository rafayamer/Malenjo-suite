import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Minus,
  Plus,
  RotateCw,
  Search,
  Square,
  Type,
  MessageSquare,
  Paperclip,
  ListChecks,
  FileCheck2,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  ShieldCheck,
  Maximize2,
  MonitorPlay,
} from 'lucide-react';
import type { DocumentSession } from '../files/session';
import type { RegisterDocumentCommands } from '../commands/types';
import { isDesktopRuntime } from '../files/api';
import { exportPdfBytes, exportPdfPlainText, exportPdfEmbeddedAttachment, exportPdfPageImagesZip, readPdfDocumentBytes } from './api';
import { exportPdfPagesAsPngZip } from './pageImageExport';
import {
  comparePdfSelectableText, formatPdfTextComparison, type PdfTextComparison,
} from './textCompare';
import {
  flattenPdfOutline, normalizePdfAttachments, resolvePdfOutlinePage, readPdfAttachmentBytes,
  type PdfOutlineModel, type PdfOutlineEntry, type PdfAttachmentModel, type PdfAttachmentEntry,
} from './navigation';
import { extractPdfDocumentText } from './textExport';
import {
  listPdfOptionalLayers, restorePdfOptionalLayerVisibility,
  setPdfOptionalLayerVisibility, type PdfOptionalContentConfig,
  type PdfOptionalLayer,
} from './optionalLayers';
import {
  clearPdfPageLabelRanges, listPdfPageLabelRanges, setPdfPageLabelRange,
  type PdfPageLabelRange,
} from './pageLabels';
import {
  addPdfTopLevelBookmark, deletePdfTopLevelBookmark,
  listPdfTopLevelBookmarks, renamePdfTopLevelBookmark,
  type PdfTopLevelBookmark,
} from './bookmarkEditor';
import {
  addPdfBatesNumbers,
  addPdfCheckBox,
  addPdfCommentAnnotation,
  addPdfDropdown,
  addPdfOptionList,
  addPdfRadioGroup,
  addPdfHeaderFooter,
  addPdfRectangleOverlay,
  addPdfTextField,
  addPdfTextOverlay,
  appendPdf,
  attachFileToPdf,
  deletePdfPage,
  deletePdfPages,
  duplicatePdfPage,
  extractPdfPages,
  insertBlankPdfPage,
  insertPdfAfter,
  movePdfPage,
  rotatePdfPagePermanent,
  rotatePdfPagesPermanent,
  setPdfPageBox,
  splitPdfAtPage,
  fillPdfFormFields,
  flattenPdfForm,
  inspectPdfFormFields,
  type PdfFormFieldInfo,
  type PdfFormFieldUpdate,
} from './editor';
import { disposePdf, loadPdfBytes, type PdfLoadResult } from './engine';
import { createPdfFromImages, PDF_IMAGE_MAX_COUNT, PDF_IMAGE_MAX_BYTES, PDF_IMAGE_MAX_TOTAL_BYTES } from './imageConvert';
import {
  addPdfRegionMarkup, deletePdfReviewAnnotation, listPdfReviewAnnotations,
  setPdfReviewResolved, updatePdfReviewText, replyToPdfReviewAnnotation, type PdfRegionMarkup, type PdfReviewItem,
} from './review';
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
import PdfProviderToolsPanel from './PdfProviderToolsPanel';
import { defaultPdfToolProvider } from './defaultProvider';
import type { PdfProviderToolCategory } from './backend';
import { pdfViewPages, type PdfViewMode } from './viewMode';
import { useScrollFps } from './useScrollFps';
import {
  DEFAULT_PDF_LEFT_PANEL,
  PDF_LEFT_PANEL_ITEMS,
  pdfLeftPanelItem,
  type PdfLeftPanelId,
} from './leftNavigation';
import { pdfCriticalPassReady, pdfPageSchedule } from './renderPriority';
import {
  DOCUMENT_INSPECTOR_LABELS,
  DOCUMENT_INSPECTOR_SHORTCUT,
  DOCUMENT_INSPECTOR_TABS,
  isDocumentInspectorToggleShortcut,
  type DocumentInspectorTab,
} from '../shell/inspector';
import {
  PDF_TASK_CATEGORIES,
  PDF_TASK_CATEGORY_LABELS,
  PDF_TASK_CATEGORY_SHORTCUTS,
  movePdfTaskCategory,
  pdfTaskCategoryFromShortcut,
  type PdfTaskCategory,
} from './taskToolbar';

interface Props {
  session: DocumentSession | null;
  active: boolean;
  notice: string;
  onBackToFiles(): void;
  onNavigateModule?(id:'ai'|'security'|'sign'|'scanner'|'automation'): void;
  onDirtyChange?(dirty:boolean): void;
  onSavingChange?(saving:boolean): void;
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

interface PdfToolbarAction {
  id:string;
  label:string;
  enabled:boolean;
  disabledReason?:string;
  run():void|Promise<void>;
}

function PdfLeftPanelIcon({id}:{id:PdfLeftPanelId}) {
  if (id === 'pages') return <FileText size={17}/>;
  if (id === 'attachments') return <Paperclip size={17}/>;
  if (id === 'signatures') return <FileCheck2 size={17}/>;
  if (id === 'comments') return <MessageSquare size={17}/>;
  if (id === 'search') return <Search size={17}/>;
  if (id === 'layers') return <Square size={17}/>;
  return <ListChecks size={17}/>;
}

export default function PdfWorkspace({ session, active, notice, onBackToFiles, onNavigateModule, onDirtyChange, onSavingChange, registerCommands }: Props) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);
  const comparisonInputRef = useRef<HTMLInputElement>(null);
  const appendInputRef = useRef<HTMLInputElement>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  const activeLoadRef = useRef<PdfLoadResult | null>(null);
  const requestIdRef = useRef(0);
  const loadStartedRef = useRef(0);
  const firstPageReportedRef = useRef(false);
  const previewIdRef = useRef(`pdf-preview-${Math.random().toString(36).slice(2)}`);
  const historyRef = useRef<PdfHistory | null>(null);
  const textExportAbortRef = useRef<AbortController | null>(null);
  const comparisonAbortRef = useRef<AbortController | null>(null);
  const pageImageAbortRef = useRef<AbortController | null>(null);
  const imagesAbortRef = useRef<AbortController | null>(null);

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
  const [viewMode, setViewMode] = useState<PdfViewMode>('continuous');
  const [presentationMode, setPresentationMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [exportingText, setExportingText] = useState(false);
  const [comparingPdf, setComparingPdf] = useState(false);
  const [comparisonProgress, setComparisonProgress] = useState(0);
  const [comparisonResult, setComparisonResult] = useState<{
    data:PdfTextComparison; baselineName:string; comparisonName:string;
  }|null>(null);
  const [exportingPageImages, setExportingPageImages] = useState(false);
  const [pageImageProgress, setPageImageProgress] = useState(0);
  const [creatingImagePdf, setCreatingImagePdf] = useState(false);
  const [imagePdfProgress, setImagePdfProgress] = useState(0);
  const [textExportProgress, setTextExportProgress] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [firstPageMs, setFirstPageMs] = useState<number | null>(null);
  const [forceRenderAll, setForceRenderAll] = useState(false);
  const [renderedPages, setRenderedPages] = useState<Set<number>>(() => new Set());
  const [viewport, setViewport] = useState({ width: 900, height: 700 });
  const [historyRevision, setHistoryRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{page:number;excerpt:string}>>([]);
  const [leftPanel, setLeftPanel] = useState<PdfLeftPanelId>(DEFAULT_PDF_LEFT_PANEL);
  const [optionalLayers, setOptionalLayers] = useState<{
    document:PdfLoadResult['document'];
    config:PdfOptionalContentConfig;
    original:PdfOptionalLayer[];
    current:PdfOptionalLayer[];
  }|null>(null);
  const [layerRevision, setLayerRevision] = useState(0);
  const [layersLoading, setLayersLoading] = useState(false);
  const [layersError, setLayersError] = useState('');
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineModel>({entries:[],truncated:false});
  const [editableBookmarks, setEditableBookmarks] = useState<PdfTopLevelBookmark[]>([]);
  const [bookmarkTitle, setBookmarkTitle] = useState('');
  const [bookmarkEdit, setBookmarkEdit] = useState<{ref:string;title:string}|null>(null);
  const [bookmarkEditError, setBookmarkEditError] = useState('');
  const [pdfAttachments, setPdfAttachments] = useState<PdfAttachmentModel>({entries:[],truncated:false});
  const [navigatorLoading, setNavigatorLoading] = useState(false);
  const [bookmarkError, setBookmarkError] = useState('');
  const [attachmentError, setAttachmentError] = useState('');
  const [extractingAttachment, setExtractingAttachment] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<DocumentInspectorTab>('properties');
  const [inspectorHidden, setInspectorHidden] = useState(false);
  const [taskCategory, setTaskCategory] = useState<PdfTaskCategory>('home');
  const [providerPanelOpen, setProviderPanelOpen] = useState(false);
  const [textOverlay, setTextOverlay] = useState({ text:'', x:0.12, y:0.82, size:12 });
  const [shapeOverlay, setShapeOverlay] = useState({ x:0.12, y:0.68, width:0.35, height:0.08, mode:'highlight' as 'highlight'|'outline' });
  const [commentDraft, setCommentDraft] = useState({ text:'', author:'MALENJO User', x:0.86, y:0.86 });
  const [markupDraft, setMarkupDraft] = useState({
    kind:'Highlight' as PdfRegionMarkup['kind'],
    x:0.12,y:0.62,width:0.35,height:0.05,
  });
  const [reviewAnnotations, setReviewAnnotations] = useState<PdfReviewItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewFailure, setReviewFailure] = useState('');
  const [reviewEdit, setReviewEdit] = useState<{item:PdfReviewItem;text:string}|null>(null);
  const [reviewReply, setReviewReply] = useState<{parent:PdfReviewItem;text:string}|null>(null);
  const [formDraft, setFormDraft] = useState({
    type:'text' as 'text'|'checkbox'|'radio'|'dropdown'|'list',
    name:'',
    defaultValue:'',
    optionsText:'Approve\nReject',
    selectedText:'',
    required:false,
    readOnly:false,
    multiselect:false,
    x:0.12,
    y:0.52,
    width:0.42,
    height:0.12,
    size:0.05,
    gap:0.075,
  });
  const [formFields, setFormFields] = useState<PdfFormFieldInfo[]>([]);
  const [formFillDraft, setFormFillDraft] = useState<Record<string,string|string[]|boolean|undefined>>({});
  const [formFillTouched, setFormFillTouched] = useState<Set<string>>(()=>new Set());
  const [formInspectedSource, setFormInspectedSource] = useState<Uint8Array|null>(null);
  const [headerFooterDraft, setHeaderFooterDraft] = useState({
    scope:'selected' as 'selected'|'all',
    header:'',
    footer:'Page {page} of {pages}',
    fontSize:9,
    margin:24,
    headerAlign:'center' as 'left'|'center'|'right',
    footerAlign:'center' as 'left'|'center'|'right',
  });
  const [batesDraft, setBatesDraft] = useState({
    scope:'selected' as 'selected'|'all',
    prefix:'CASE-',
    suffix:'',
    startNumber:1,
    digits:6,
    fontSize:9,
    margin:24,
    position:'bottom-right' as 'top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-center'|'bottom-right',
  });
  const [pageLabelDraft, setPageLabelDraft] = useState({
    style:'D' as PdfPageLabelRange['style'],
    prefix:'',
    startNumber:1,
  });
  const [pageLabelRanges, setPageLabelRanges] = useState<PdfPageLabelRange[]>([]);
  const [logicalPageLabels, setLogicalPageLabels] = useState<string[]>([]);
  const [pageLabelError, setPageLabelError] = useState('');
  const [pageBoxDraft, setPageBoxDraft] = useState({
    scope:'selected' as 'selected'|'all',
    box:'crop' as 'crop'|'trim'|'bleed'|'art',
    top:0,
    right:0,
    bottom:0,
    left:0,
  });
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
        return false;
      }

      const previousLoad = activeLoadRef.current;
      activeLoadRef.current = result;
      setPdf(result);
      comparisonAbortRef.current?.abort();
      setComparisonResult(null);
      setSourceBytes(owned);
      setBrowserFile(file);
      setSourceName(name);
      setPageCount(result.document.numPages);
      setRenderedPages(new Set());
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
      // The new PDF is now active. A previous worker's teardown failure must
      // not roll back a successful installation or leave a destroyed PDF active.
      try {
        await disposePdf(previousLoad);
      } catch {
        // Best-effort old-worker cleanup; retain the successfully loaded PDF.
      }
      return true;
    } catch (reason) {
      if (requestId === requestIdRef.current) {
        // Loading is transactional: a corrupt replacement must not discard the
        // previously opened PDF, its unsaved bytes, or its undo/redo history.
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      return false;
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
    textExportAbortRef.current?.abort();
    comparisonAbortRef.current?.abort();
    pageImageAbortRef.current?.abort();
    imagesAbortRef.current?.abort();
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
    setRenderedPages((current) => {
      if (current.has(page)) return current;
      const next = new Set(current);
      next.add(page);
      return next;
    });
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
  ):Promise<boolean>{
    if(!sourceBytes||mutating)return false;
    setMutating(true);
    setError('');
    try{
      const result=await operation(Uint8Array.from(sourceBytes));
      const targetPage=Math.max(1,preferredPage);
      if (!await installPdf(result,sourceName,browserFile,true)) return false;
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
      return true;
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      return false;
    }finally{
      setMutating(false);
    }
  }

  async function mutateAction(
    label:string,
    operation:(bytes:Uint8Array)=>Promise<Uint8Array>,
    preferredPage=currentPage,
  ):Promise<void>{
    await mutate(label,operation,preferredPage);
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
      if (!await installPdf(result,sourceName,browserFile,true)) return;
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
      if (!await installPdf(transition.entry.bytes,sourceName,browserFile,true)) return;
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
      if (!await installPdf(transition.entry.bytes,sourceName,browserFile,true)) return;
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


  useEffect(()=>{
    setFormFields([]);
    setFormFillDraft({});
    setFormFillTouched(new Set());
    setFormInspectedSource(null);
    if(!sourceBytes)return;

    const inspectedBytes=sourceBytes;
    let cancelled=false;
    void inspectPdfFormFields(inspectedBytes)
      .then((fields)=>{
        if(cancelled)return;
        setFormFields(fields);
        setFormFillDraft(Object.fromEntries(fields.map((field)=>{
          if(field.type==='checkbox')return [field.name,field.checked??false];
          if(field.type==='radio'||field.type==='dropdown'||field.type==='list'){
            return [field.name,[...field.selected]];
          }
          if(field.type==='text'&&field.password)return [field.name,undefined];
          return [field.name,field.value];
        })) as Record<string,string|string[]|boolean|undefined>);
        setFormFillTouched(new Set());
        setFormInspectedSource(inspectedBytes);
      })
      .catch(()=>{
        if(cancelled)return;
        setFormFields([]);
        setFormFillDraft({});
        setFormFillTouched(new Set());
        setFormInspectedSource(null);
      });
    return()=>{cancelled=true;};
  },[sourceBytes]);

  const fillableFormFields=(formInspectedSource===sourceBytes?formFields:[]).filter((field)=>
    !field.readOnly
    &&!field.richText
    &&!field.duplicateChoiceExports
    &&!(field.type==='dropdown'&&field.editable&&field.multiselect)
    &&['text','checkbox','radio','dropdown','list'].includes(field.type),
  );

  async function attachDocuments(event:React.ChangeEvent<HTMLInputElement>){
    const files=Array.from(event.target.files??[]);
    event.target.value='';
    if(!files.length||!sourceBytes)return;
    await mutate(
      `Embedded ${files.length} attachment(s) in the PDF.`,
      async(bytes)=>{
        let result=bytes;
        for(const file of files){
          result=await attachFileToPdf(result,{
            name:file.name,
            bytes:new Uint8Array(await file.arrayBuffer()),
            mimeType:file.type||'application/octet-stream',
            description:'Embedded by MALENJO PDF Workspace',
          });
        }
        return result;
      },
      currentPage,
    );
  }

  useEffect(()=>{
    setReviewReply(null);
    setReviewEdit(null);
    setReviewAnnotations([]);
    if(!sourceBytes){
      setReviewAnnotations([]);
      setReviewFailure('');
      setReviewLoading(false);
      return;
    }
    let cancelled=false;
    setReviewLoading(true);
    setReviewFailure('');
    void listPdfReviewAnnotations(sourceBytes)
      .then(items=>{if(!cancelled)setReviewAnnotations(items);})
      .catch(reason=>{
        if(!cancelled){
          setReviewAnnotations([]);
          setReviewFailure(reason instanceof Error?reason.message:String(reason));
        }
      })
      .finally(()=>{if(!cancelled)setReviewLoading(false);});
    return ()=>{cancelled=true;};
  },[sourceBytes]);

  useEffect(()=>{
    setOptionalLayers(null);
    setLayersError('');
    if(!pdf){setLayersLoading(false);return;}
    let cancelled=false;
    const activeDocument=pdf.document;
    setLayersLoading(true);
    void activeDocument.getOptionalContentConfig({intent:'display'})
      .then(config=>{
        if(cancelled)return;
        const inventory=listPdfOptionalLayers(config);
        setOptionalLayers({document:activeDocument,config,original:inventory,current:inventory});
      })
      .catch(reason=>{
        if(cancelled)return;
        setLayersError(reason instanceof Error?reason.message:String(reason));
        setOptionalLayers(null);
      })
      .finally(()=>{if(!cancelled)setLayersLoading(false);});
    return()=>{cancelled=true;};
  },[pdf]);

  const currentLayers=optionalLayers?.document===pdf?.document?optionalLayers:null;

  function changeLayerVisibility(id:string,visible:boolean){
    if(!currentLayers||mutating||loading)return;
    try{
      const entries=setPdfOptionalLayerVisibility(currentLayers.config,id,visible);
      setOptionalLayers({...currentLayers,current:entries});
      setLayerRevision(value=>value+1);
    }catch(reason){
      setLayersError(reason instanceof Error?reason.message:String(reason));
    }
  }

  function resetLayerVisibility(){
    if(!currentLayers||mutating||loading)return;
    try{
      const entries=restorePdfOptionalLayerVisibility(currentLayers.config,currentLayers.original);
      setOptionalLayers({...currentLayers,current:entries});
      setLayerRevision(value=>value+1);
      setLayersError('');
    }catch(reason){
      setLayersError(reason instanceof Error?reason.message:String(reason));
    }
  }

  useEffect(()=>{
    if(!pdf){
      setPdfOutline({entries:[],truncated:false});
      setPdfAttachments({entries:[],truncated:false});
      setNavigatorLoading(false);
      setBookmarkError('');
      setAttachmentError('');
      return;
    }
    let cancelled=false;
    setNavigatorLoading(true);
    setPdfOutline({entries:[],truncated:false});
    setPdfAttachments({entries:[],truncated:false});
    setBookmarkError('');
    setAttachmentError('');
    void Promise.allSettled([pdf.document.getOutline(),pdf.document.getAttachments()])
      .then(([outline,attachments])=>{
        if(cancelled)return;
        if(outline.status==='fulfilled'){
          setPdfOutline(flattenPdfOutline(outline.value));
        }else{
          setPdfOutline({entries:[],truncated:false});
          setBookmarkError('Bookmark discovery failed for this PDF.');
        }
        if(attachments.status==='fulfilled'){
          setPdfAttachments(normalizePdfAttachments(attachments.value,200,32*1024*1024));
        }else{
          setPdfAttachments({entries:[],truncated:false});
          setAttachmentError('Attachment discovery failed for this PDF.');
        }
      })
      .finally(()=>{if(!cancelled)setNavigatorLoading(false);});
    return ()=>{cancelled=true;};
  },[pdf]);

  useEffect(()=>{
    // Never leave actionable bookmark refs/drafts from a previous PDF available
    // while asynchronously inspecting a newly opened or edited working copy.
    setEditableBookmarks([]);
    setBookmarkEdit(null);
    if(!sourceBytes){
      setBookmarkEditError('');
      return;
    }
    let cancelled=false;
    void listPdfTopLevelBookmarks(sourceBytes)
      .then(items=>{if(!cancelled){setEditableBookmarks(items);setBookmarkEditError('');}})
      .catch(reason=>{
        if(!cancelled){
          setEditableBookmarks([]);
          setBookmarkEditError(reason instanceof Error?reason.message:String(reason));
        }
      });
    return ()=>{cancelled=true;};
  },[sourceBytes]);

  async function addCurrentPageBookmark(){
    const title=bookmarkTitle;
    const added=await mutate(
      'Added PDF bookmark for page '+currentPage+'.',
      bytes=>addPdfTopLevelBookmark(bytes,title,currentPage),
      currentPage,
    );
    if(added)setBookmarkTitle('');
  }

  async function renameCurrentBookmark(){
    if(!bookmarkEdit)return;
    const {ref,title}=bookmarkEdit;
    const renamed=await mutate(
      'Renamed PDF bookmark.',
      bytes=>renamePdfTopLevelBookmark(bytes,ref,title),
      currentPage,
    );
    if(renamed)setBookmarkEdit(null);
  }

  async function deleteCurrentBookmark(item:PdfTopLevelBookmark){
    if(!window.confirm('Delete bookmark "'+item.title+'"? This can be undone.'))return;
    const removed=await mutate(
      'Deleted PDF bookmark.',
      bytes=>deletePdfTopLevelBookmark(bytes,item.ref),
      currentPage,
    );
    if(removed)setBookmarkEdit(null);
  }

  async function openBookmark(entry:PdfOutlineEntry){
    if(!pdf)return;
    if(entry.dest){
      try{
        const page=await resolvePdfOutlinePage(pdf.document,entry.dest);
        if(page){goToPage(page);setActionNotice('Navigated to bookmark '+entry.title+'.');return;}
      }catch(reason){
        setError(reason instanceof Error?reason.message:String(reason));
        return;
      }
    }
    setActionNotice(entry.url
      ? 'This PDF bookmark points to an external URL. MALENJO never opens document-supplied links automatically.'
      : 'This bookmark has no resolvable local page destination.');
  }

  async function extractAttachment(entry:PdfAttachmentEntry){
    if(!pdf||!entry.downloadable||extractingAttachment){
      setError(entry.reason||'This PDF attachment cannot be safely exported right now.');
      return;
    }
    const currentDocument=pdf.document;
    setExtractingAttachment(true);
    onSavingChange?.(true);
    try{
      // Request untrusted decompressed content only after a user click.
      const result=await currentDocument.getAttachmentContent(entry.id);
      if(activeLoadRef.current?.document!==currentDocument){
        throw new Error('The active PDF changed; attachment export was cancelled.');
      }
      const bytes=readPdfAttachmentBytes(result,32*1024*1024);
      const saved=await exportPdfEmbeddedAttachment(entry.name,bytes);
      if(saved)setActionNotice('Exported embedded attachment without opening or executing it.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setExtractingAttachment(false);
      onSavingChange?.(false);
    }
  }

  async function addComment(){
    const added=await mutate(
      'Added a PDF comment annotation.',
      (bytes)=>addPdfCommentAnnotation(bytes,{pageNumber:currentPage,...commentDraft}),
      currentPage,
    );
    if(added)setCommentDraft((current)=>({...current,text:''}));
  }

  async function addReviewMarkup(){
    const kind=markupDraft.kind;
    await mutate(
      'Added PDF '+kind+' region annotation.',
      (bytes)=>addPdfRegionMarkup(bytes,{
        ...markupDraft,pageNumber:currentPage,
        author:commentDraft.author,
        text:commentDraft.text,
      }),
      currentPage,
    );
  }

  async function sendReviewReply(){
    if(!reviewReply)return;
    const {parent,text}=reviewReply;
    const added=await mutate(
      'Replied to PDF review annotation.',
      bytes=>replyToPdfReviewAnnotation(bytes,parent,text,commentDraft.author),
      parent.pageNumber,
    );
    if(added)setReviewReply(null);
  }

  async function saveReviewText(){
    if(!reviewEdit)return;
    const {item,text}=reviewEdit;
    const changed=await mutate(
      'Updated PDF '+item.kind+' annotation.',
      (bytes)=>updatePdfReviewText(bytes,item,text),
      item.pageNumber,
    );
    if(changed)setReviewEdit(null);
  }

  async function toggleReviewResolved(item:PdfReviewItem){
    await mutate(
      item.resolved?'Reopened PDF review item.':'Resolved PDF review item.',
      (bytes)=>setPdfReviewResolved(bytes,item,!item.resolved),
      item.pageNumber,
    );
  }

  async function removeReviewItem(item:PdfReviewItem){
    if(!window.confirm('Delete the selected PDF annotation from page '+item.pageNumber+'? You can Undo the deletion.'))return;
    const removed=await mutate(
      'Deleted PDF '+item.kind+' annotation.',
      (bytes)=>deletePdfReviewAnnotation(bytes,item),
      item.pageNumber,
    );
    if(removed)setReviewEdit(null);
  }

  async function addFormField(){
    const name=formDraft.name;
    const flags={required:formDraft.required,readOnly:formDraft.readOnly};
    const options=formDraft.optionsText===''?[]:formDraft.optionsText.split(/\r?\n/);
    const selected=formDraft.selectedText===''?[]:formDraft.selectedText.split(/\r?\n/);
    let created=false;

    if(formDraft.type==='checkbox'){
      created=await mutate(
        `Added checkbox field "${name}".`,
        (bytes)=>addPdfCheckBox(bytes,{
          pageNumber:currentPage,name,x:formDraft.x,y:formDraft.y,size:formDraft.size,...flags,
        }),
        currentPage,
      );
    }else if(formDraft.type==='radio'){
      created=await mutate(
        `Added radio group "${name}".`,
        (bytes)=>addPdfRadioGroup(bytes,{
          pageNumber:currentPage,name,options,selected:selected[0],
          x:formDraft.x,y:formDraft.y,size:formDraft.size,gap:formDraft.gap,...flags,
        }),
        currentPage,
      );
    }else if(formDraft.type==='dropdown'){
      created=await mutate(
        `Added dropdown field "${name}".`,
        (bytes)=>addPdfDropdown(bytes,{
          pageNumber:currentPage,name,options,selected,
          x:formDraft.x,y:formDraft.y,width:formDraft.width,height:formDraft.height,
          multiselect:formDraft.multiselect,...flags,
        }),
        currentPage,
      );
    }else if(formDraft.type==='list'){
      created=await mutate(
        `Added option-list field "${name}".`,
        (bytes)=>addPdfOptionList(bytes,{
          pageNumber:currentPage,name,options,selected,
          x:formDraft.x,y:formDraft.y,width:formDraft.width,height:formDraft.height,
          multiselect:formDraft.multiselect,...flags,
        }),
        currentPage,
      );
    }else{
      created=await mutate(
        `Added text field "${name}".`,
        (bytes)=>addPdfTextField(bytes,{
          pageNumber:currentPage,name,defaultValue:formDraft.defaultValue,
          x:formDraft.x,y:formDraft.y,width:formDraft.width,height:formDraft.height,...flags,
        }),
        currentPage,
      );
    }
    if(created)setFormDraft((current)=>({...current,name:'',defaultValue:'',selectedText:''}));
  }

  function setFormFillValue(name:string,value:string|string[]|boolean|undefined){
    setFormFillDraft((current)=>({...current,[name]:value}));
    setFormFillTouched((current)=>{
      const next=new Set(current);
      next.add(name);
      return next;
    });
  }

  async function fillForm(){
    if(!fillableFormFields.length)return;
    const updates:PdfFormFieldUpdate[]=[];
    for(const field of fillableFormFields){
      if(!formFillTouched.has(field.name))continue;
      const draft=formFillDraft[field.name];
      if(field.type==='checkbox'){
        updates.push({name:field.name,checked:Boolean(draft)});
      }else if(field.type==='radio'||field.type==='dropdown'||field.type==='list'){
        updates.push({name:field.name,selected:Array.isArray(draft)?draft:[]});
      }else if(field.type==='text'){
        if(field.password&&typeof draft!=='string')continue;
        updates.push({name:field.name,value:typeof draft==='string'?draft:''});
      }
    }
    if(!updates.length){
      setActionNotice('No editable PDF form values have changed.');
      return;
    }
    await mutate(
      `Updated ${updates.length} PDF form field value(s).`,
      (bytes)=>fillPdfFormFields(bytes,updates),
      currentPage,
    );
  }

  async function flattenForm(){
    if(!formFields.length)return;
    await mutate(
      `Flattened ${formFields.length} PDF form field(s).`,
      (bytes)=>flattenPdfForm(bytes),
      currentPage,
    );
  }


  function pagesForScope(scope:'selected'|'all'):number[]|undefined{
    return scope==='selected' ? operationPages : undefined;
  }

  async function applyHeaderFooter(){
    await mutate(
      `Applied PDF header/footer to ${headerFooterDraft.scope==='selected' ? operationPages.length : pageCount} page(s).`,
      (bytes)=>addPdfHeaderFooter(bytes,{
        pageNumbers:pagesForScope(headerFooterDraft.scope),
        header:headerFooterDraft.header,
        footer:headerFooterDraft.footer,
        fontSize:headerFooterDraft.fontSize,
        margin:headerFooterDraft.margin,
        headerAlign:headerFooterDraft.headerAlign,
        footerAlign:headerFooterDraft.footerAlign,
      }),
      currentPage,
    );
  }

  async function applyBates(){
    await mutate(
      `Applied Bates numbering to ${batesDraft.scope==='selected' ? operationPages.length : pageCount} page(s).`,
      (bytes)=>addPdfBatesNumbers(bytes,{
        pageNumbers:pagesForScope(batesDraft.scope),
        prefix:batesDraft.prefix,
        suffix:batesDraft.suffix,
        startNumber:batesDraft.startNumber,
        digits:batesDraft.digits,
        fontSize:batesDraft.fontSize,
        margin:batesDraft.margin,
        position:batesDraft.position,
      }),
      currentPage,
    );
  }

  useEffect(()=>{
    if(!sourceBytes){
      setPageLabelRanges([]);
      setPageLabelError('');
      return;
    }
    let cancelled=false;
    setPageLabelRanges([]);
    void listPdfPageLabelRanges(sourceBytes)
      .then(ranges=>{if(!cancelled){setPageLabelRanges(ranges);setPageLabelError('');}})
      .catch(reason=>{
        if(!cancelled){
          setPageLabelRanges([]);
          setPageLabelError(reason instanceof Error?reason.message:String(reason));
        }
      });
    return ()=>{cancelled=true;};
  },[sourceBytes]);

  useEffect(()=>{
    if(!pdf){setLogicalPageLabels([]);return;}
    let cancelled=false;
    setLogicalPageLabels([]);
    void pdf.document.getPageLabels()
      .then(labels=>{if(!cancelled)setLogicalPageLabels(labels??[]);})
      .catch(()=>{if(!cancelled)setLogicalPageLabels([]);});
    return()=>{cancelled=true;};
  },[pdf]);

  async function applyPageLabel(){
    await mutate(
      'Updated PDF logical page labels at physical page '+currentPage+'.',
      bytes=>setPdfPageLabelRange(bytes,{...pageLabelDraft,startPage:currentPage}),
      currentPage,
    );
  }

  async function clearAllPageLabels(){
    if(!window.confirm('Remove all PDF logical page labels? You can Undo the change.'))return;
    await mutate('Removed all PDF logical page labels.',clearPdfPageLabelRanges,currentPage);
  }

  async function applyPageBox(){
    await mutate(
      `Updated ${pageBoxDraft.box} box on ${pageBoxDraft.scope==='selected' ? operationPages.length : pageCount} page(s).`,
      (bytes)=>setPdfPageBox(bytes,{
        pageNumbers:pagesForScope(pageBoxDraft.scope),
        box:pageBoxDraft.box,
        top:pageBoxDraft.top,
        right:pageBoxDraft.right,
        bottom:pageBoxDraft.bottom,
        left:pageBoxDraft.left,
      }),
      currentPage,
    );
  }

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

  async function exportText(){
    if(!pdf||exportingText||mutating)return;
    const controller=new AbortController();
    textExportAbortRef.current=controller;
    setExportingText(true);
    setTextExportProgress(0);
    setError('');
    setActionNotice('Extracting the existing PDF text layer…');
    onSavingChange?.(true);
    try{
      const content=await extractPdfDocumentText(pdf.document,{
        signal:controller.signal,
        onProgress:(completed,total)=>{
          if(completed===total||completed%10===0){
            setTextExportProgress(Math.round(100*completed/total));
          }
        },
      });
      if(controller.signal.aborted)return;
      const base=sourceName.replace(/\.pdf$/i,'').replace(/[/\\\u0000-\u001F]/g,'_').slice(0,120)||'MALENJO-document';
      const saved=await exportPdfPlainText(base+'-text.txt',content);
      if(saved)setActionNotice('Exported text from '+pdf.document.numPages+' PDF page(s).');
    }catch(reason){
      if(reason instanceof Error&&reason.name==='AbortError'){
        setActionNotice('PDF text export cancelled. No partial file was saved.');
      }else{
        setError(reason instanceof Error?reason.message:String(reason));
      }
    }finally{
      if(textExportAbortRef.current===controller)textExportAbortRef.current=null;
      setExportingText(false);
      onSavingChange?.(false);
    }
  }

  async function chooseImagesForPdf(event:React.ChangeEvent<HTMLInputElement>){
    const files=Array.from(event.target.files??[]);
    event.target.value='';
    if(!files.length||creatingImagePdf)return;
    const controller=new AbortController();
    imagesAbortRef.current=controller;
    setCreatingImagePdf(true);
    setImagePdfProgress(0);
    setError('');
    setActionNotice('Creating PDF from local image files…');
    onSavingChange?.(true);
    try{
      if(files.length>PDF_IMAGE_MAX_COUNT)throw new Error('Select at most 100 images.');
      let totalSize=0;
      for(const file of files){
        if(!file.size||file.size>PDF_IMAGE_MAX_BYTES)throw new Error(file.name+' must be 32 MB or smaller.');
        totalSize+=file.size;
        if(totalSize>PDF_IMAGE_MAX_TOTAL_BYTES)throw new Error('The selected images exceed the 128 MB input limit.');
      }
      const images=[];
      for(const file of files){
        if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
        images.push({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
      }
      const bytes=await createPdfFromImages(images,{
        signal:controller.signal,
        onProgress:(completed,total)=>setImagePdfProgress(Math.round(100*completed/total)),
      });
      if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
      const saved=await exportPdfBytes('MALENJO-images.pdf',bytes);
      if(saved)setActionNotice('Created '+files.length+'-page PDF from local images. Open the exported file to edit it.');
    }catch(reason){
      if(reason instanceof Error&&reason.name==='AbortError'){
        setActionNotice('Image-to-PDF conversion cancelled. No partial file was saved.');
      }else{
        setError(reason instanceof Error?reason.message:String(reason));
      }
    }finally{
      if(imagesAbortRef.current===controller)imagesAbortRef.current=null;
      setCreatingImagePdf(false);
      onSavingChange?.(false);
    }
  }

  async function exportPageImages(){
    if(!pdf||exportingPageImages||mutating||loading)return;
    const activeDocument=pdf.document;
    const controller=new AbortController();
    pageImageAbortRef.current=controller;
    setExportingPageImages(true);
    setPageImageProgress(0);
    setError('');
    setActionNotice('Rendering PDF pages as PNG images…');
    onSavingChange?.(true);
    try{
      const zipped=await exportPdfPagesAsPngZip(activeDocument,{
        signal:controller.signal,
        scale:1,
        onProgress:(finished,total)=>setPageImageProgress(Math.round(100*finished/total)),
      });
      if(controller.signal.aborted||activeLoadRef.current?.document!==activeDocument){
        const reason=new Error('PDF image export was cancelled or the current PDF changed.');
        reason.name='AbortError';
        throw reason;
      }
      const base=sourceName.replace(/\.pdf$/i,'').replace(/[/\\\u0000-\u001F]/g,'_').slice(0,120)||'MALENJO-document';
      const saved=await exportPdfPageImagesZip(base+'-pages.zip',zipped);
      if(saved)setActionNotice('Exported '+activeDocument.numPages+' PDF page(s) as PNG images.');
    }catch(reason){
      if(reason instanceof Error&&reason.name==='AbortError'){
        setActionNotice('PDF-to-PNG export cancelled; no partial ZIP was saved.');
      }else setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      if(pageImageAbortRef.current===controller)pageImageAbortRef.current=null;
      setExportingPageImages(false);
      onSavingChange?.(false);
    }
  }

  async function compareWithPdf(event:React.ChangeEvent<HTMLInputElement>){
    const selected=event.target.files?.[0];
    event.target.value='';
    if(!selected||!pdf||comparingPdf||mutating||loading)return;
    if(!selected.size||selected.size>48*1024*1024){
      setError('Comparison PDF must be nonempty and no larger than 48 MB.');
      return;
    }
    const original=pdf.document;
    const baselineName=sourceName;
    const controller=new AbortController();
    comparisonAbortRef.current=controller;
    setComparingPdf(true);
    setComparisonProgress(0);
    setComparisonResult(null);
    setError('');
    setActionNotice('Comparing the selectable text in both PDFs…');
    onSavingChange?.(true);
    let second:PdfLoadResult|null=null;
    try{
      const incoming=await selected.arrayBuffer();
      if(controller.signal.aborted)return;
      second=await loadPdfBytes(incoming);
      if(controller.signal.aborted)return;
      const data=await comparePdfSelectableText(original,second.document,{
        signal:controller.signal,
        onProgress:(done,total)=>setComparisonProgress(Math.round(100*done/total)),
      });
      if(controller.signal.aborted||activeLoadRef.current?.document!==original)return;
      setComparisonResult({data,baselineName,comparisonName:selected.name});
      setActionNotice('Compared both PDFs by page-aligned selectable text. Visual differences were not assessed.');
      setTaskCategory('convert');
    }catch(reason){
      if(reason instanceof Error&&reason.name==='AbortError'){
        setActionNotice('PDF comparison cancelled; no partial result was saved.');
      }else{
        setError(reason instanceof Error?reason.message:String(reason));
      }
    }finally{
      if(second){
        try{await disposePdf(second);}catch{
          // Release best effort. Never hide the original comparison error.
        }
      }
      if(comparisonAbortRef.current===controller)comparisonAbortRef.current=null;
      setComparingPdf(false);
      onSavingChange?.(false);
    }
  }

  async function exportComparisonReport(){
    if(!comparisonResult)return;
    onSavingChange?.(true);
    try{
      const report=formatPdfTextComparison(
        comparisonResult.data,comparisonResult.baselineName,comparisonResult.comparisonName,
      );
      const base=comparisonResult.baselineName
        .replace(/\.pdf$/i,'').replace(/[/\\\u0000-\u001F]/g,'_').slice(0,100)||'MALENJO-document';
      if(await exportPdfPlainText(base+'-comparison.txt',report)){
        setActionNotice('Exported a selectable-text comparison report.');
      }
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      onSavingChange?.(false);
    }
  }

  async function exportCurrent(){
    if(!sourceBytes){
      setActionNotice('Open a PDF first.');
      return;
    }
    onSavingChange?.(true);
    try{
      const name=dirty?editedName(sourceName):editedName(sourceName,'copy');
      const saved=await exportPdfBytes(name,sourceBytes);
      if(saved)setActionNotice(dirty?'Exported the edited PDF as a new file.':'Exported a PDF copy.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      onSavingChange?.(false);
    }
  }

  async function extractSelected(){
    if(!sourceBytes)return;
    onSavingChange?.(true);
    try{
      const pages=operationPages;
      const bytes=await extractPdfPages(sourceBytes,pages);
      const base=sourceName.replace(/\.pdf$/i,'')||'MALENJO-document';
      const label=pages.length===1?`page-${pages[0]}`:`pages-${pages[0]}-${pages[pages.length-1]}`;
      await exportPdfBytes(`${base}-${label}.pdf`,bytes);
      setActionNotice(`Extracted ${pages.length} selected page(s) as a new PDF.`);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      onSavingChange?.(false);
    }
  }

  async function splitCurrent(){
    if(!sourceBytes||currentPage>=pageCount)return;
    onSavingChange?.(true);
    try{
      const [left,right]=await splitPdfAtPage(sourceBytes,currentPage);
      const base=sourceName.replace(/\.pdf$/i,'')||'MALENJO-document';
      await exportPdfBytes(`${base}-part-1.pdf`,left);
      await exportPdfBytes(`${base}-part-2.pdf`,right);
      setActionNotice(`Split after page ${currentPage} and exported two PDFs.`);
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      onSavingChange?.(false);
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
          id:'export-text',
          label:'Export selectable PDF text',
          keywords:'convert pdf to text extract txt searchable text',
          detail:'Save existing selectable text with page markers; scanned documents require OCR',
          enabled:!!pdf&&!mutating&&!exportingText,
          disabledReason:!pdf?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':exportingText?'A text export is in progress.':undefined,
          run:()=>exportText(),
        },
        {
          id:'images-to-pdf',
          label:'Create PDF from images',
          keywords:'convert png jpeg jpg images photos create pdf',
          detail:'Choose up to 100 local PNG/JPEG images and export a new PDF',
          enabled:!creatingImagePdf&&!mutating,
          disabledReason:creatingImagePdf?'Image conversion is running.':mutating?'Wait for the current PDF edit to finish.':undefined,
          run:()=>imagesInputRef.current?.click(),
        },
        {
          id:'export-page-images',
          label:'Export PDF pages as PNG ZIP',
          keywords:'convert pdf pages png images zip',
          detail:'Locally render up to 50 pages at 1× resolution and download PNG images in a ZIP',
          enabled:!!pdf&&!mutating&&!loading&&!exportingPageImages,
          disabledReason:!pdf?'No PDF is loaded.':exportingPageImages?'Image export in progress.':'Wait for current PDF operation.',
          run:()=>exportPageImages(),
        },
        {
          id:'compare-pdf-text',
          label:'Compare PDF selectable text',
          keywords:'pdf compare document difference revision text page report',
          detail:'Choose a second PDF; compare page-aligned selectable text without claiming visual differences',
          enabled:!!pdf&&!loading&&!mutating&&!comparingPdf,
          disabledReason:!pdf?'Open a PDF first.':comparingPdf?'Comparison is running.':'Wait for the current PDF operation.',
          run:()=>comparisonInputRef.current?.click(),
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
          id:'attach',
          label:'Embed file attachment in PDF',
          keywords:'attach embed file paperclip pdf',
          detail:'Choose one or more files and embed them inside the current PDF',
          enabled:!!sourceBytes && !mutating,
          disabledReason:!sourceBytes ? 'No PDF is loaded.' : 'Wait for the current PDF edit to finish.',
          run:()=>attachmentInputRef.current?.click(),
        },
        {
          id:'add-form-field',
          label:'Add configured PDF form field',
          keywords:'form acroform field text checkbox radio dropdown list required readonly',
          detail:`${formDraft.type} · ${formDraft.name.trim()||'field name required'}`,
          enabled:!!sourceBytes && !mutating && !!formDraft.name.trim(),
          disabledReason:!sourceBytes
            ? 'No PDF is loaded.'
            : !formDraft.name.trim()
              ? 'Enter a form field name first.'
              : 'Wait for the current PDF edit to finish.',
          run:()=>addFormField(),
        },
        {
          id:'fill-form',
          label:'Apply PDF form values',
          keywords:'form acroform fill fields values input',
          detail:fillableFormFields.length ? `Update ${fillableFormFields.length} fillable field(s)` : 'No editable AcroForm fields detected',
          enabled:!!sourceBytes && !mutating && fillableFormFields.length>0,
          disabledReason:!sourceBytes ? 'No PDF is loaded.' : !fillableFormFields.length ? 'No editable AcroForm fields detected.' : 'Wait for the current PDF edit to finish.',
          run:()=>fillForm(),
        },
        {
          id:'flatten-form',
          label:'Flatten PDF form fields',
          keywords:'form acroform flatten fields',
          detail:formFields.length ? `Flatten ${formFields.length} interactive field(s)` : 'No AcroForm fields detected',
          enabled:!!sourceBytes && !mutating && formFields.length>0,
          disabledReason:!sourceBytes ? 'No PDF is loaded.' : !formFields.length ? 'No AcroForm fields detected.' : 'Wait for the current PDF edit to finish.',
          run:()=>flattenForm(),
        },
        {
          id:'header-footer',
          label:'Apply PDF header / footer',
          keywords:'header footer page number date stamp',
          detail:headerFooterDraft.header||headerFooterDraft.footer||'Configure header/footer text in the PDF inspector',
          enabled:!!sourceBytes && !mutating && !!(headerFooterDraft.header.trim()||headerFooterDraft.footer.trim()),
          disabledReason:!sourceBytes ? 'No PDF is loaded.' : !(headerFooterDraft.header.trim()||headerFooterDraft.footer.trim()) ? 'Enter header or footer text in the PDF inspector.' : 'Wait for the current PDF edit to finish.',
          run:()=>applyHeaderFooter(),
        },
        {
          id:'bates',
          label:'Apply Bates numbering',
          keywords:'bates numbering sequence case stamp pages',
          detail:`${batesDraft.prefix}${String(batesDraft.startNumber).padStart(batesDraft.digits,'0')}${batesDraft.suffix}`,
          enabled:!!sourceBytes && !mutating,
          disabledReason:!sourceBytes ? 'No PDF is loaded.' : 'Wait for the current PDF edit to finish.',
          run:()=>applyBates(),
        },
        {
          id:'pdf-page-label',
          label:'Set logical PDF page label',
          keywords:'pdf organize labels roman arabic prefix logical numbering',
          detail:'Apply the configured style to the current physical PDF page',
          enabled:!!sourceBytes&&!mutating,
          disabledReason:!sourceBytes?'Open a PDF first.':'Wait for the PDF edit to finish.',
          run:()=>applyPageLabel(),
        },
        {
          id:'page-box',
          label:'Apply PDF page box',
          keywords:'crop trim bleed art box margins',
          detail:`${pageBoxDraft.box} box · ${pageBoxDraft.scope} pages`,
          enabled:!!sourceBytes && !mutating,
          disabledReason:!sourceBytes ? 'No PDF is loaded.' : 'Wait for the current PDF edit to finish.',
          run:()=>applyPageBox(),
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
        {
          id:'toggle-inspector',
          label:inspectorHidden ? 'Show right inspector' : 'Hide right inspector',
          keywords:'inspector properties panel right sidebar focus canvas',
          detail:DOCUMENT_INSPECTOR_SHORTCUT,
          enabled:true,
          run:()=>setInspectorHidden((value)=>!value),
        },
        {
          id:'pdf-text-place',
          label:'Place configured text on current PDF page',
          keywords:'pdf edit add text place text',
          detail:textOverlay.text.trim()?'Uses text and coordinates from Properties inspector':'Enter text in the Properties inspector first',
          enabled:!!sourceBytes&&!mutating&&!!textOverlay.text.trim(),
          disabledReason:!sourceBytes?'No PDF is loaded.':!textOverlay.text.trim()?'Enter text in the Properties inspector first.':'Wait for the current PDF edit to finish.',
          run:()=>mutateAction('Added permanent text to the PDF.',bytes=>addPdfTextOverlay(bytes,{pageNumber:currentPage,...textOverlay}),currentPage),
        },
        {
          id:'pdf-rectangle-add',
          label:`Add configured ${shapeOverlay.mode} rectangle`,
          keywords:'pdf edit highlight outline rectangle shape',
          detail:'Uses geometry from Properties inspector',
          enabled:!!sourceBytes&&!mutating,
          disabledReason:!sourceBytes?'No PDF is loaded.':'Wait for the current PDF edit to finish.',
          run:()=>mutateAction(`Added ${shapeOverlay.mode} rectangle.`,bytes=>addPdfRectangleOverlay(bytes,{pageNumber:currentPage,...shapeOverlay}),currentPage),
        },
        {
          id:'pdf-pages-remove',
          label:`Delete ${operationPages.length} selected PDF page${operationPages.length===1?'':'s'}`,
          keywords:'pdf organize delete remove pages',
          detail:'Permanent working-copy page removal; Undo is available before export',
          enabled:!!sourceBytes&&!mutating&&operationPages.length<pageCount,
          disabledReason:operationPages.length>=pageCount?'A PDF must retain at least one page.':!sourceBytes?'No PDF is loaded.':'Wait for the current PDF edit to finish.',
          run:()=>mutateAction(`Deleted ${operationPages.length} selected page(s).`,bytes=>operationPages.length===1?deletePdfPage(bytes,operationPages[0]):deletePdfPages(bytes,operationPages),Math.max(1,Math.min(operationPages[0],pageCount-operationPages.length))),
        },
        {
          id:'pdf-page-copy',
          label:'Duplicate selected PDF page',
          keywords:'pdf organize duplicate copy page',
          detail:'Requires exactly one selected page',
          enabled:!!sourceBytes&&!mutating&&operationPages.length===1,
          disabledReason:operationPages.length!==1?'Select exactly one page.':!sourceBytes?'No PDF is loaded.':'Wait for the current PDF edit to finish.',
          run:()=>mutateAction(`Duplicated page ${currentPage}.`,bytes=>duplicatePdfPage(bytes,currentPage),currentPage+1),
        },
        {
          id:'pdf-pages-turn',
          label:'Rotate selected PDF pages permanently',
          keywords:'pdf organize rotate pages',
          detail:`${operationPages.length} selected page(s)`,
          enabled:!!sourceBytes&&!mutating,
          disabledReason:!sourceBytes?'No PDF is loaded.':'Wait for the current PDF edit to finish.',
          run:()=>mutateAction(`Permanently rotated ${operationPages.length} selected page(s) by 90°.`,bytes=>operationPages.length===1?rotatePdfPagePermanent(bytes,operationPages[0]):rotatePdfPagesPermanent(bytes,operationPages),operationPages[0]),
        },
        {
          id:'pdf-pages-extract',
          label:'Extract selected PDF pages',
          keywords:'pdf organize extract pages export',
          detail:`${operationPages.length} selected page(s)`,
          enabled:!!sourceBytes&&!mutating,
          disabledReason:!sourceBytes?'No PDF is loaded.':'Wait for the current PDF edit to finish.',
          run:()=>extractSelected(),
        },
        {
          id:'pdf-document-split',
          label:'Split PDF after current page',
          keywords:'pdf organize split document',
          detail:`Split after page ${currentPage}`,
          enabled:!!sourceBytes&&!mutating&&currentPage<pageCount,
          disabledReason:currentPage>=pageCount?'Move before the final page to split the PDF.':!sourceBytes?'No PDF is loaded.':'Wait for the current PDF edit to finish.',
          run:()=>splitCurrent(),
        },
        {
          id:'pdf-bookmark-create',
          label:'Bookmark current PDF page',
          keywords:'pdf bookmarks outline add chapter navigate',
          detail:bookmarkTitle.trim()?'Add named top-level bookmark':'Enter a bookmark title in Bookmarks panel',
          enabled:!!sourceBytes&&!mutating&&!!bookmarkTitle.trim(),
          disabledReason:!sourceBytes?'Open a PDF first.':!bookmarkTitle.trim()?'Enter a bookmark title in Bookmarks panel.':'Wait for the PDF edit to finish.',
          run:()=>addCurrentPageBookmark(),
        },
        {
          id:'pdf-comments-open',
          label:'Open PDF Comments panel',
          keywords:'pdf comment annotations notes',
          detail:'Open the persistent Comments panel',
          enabled:true,
          run:()=>openLeftPanel('comments'),
        },
        {
          id:'pdf-comment-create',
          label:'Add configured PDF comment',
          keywords:'pdf comment annotation note add',
          detail:commentDraft.text.trim()?'Uses comment text from Comments panel':'Enter comment text in the Comments panel first',
          enabled:!!sourceBytes&&!mutating&&!!commentDraft.text.trim(),
          disabledReason:!sourceBytes?'No PDF is loaded.':!commentDraft.text.trim()?'Enter comment text in the Comments panel first.':'Wait for the current PDF edit to finish.',
          run:()=>addComment(),
        },
        {
          id:'pdf-signatures-open',
          label:'Open PDF signature fields panel',
          keywords:'pdf signatures sign fields',
          detail:`${formFields.filter((field)=>field.type==='signature').length} signature field(s) detected`,
          enabled:true,
          run:()=>openLeftPanel('signatures'),
        },
      ],
    });
    return () => registerCommands(null);
  }, [
    session, registerCommands, sourceBytes, pdf, dirty, mutating, loading, comparingPdf, exportingPageImages, exportingText, creatingImagePdf, historyRevision, formFields.length,
    headerFooterDraft, batesDraft, pageBoxDraft, pageLabelDraft, formDraft, formFillDraft, formFillTouched, currentPage, pageCount, selectedPages,
    inspectorHidden, textOverlay, shapeOverlay, commentDraft, bookmarkTitle,
  ]);

  useEffect(() => {
    if (!active) return;
    function onInspectorShortcut(event: KeyboardEvent) {
      if (!isDocumentInspectorToggleShortcut(event)) return;
      event.preventDefault();
      setInspectorHidden((value)=>!value);
    }
    window.addEventListener('keydown', onInspectorShortcut);
    return () => window.removeEventListener('keydown', onInspectorShortcut);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    function onTaskShortcut(event: KeyboardEvent) {
      const target=event.target as HTMLElement|null;
      if(target?.closest('input,textarea,[contenteditable="true"]'))return;
      const category=pdfTaskCategoryFromShortcut(event);
      if(!category)return;
      event.preventDefault();
      setTaskCategory(category);
      window.requestAnimationFrame(()=>document.getElementById(`${domIdPrefix}-task-${category}`)?.focus());
    }
    window.addEventListener('keydown',onTaskShortcut);
    return()=>window.removeEventListener('keydown',onTaskShortcut);
  },[active,domIdPrefix]);

  const zoomLabel = fitMode === 'width'
    ? 'Fit width'
    : fitMode === 'page'
      ? 'Fit page'
      : `${Math.round(zoom * 100)}%`;

  const viewPages=pdfViewPages(viewMode,currentPage,pageCount);

  useEffect(()=>{
    function onFullscreenChange(){
      const active=Boolean(document.fullscreenElement);
      setFullscreen(active);
      if(!active)setPresentationMode(false);
    }
    document.addEventListener('fullscreenchange',onFullscreenChange);
    return()=>document.removeEventListener('fullscreenchange',onFullscreenChange);
  },[]);

  const toggleFullscreen=async(presentation=false)=>{
    const element=workspaceRef.current;
    if(!element)return;
    if(document.fullscreenElement){
      await document.exitFullscreen();
      return;
    }
    setPresentationMode(presentation);
    if(presentation){
      setViewMode('single');
      setFitMode('page');
    }
    await element.requestFullscreen();
  };

  const thumbnailsRenderAllowed = forceRenderAll
    || pdfCriticalPassReady(currentPage, pageCount, renderedPages);
  const pdfLayoutClass = [
    'pdf-layout',
    leftPanelCollapsed ? 'left-panel-collapsed' : '',
    inspectorHidden ? 'inspector-hidden' : '',
  ].filter(Boolean).join(' ');

  const configureProperties=()=>{
    setInspectorTab('properties');
    setInspectorHidden(false);
  };
  const openLeftPanel=(panel:PdfLeftPanelId)=>{
    setLeftPanel(panel);
    setLeftPanelCollapsed(false);
  };
  const navigateAction=(label:string,id:'ai'|'security'|'sign'|'scanner'|'automation'):PdfToolbarAction=>({
    id:`navigate-${id}`,
    label,
    enabled:!!onNavigateModule,
    disabledReason:onNavigateModule?undefined:'Suite navigation is unavailable in this workspace.',
    run:()=>onNavigateModule?.(id),
  });
  const providerCategory = taskCategory === 'ai' ? null : taskCategory as PdfProviderToolCategory;
  const providerAction:PdfToolbarAction={
    id:'local-provider-tools',
    label:'Local tools',
    enabled:true,
    run:()=>setProviderPanelOpen((value)=>!value),
  };

  const taskActions:Record<PdfTaskCategory,PdfToolbarAction[]>={
    home:[
      {id:'files',label:'Files',enabled:true,run:onBackToFiles},
      {id:'open',label:'Open PDF',enabled:!session,disabledReason:session?'Open additional documents from Files / Library so they receive their own tabs.':undefined,run:()=>fileInputRef.current?.click()},
      {id:'export',label:'Export',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:exportCurrent},
      {id:'print',label:'Print',enabled:!!pdf&&!mutating,disabledReason:!pdf?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:printDocument},
      {id:'inspector',label:inspectorHidden?'Show inspector':'Hide inspector',enabled:true,run:()=>setInspectorHidden((value)=>!value)},
      providerAction,
    ],
    edit:[
      {id:'undo',label:'Undo',enabled:!!historyRef.current&&!mutating&&canUndoPdfHistory(historyRef.current),disabledReason:mutating?'Wait for the current PDF edit to finish.':'There is no PDF edit to undo.',run:undoEdit},
      {id:'redo',label:'Redo',enabled:!!historyRef.current&&!mutating&&canRedoPdfHistory(historyRef.current),disabledReason:mutating?'Wait for the current PDF edit to finish.':'There is no PDF edit to redo.',run:redoEdit},
      {id:'place-text',label:'Place text',enabled:!!sourceBytes&&!mutating&&!!textOverlay.text.trim(),disabledReason:!sourceBytes?'No PDF is loaded.':!textOverlay.text.trim()?'Enter text in the Properties inspector first.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction('Added permanent text to the PDF.',bytes=>addPdfTextOverlay(bytes,{pageNumber:currentPage,...textOverlay}),currentPage)},
      {id:'rectangle',label:shapeOverlay.mode==='highlight'?'Highlight rectangle':'Outline rectangle',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction(`Added ${shapeOverlay.mode} rectangle.`,bytes=>addPdfRectangleOverlay(bytes,{pageNumber:currentPage,...shapeOverlay}),currentPage)},
      {id:'configure-edit',label:'Edit settings',enabled:true,run:configureProperties},
      providerAction,
    ],
    convert:[
      {id:'export-text',label:exportingText?'Extracting text '+textExportProgress+'%':'PDF to text (.txt)',enabled:!!pdf&&!mutating&&!exportingText,disabledReason:!pdf?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':exportingText?'PDF text export is running.':undefined,run:exportText},
      {id:'export-page-images',label:exportingPageImages?'PNG '+pageImageProgress+'%':'PDF pages to PNG ZIP',enabled:!!pdf&&!mutating&&!loading&&!exportingPageImages,disabledReason:!pdf?'No PDF is loaded.':exportingPageImages?'An image export is in progress.':'Wait for the current PDF operation to finish.',run:exportPageImages},
      ...(exportingPageImages?[{id:'cancel-page-images',label:'Cancel PNG export',enabled:true,run:()=>pageImageAbortRef.current?.abort()}]:[]),
      {id:'images-to-pdf',label:creatingImagePdf?'Images '+imagePdfProgress+'%':'Images to PDF…',enabled:!creatingImagePdf&&!mutating,disabledReason:creatingImagePdf?'Image conversion is running.':mutating?'Wait for the current PDF mutation to finish.':undefined,run:()=>imagesInputRef.current?.click()},
      {id:'compare-pdf',label:comparingPdf?'Compare '+comparisonProgress+'%':'Compare PDF text…',enabled:!!pdf&&!loading&&!mutating&&!comparingPdf,disabledReason:!pdf?'Open a PDF first.':comparingPdf?'Comparison is in progress.':'Wait for the current PDF operation.',run:()=>comparisonInputRef.current?.click()},
      ...(comparingPdf?[{id:'cancel-compare',label:'Cancel comparison',enabled:true,run:()=>comparisonAbortRef.current?.abort()}]:[]),
      ...(exportingText?[{id:'cancel-text',label:'Cancel text export',enabled:true,run:()=>textExportAbortRef.current?.abort()}]:[]),
      ...(creatingImagePdf?[{id:'cancel-images',label:'Cancel image conversion',enabled:true,run:()=>imagesAbortRef.current?.abort()}]:[]),
      providerAction,
    ],
    organize:[
      {id:'turn-pages',label:'Rotate selected',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction(`Permanently rotated ${operationPages.length} selected page(s) by 90°.`,bytes=>operationPages.length===1?rotatePdfPagePermanent(bytes,operationPages[0]):rotatePdfPagesPermanent(bytes,operationPages),operationPages[0])},
      {id:'remove-pages',label:`Delete ${operationPages.length} page${operationPages.length===1?'':'s'}`,enabled:!!sourceBytes&&!mutating&&operationPages.length<pageCount,disabledReason:!sourceBytes?'No PDF is loaded.':operationPages.length>=pageCount?'A PDF must retain at least one page.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction(`Deleted ${operationPages.length} selected page(s).`,bytes=>operationPages.length===1?deletePdfPage(bytes,operationPages[0]):deletePdfPages(bytes,operationPages),Math.max(1,Math.min(operationPages[0],pageCount-operationPages.length)))},
      {id:'copy-page',label:'Duplicate page',enabled:!!sourceBytes&&!mutating&&operationPages.length===1,disabledReason:operationPages.length!==1?'Select exactly one page.':mutating?'Wait for the current PDF edit to finish.':!sourceBytes?'No PDF is loaded.':undefined,run:()=>mutateAction(`Duplicated page ${currentPage}.`,bytes=>duplicatePdfPage(bytes,currentPage),currentPage+1)},
      {id:'extract-pages',label:'Extract selected',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:extractSelected},
      {id:'split',label:'Split here',enabled:!!sourceBytes&&!mutating&&currentPage<pageCount,disabledReason:!sourceBytes?'No PDF is loaded.':currentPage>=pageCount?'Move before the final page to split the PDF.':mutating?'Wait for the current PDF edit to finish.':undefined,run:splitCurrent},
      {id:'insert',label:'Insert PDF…',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>insertInputRef.current?.click()},
      {id:'append',label:'Append PDF…',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>appendInputRef.current?.click()},
      {id:'blank',label:'Blank after',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction(`Inserted a blank page after page ${currentPage}.`,bytes=>insertBlankPdfPage(bytes,currentPage),currentPage+1)},
      {id:'page-labels',label:'Set page label',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'Open a PDF first.':'Wait for PDF edit.',run:applyPageLabel},
      {id:'earlier',label:'Move earlier',enabled:!!sourceBytes&&!mutating&&operationPages.length===1&&currentPage>1,disabledReason:!sourceBytes?'No PDF is loaded.':operationPages.length!==1?'Select exactly one page.':currentPage<=1?'The first page cannot move earlier.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction('Moved page earlier.',bytes=>movePdfPage(bytes,currentPage,currentPage-1),currentPage-1)},
      {id:'later',label:'Move later',enabled:!!sourceBytes&&!mutating&&operationPages.length===1&&currentPage<pageCount,disabledReason:!sourceBytes?'No PDF is loaded.':operationPages.length!==1?'Select exactly one page.':currentPage>=pageCount?'The final page cannot move later.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction('Moved page later.',bytes=>movePdfPage(bytes,currentPage,currentPage+1),currentPage+1)},
      providerAction,
    ],
    comment:[
      {id:'comments-panel',label:'Comments panel',enabled:true,run:()=>openLeftPanel('comments')},
      {id:'add-comment',label:'Add comment',enabled:!!sourceBytes&&!mutating&&!!commentDraft.text.trim(),disabledReason:!sourceBytes?'No PDF is loaded.':!commentDraft.text.trim()?'Enter comment text in the Comments panel first.':mutating?'Wait for the current PDF edit to finish.':undefined,run:addComment},
      {id:'markup-region',label:'Add '+markupDraft.kind+' region',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:addReviewMarkup},
      providerAction,
    ],
    sign:[
      navigateAction('Open Sign workspace','sign'),
      {id:'signatures-panel',label:'Signature fields',enabled:true,run:()=>openLeftPanel('signatures')},
      providerAction,
    ],
    protect:[
      navigateAction('Open Security Center','security'),
      providerAction,
    ],
    forms:[
      {id:'add-form-field',label:`Add ${formDraft.type} field`,enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:addFormField},
      {id:'fill-form',label:'Apply field values',enabled:!!sourceBytes&&!mutating&&fillableFormFields.length>0,disabledReason:!sourceBytes?'No PDF is loaded.':!fillableFormFields.length?'No editable AcroForm fields are present.':mutating?'Wait for the current PDF edit to finish.':undefined,run:fillForm},
      {id:'flatten-form',label:'Flatten fields',enabled:!!sourceBytes&&!mutating&&formFields.length>0,disabledReason:!sourceBytes?'No PDF is loaded.':!formFields.length?'No AcroForm fields are present.':mutating?'Wait for the current PDF edit to finish.':undefined,run:flattenForm},
      {id:'configure-forms',label:'Form settings',enabled:true,run:configureProperties},
      providerAction,
    ],
    ai:[navigateAction('Open Malenjo AI','ai')],
    scan:[navigateAction('Open Scanner','scanner'),providerAction],
    automate:[navigateAction('Open Automation Studio','automation'),providerAction],
  };
  const activeTaskActions=taskActions[taskCategory];
  const primaryTaskActions=activeTaskActions.slice(0,6);
  const overflowTaskActions=activeTaskActions.slice(6);
  const taskActionTitle=(action:PdfToolbarAction)=>action.enabled?action.label:`${action.label} — ${action.disabledReason??'Unavailable'}`;
  const focusTaskCategory=(category:PdfTaskCategory)=>{
    setTaskCategory(category);
    window.requestAnimationFrame(()=>document.getElementById(`${domIdPrefix}-task-${category}`)?.focus());
  };

  return <div ref={workspaceRef} className={`pdf-workspace${presentationMode?' presentation-mode':''}`}>
    <input
      ref={fileInputRef}
      className="visually-hidden"
      type="file"
      accept="application/pdf,.pdf"
      onChange={(event) => void chooseBrowserPdf(event)}
    />
    <input
      ref={comparisonInputRef}
      className="visually-hidden"
      type="file"
      accept="application/pdf,.pdf"
      onChange={(event)=>void compareWithPdf(event)}
    />
    <input
      ref={imagesInputRef}
      className="visually-hidden"
      type="file"
      accept="image/png,image/jpeg,.png,.jpg,.jpeg"
      multiple
      onChange={(event)=>void chooseImagesForPdf(event)}
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
    <input
      ref={attachmentInputRef}
      className="visually-hidden"
      type="file"
      multiple
      onChange={(event)=>void attachDocuments(event)}
    />

    <div className="pdf-task-toolbar">
      <div className="pdf-task-categories" role="tablist" aria-label="PDF task categories">
        {PDF_TASK_CATEGORIES.map((category)=><button
          id={`${domIdPrefix}-task-${category}`}
          key={category}
          role="tab"
          aria-selected={taskCategory===category}
          aria-controls={`${domIdPrefix}-task-tools`}
          aria-keyshortcuts={PDF_TASK_CATEGORY_SHORTCUTS[category]}
          tabIndex={taskCategory===category?0:-1}
          className={taskCategory===category?'active':''}
          title={`${PDF_TASK_CATEGORY_LABELS[category]} · ${PDF_TASK_CATEGORY_SHORTCUTS[category]}`}
          onClick={()=>{setTaskCategory(category);if(category==='ai')setProviderPanelOpen(false);}}
          onKeyDown={(event)=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
            event.preventDefault();
            focusTaskCategory(movePdfTaskCategory(taskCategory,event.key as 'ArrowLeft'|'ArrowRight'|'Home'|'End'));
          }}
        >{PDF_TASK_CATEGORY_LABELS[category]}</button>)}
      </div>

      <div id={`${domIdPrefix}-task-tools`} className="pdf-context-toolbar" role="toolbar" aria-label={`${PDF_TASK_CATEGORY_LABELS[taskCategory]} PDF tools`}>
        <div className="pdf-task-actions">
          {primaryTaskActions.map((action)=><button
            key={action.id}
            disabled={!action.enabled}
            title={taskActionTitle(action)}
            aria-label={taskActionTitle(action)}
            onClick={()=>{void action.run();}}
          >{action.label}</button>)}
          {!activeTaskActions.length&&<span className="pdf-task-empty">No operational {PDF_TASK_CATEGORY_LABELS[taskCategory].toLowerCase()} commands are available in this build yet. Use Ctrl+K to discover available document actions.</span>}
          {overflowTaskActions.length>0&&<details className="pdf-task-overflow">
            <summary aria-label={`More ${PDF_TASK_CATEGORY_LABELS[taskCategory]} tools`}>More</summary>
            <div>
              {overflowTaskActions.map((action)=><button
                key={action.id}
                disabled={!action.enabled}
                title={taskActionTitle(action)}
                aria-label={taskActionTitle(action)}
                onClick={()=>{void action.run();}}
              >{action.label}</button>)}
            </div>
          </details>}
        </div>

        <div className="pdf-view-controls">
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
            <button className="pdf-zoom-label" disabled={!pdf} onClick={() => setFitMode((mode) => mode === 'width' ? 'page' : 'width')} aria-label={`Zoom mode: ${zoomLabel}`}>{zoomLabel}</button>
            <button disabled={!pdf} onClick={() => { setFitMode('custom'); setZoom((value) => stepPdfZoom(value, 1)); }} aria-label="Zoom in"><Plus size={16}/></button>
            <button disabled={!pdf} onClick={() => {setFitMode('custom');setZoom(1);}} aria-label="Actual size" title="Actual size">100%</button>
            <button disabled={!pdf} className={viewMode==='single'?'active':''} onClick={()=>setViewMode('single')} aria-label="Single page view" title="Single page">1</button>
            <button disabled={!pdf} className={viewMode==='continuous'?'active':''} onClick={()=>setViewMode('continuous')} aria-label="Continuous page view" title="Continuous">↕</button>
            <button disabled={!pdf} className={viewMode==='two'?'active':''} onClick={()=>setViewMode('two')} aria-label="Two-page view" title="Two page">2</button>
            <button disabled={!pdf} onClick={() => setRotation((value) => rotatePdfClockwise(value))} aria-label="Rotate view clockwise" title="Rotate view clockwise"><RotateCw size={16}/></button>
            <button disabled={!pdf} onClick={()=>void toggleFullscreen(false)} aria-label={fullscreen?'Exit full screen':'Full screen'} title={fullscreen?'Exit full screen':'Full screen'}><Maximize2 size={16}/></button>
            <button disabled={!pdf} onClick={()=>void toggleFullscreen(true)} aria-label="Presentation mode" title="Presentation mode"><MonitorPlay size={16}/></button>
            <button
              disabled={!pdf}
              onClick={()=>setInspectorHidden((value)=>!value)}
              aria-label={inspectorHidden?'Show right inspector':'Hide right inspector'}
              title={`${inspectorHidden?'Show':'Hide'} right inspector · ${DOCUMENT_INSPECTOR_SHORTCUT}`}
            >{inspectorHidden?<PanelRightOpen size={16}/>:<PanelRightClose size={16}/>}</button>
          </div>
        </div>
      </div>
    </div>


    {taskCategory==='convert'&&comparisonResult&&<section className="pdf-compare-panel" aria-label="PDF selectable-text comparison report">
      <header>
        <strong>PDF comparison — selectable text only</strong>
        <button onClick={()=>void exportComparisonReport()}>Export .txt report</button>
        <button onClick={()=>setComparisonResult(null)} aria-label="Dismiss comparison results">Close</button>
      </header>
      <p>{comparisonResult.baselineName} vs {comparisonResult.comparisonName}</p>
      <p>{comparisonResult.data.sameText} matching-text, {comparisonResult.data.changedText} changed-text, {comparisonResult.data.addedPages} added, {comparisonResult.data.removedPages} removed, {comparisonResult.data.unverifiable} unverifiable pages.</p>
      <small role="note">This compares only selectable text in the same page positions. Matching text does not prove the images, layout, formatting, signatures, or PDF bytes match.</small>
      <details>
        <summary>Inspect {comparisonResult.data.pages.length} page results</summary>
        <div className="pdf-compare-pages">
          {comparisonResult.data.pages.map(item=><article key={item.page}>
            <button disabled={item.page>pageCount} onClick={()=>goToPage(item.page)}>Page {item.page}</button>
            <strong>{item.result.replace(/-/g,' ')}</strong>
            {item.before&&<div><b>Original excerpt:</b> {item.before}</div>}
            {item.after&&<div><b>Comparison excerpt:</b> {item.after}</div>}
          </article>)}
        </div>
      </details>
    </section>}

    {providerPanelOpen&&providerCategory&&<PdfProviderToolsPanel
      provider={defaultPdfToolProvider}
      sourceBytes={sourceBytes}
      sourceName={sourceName}
      category={providerCategory}
      onApplyPdf={(label,bytes)=>mutateAction(label,async()=>bytes,currentPage)}
    />}

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

    {pdf && <div className={pdfLayoutClass}>
      <aside className={leftPanelCollapsed ? 'pdf-left-shell collapsed' : 'pdf-left-shell'} aria-label="PDF navigation rail and panel">
        <nav className="pdf-left-rail" aria-label="PDF navigation">
          {PDF_LEFT_PANEL_ITEMS.map((item)=><button
            key={item.id}
            className={leftPanel===item.id?'active':''}
            aria-pressed={leftPanel===item.id}
            aria-label={item.label}
            title={item.label}
            onClick={()=>{setLeftPanel(item.id);setLeftPanelCollapsed(false);}}
          ><PdfLeftPanelIcon id={item.id}/></button>)}
          <button
            className="pdf-left-collapse"
            aria-label={leftPanelCollapsed?'Expand PDF navigation panel':'Collapse PDF navigation panel'}
            title={leftPanelCollapsed?'Expand panel':'Collapse panel'}
            onClick={()=>setLeftPanelCollapsed((value)=>!value)}
          >{leftPanelCollapsed?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</button>
        </nav>

        {!leftPanelCollapsed&&<section className="pdf-left-panel" aria-label={`${pdfLeftPanelItem(leftPanel).label} panel`}>
          <div className="pdf-left-panel-title">
            <b>{pdfLeftPanelItem(leftPanel).label}</b>
            <span>{pdfLeftPanelItem(leftPanel).description}</span>
          </div>

          {leftPanel==='pages'&&<div className="pdf-left-panel-body pdf-pages-panel">
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
                  optionalContentConfig={currentLayers?.config}
                  layerRevision={layerRevision}
                  pageNumber={page}
                  logicalLabel={logicalPageLabels[page-1]}
                  active={page === currentPage}
                  selected={selectedPages.has(page)}
                  renderAllowed={thumbnailsRenderAllowed}
                  onSelect={selectThumbnail}
                  dragScope={domIdPrefix}
                  pageCount={pageCount}
                  reorderEnabled={!!sourceBytes&&!mutating&&!loading&&operationPages.length===1}
                  onReorder={(fromPage,toPage)=>{
                    if(!sourceBytes||mutating||loading||operationPages.length!==1)return;
                    void mutate('Moved page '+fromPage+' to position '+toPage+'.',bytes=>movePdfPage(bytes,fromPage,toPage),toPage);
                  }}
                />
              )}
            </div>
          </div>}

          {leftPanel==='search'&&<div className="pdf-left-panel-body">
            <div className="pdf-find">
              <div><Search size={14}/><input value={searchQuery} onChange={(event)=>setSearchQuery(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter')void searchPdf();}} placeholder="Search PDF text"/></div>
              <button disabled={searching||!searchQuery.trim()} onClick={()=>void searchPdf()}>{searching?'Searching…':'Find'}</button>
              {!!searchResults.length&&<div className="pdf-search-results">{searchResults.map((result)=><button key={result.page} onClick={()=>goToPage(result.page)}><b>Page {result.page}</b><span>{result.excerpt}</span></button>)}</div>}
            </div>
          </div>}

          {leftPanel==='comments'&&<div className="pdf-left-panel-body">
            <div className="pdf-edit-form">
              <label><MessageSquare size={13}/> Sticky-note comment<textarea value={commentDraft.text} onChange={(event)=>setCommentDraft({...commentDraft,text:event.target.value})} placeholder="Comment text"/></label>
              <label>Author<input value={commentDraft.author} onChange={(event)=>setCommentDraft({...commentDraft,author:event.target.value})}/></label>
              <div className="pdf-coordinate-grid">
                <label>X<input type="number" min="0" max="1" step="0.01" value={commentDraft.x} onChange={(event)=>setCommentDraft({...commentDraft,x:Number(event.target.value)})}/></label>
                <label>Y<input type="number" min="0" max="1" step="0.01" value={commentDraft.y} onChange={(event)=>setCommentDraft({...commentDraft,y:Number(event.target.value)})}/></label>
              </div>
              <button disabled={mutating||!sourceBytes||!commentDraft.text.trim()} onClick={()=>void addComment()}>Add PDF comment</button>
              <small>Creates a PDF /Text annotation. Review changes participate in Undo/Redo.</small>
            </div>
            <div className="pdf-edit-form">
              <b>Markup a page region</b>
              <label>Type<select value={markupDraft.kind} onChange={(event)=>setMarkupDraft({...markupDraft,kind:event.target.value as PdfRegionMarkup['kind']})}>
                <option value="Highlight">Highlight</option>
                <option value="Underline">Underline</option>
                <option value="StrikeOut">Strikeout</option>
              </select></label>
              <div className="pdf-coordinate-grid">
                {(['x','y','width','height'] as const).map(key=><label key={key}>{key}<input type="number" min="0" max="1" step="0.01" value={markupDraft[key]} onChange={(event)=>setMarkupDraft({...markupDraft,[key]:Number(event.target.value)})}/></label>)}
              </div>
              <button disabled={mutating||!sourceBytes} onClick={()=>void addReviewMarkup()}>Add {markupDraft.kind} annotation</button>
              <small>Coordinates represent a rectangular region, not a verified text selection. Uses standard PDF markup QuadPoints.</small>
            </div>
            <div className="pdf-edit-form">
              <b>Review annotations ({reviewAnnotations.length})</b>
              {reviewLoading&&<small role="status">Reading PDF review annotations…</small>}
              {reviewFailure&&<small role="alert">{reviewFailure}</small>}
              {!reviewLoading&&!reviewFailure&&reviewAnnotations.length===0&&<small>No review annotations in the loaded PDF.</small>}
              {reviewAnnotations.map(item=><div key={item.pageNumber+'-'+item.index+'-'+item.ref} className="pdf-left-info">
                <b>{item.replyToRef?'Reply · ':''}{item.kind} · Page {item.pageNumber}{item.resolved?' · Completed':''}</b>
                {item.replyToRef&&<small>In reply to annotation {item.replyToRef}</small>}
                <div>{item.author||'Unknown author'}</div>
                <p>{item.text||'(No comment text)'}</p>
                <button onClick={()=>goToPage(item.pageNumber)}>Go to page</button>
                {item.ref&&<div>
                  <button disabled={mutating} onClick={()=>setReviewEdit({item,text:item.text})}>Edit text</button>
                  <button disabled={mutating} onClick={()=>setReviewReply({parent:item,text:''})}>Reply</button>
                  <button disabled={mutating} onClick={()=>void toggleReviewResolved(item)}>{item.resolved?'Reopen':'Complete'}</button>
                  <button disabled={mutating} onClick={()=>void removeReviewItem(item)}>Delete</button>
                </div>}
                {reviewReply?.parent.ref===item.ref&&reviewReply.parent.index===item.index&&reviewReply.parent.pageNumber===item.pageNumber&&<div>
                  <label>Reply to {item.author||'reviewer'}<textarea maxLength={4000} value={reviewReply.text} onChange={event=>setReviewReply({...reviewReply,text:event.target.value})}/></label>
                  <button disabled={mutating||!reviewReply.text.trim()} onClick={()=>void sendReviewReply()}>Post reply</button>
                  <button onClick={()=>setReviewReply(null)}>Cancel</button>
                </div>}
                {reviewEdit?.item.ref===item.ref&&reviewEdit.item.index===item.index&&reviewEdit.item.pageNumber===item.pageNumber&&<div>
                  <label>Edit annotation<textarea value={reviewEdit.text} onChange={(event)=>setReviewEdit({...reviewEdit,text:event.target.value})} maxLength={4000}/></label>
                  <button disabled={mutating||!reviewEdit.text.trim()} onClick={()=>void saveReviewText()}>Save text</button>
                  <button onClick={()=>setReviewEdit(null)}>Cancel</button>
                </div>}
                {!item.ref&&<small>This imported annotation has no indirect reference and is read-only.</small>}
              </div>)}
            </div>
          </div>}

          {leftPanel==='attachments'&&<div className="pdf-left-panel-body">
            <div className="pdf-edit-form">
              <button disabled={mutating} onClick={()=>attachmentInputRef.current?.click()}><Paperclip size={13}/> Embed file attachment…</button>
              <small>Extracted files are untrusted. MALENJO never previews or executes them. Unsafe extensions are saved as .bin.</small>
              {navigatorLoading&&<span role="status">Discovering attachments…</span>}
              {attachmentError&&<span role="alert">{attachmentError}</span>}
              {!navigatorLoading&&!pdfAttachments.entries.length&&<span>No embedded attachments found.</span>}
              {pdfAttachments.entries.map(entry=><div className="pdf-left-info" key={entry.id}>
                <strong>{entry.name}</strong><span> · {entry.sizeBytes===null?'Size unavailable':formatBytes(entry.sizeBytes)}</span>
                <div><button disabled={!entry.downloadable||mutating||extractingAttachment} title={entry.reason||'Download without opening'} onClick={()=>void extractAttachment(entry)}>{extractingAttachment?'Extracting…':'Extract file'}</button></div>
                {entry.reason&&<small>{entry.reason}</small>}
              </div>)}
              {pdfAttachments.truncated&&<small>Attachment inventory is limited to 200 entries.</small>}
            </div>
          </div>}

          {leftPanel==='signatures'&&<div className="pdf-left-panel-body">
            <div className="pdf-feature-list">
              <b>{formFields.filter((field)=>field.type==='signature').length} signature field{formFields.filter((field)=>field.type==='signature').length===1?'':'s'}</b>
              {formFields.filter((field)=>field.type==='signature').slice(0,24).map((field)=><span key={field.name}><strong>{field.name}</strong><em>{field.readOnly?'read-only':'interactive'}</em></span>)}
              {!formFields.some((field)=>field.type==='signature')&&<span>No AcroForm signature fields detected in the current working copy.</span>}
            </div>
            <div className="pdf-left-info">Cryptographic validation and signed-copy workflows remain in MALENJO Sign. This panel only reports signature fields already present in the PDF.</div>
          </div>}

          {leftPanel==='bookmarks'&&<div className="pdf-left-panel-body">
            <div className="pdf-edit-form">
              {navigatorLoading&&<span role="status">Reading document bookmarks…</span>}
              {bookmarkError&&<span role="alert">{bookmarkError}</span>}
              {!navigatorLoading&&!pdfOutline.entries.length&&<span>No PDF outline/bookmarks found.</span>}
              {pdfOutline.entries.map(entry=><button
                key={entry.id}
                style={{paddingLeft:8+entry.depth*12,textAlign:'left'}}
                title={entry.url?'External document link — not opened automatically':entry.title}
                onClick={()=>void openBookmark(entry)}
              >{entry.title}{entry.url?' (external)':''}</button>)}
              {pdfOutline.truncated&&<small>Bookmark display capped at 1,000 entries.</small>}
              <div className="pdf-edit-form">
                <b>Bookmark current page {currentPage}</b>
                <label>Title<input maxLength={200} value={bookmarkTitle} placeholder="Chapter title" onChange={(event)=>setBookmarkTitle(event.target.value)}/></label>
                <button disabled={!sourceBytes||mutating||!bookmarkTitle.trim()} onClick={()=>void addCurrentPageBookmark()}>Add top-level bookmark</button>
                {bookmarkEditError&&<small role="alert">{bookmarkEditError}</small>}
                <b>Manage top-level bookmarks</b>
                {editableBookmarks.map(item=><div className="pdf-left-info" key={item.ref}>
                  <strong>{item.title}</strong>
                  {item.editable
                    ? <div>
                        <button disabled={mutating} onClick={()=>setBookmarkEdit({ref:item.ref,title:item.title})}>Rename</button>
                        <button disabled={mutating} onClick={()=>void deleteCurrentBookmark(item)}>Delete</button>
                      </div>
                    : <small>Contains nested bookmarks; editing is disabled to protect the subtree.</small>}
                  {bookmarkEdit?.ref===item.ref&&<div>
                    <label>New title<input maxLength={200} value={bookmarkEdit.title} onChange={(event)=>setBookmarkEdit({...bookmarkEdit,title:event.target.value})}/></label>
                    <button disabled={mutating||!bookmarkEdit.title.trim()} onClick={()=>void renameCurrentBookmark()}>Save title</button>
                    <button onClick={()=>setBookmarkEdit(null)}>Cancel</button>
                  </div>}
                </div>)}
                <small>Only top-level leaf bookmarks can be renamed or deleted safely. Existing nested outline trees are preserved.</small>
              </div>
            </div>
          </div>}
          {leftPanel==='layers'&&<div className="pdf-left-panel-body">
            <div className="pdf-edit-form">
              <b>PDF optional-content groups</b>
              {layersLoading&&<small role="status">Reading PDF layers…</small>}
              {layersError&&<small role="alert">{layersError}</small>}
              {!layersLoading&&!layersError&&!currentLayers?.current.length&&<small>This PDF has no selectable optional-content groups.</small>}
              {currentLayers?.current.map(group=><label key={group.id} className="pdf-layer-visibility">
                <input type="checkbox" checked={group.visible} disabled={mutating||loading} onChange={event=>changeLayerVisibility(group.id,event.target.checked)}/>
                {group.name}
              </label>)}
              <button disabled={!currentLayers?.current.length||mutating||loading} onClick={resetLayerVisibility}>Restore original visibility</button>
              <small>These switches control the local preview and thumbnails only. Export retains the original PDF layer visibility settings; changing layers here does not flatten or rewrite objects.</small>
            </div>
          </div>}
        </section>}
      </aside>

      <div ref={scrollRef} className="pdf-scroll">
        <div className={`pdf-stage ${viewMode}`}>
          {viewPages.map((page) => {
            const schedule = pdfPageSchedule(page, currentPage, pageCount, renderedPages);
            return <PdfPageCanvas
              key={page}
              document={pdf.document}
              optionalContentConfig={currentLayers?.config}
              layerRevision={layerRevision}
              pageNumber={page}
              fitMode={fitMode}
              zoom={zoom}
              rotation={rotation}
              availableWidth={viewport.width}
              availableHeight={viewport.height}
              forceRender={forceRenderAll}
              renderAllowed={forceRenderAll || schedule.allowed}
              eager={forceRenderAll || schedule.eager}
              domIdPrefix={domIdPrefix}
              onVisible={onPageVisible}
              onRendered={onPageRendered}
            />;
          })}
        </div>
      </div>

      {!inspectorHidden&&<aside className="pdf-inspector" aria-label="Contextual document inspector">
        <div className="pdf-inspector-tabs" role="tablist" aria-label="Document inspector">
          {DOCUMENT_INSPECTOR_TABS.map((tab)=><button
            key={tab}
            role="tab"
            aria-selected={inspectorTab===tab}
            className={inspectorTab===tab?'active':''}
            onClick={()=>setInspectorTab(tab)}
            title={DOCUMENT_INSPECTOR_LABELS[tab]}
          >{DOCUMENT_INSPECTOR_LABELS[tab]}</button>)}
          <button
            className="pdf-inspector-hide"
            aria-label="Hide right inspector"
            title={`Hide inspector · ${DOCUMENT_INSPECTOR_SHORTCUT}`}
            onClick={()=>setInspectorHidden(true)}
          ><PanelRightClose size={14}/></button>
        </div>

        {inspectorTab==='properties'&&<>
        <div className="pdf-inspector-context"><b>Page {currentPage}</b><span>{selectedPageNumbers.length} selected · {dirty?'modified':'original'}</span></div>
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

        <div className="pdf-pane-title">Forms</div>
        <div className="pdf-edit-form">
          <label><ListChecks size={13}/> Field type
            <select value={formDraft.type} onChange={(event)=>setFormDraft({...formDraft,type:event.target.value as typeof formDraft.type})}>
              <option value="text">Text field</option>
              <option value="checkbox">Checkbox</option>
              <option value="radio">Radio group</option>
              <option value="dropdown">Dropdown</option>
              <option value="list">Option list</option>
            </select>
          </label>
          <label>Name<input value={formDraft.name} onChange={(event)=>setFormDraft({...formDraft,name:event.target.value})} placeholder="field_name"/></label>

          {formDraft.type==='text'&&<label>Default value<input value={formDraft.defaultValue} onChange={(event)=>setFormDraft({...formDraft,defaultValue:event.target.value})}/></label>}

          {['radio','dropdown','list'].includes(formDraft.type)&&<>
            <label>Options<textarea value={formDraft.optionsText} onChange={(event)=>setFormDraft({...formDraft,optionsText:event.target.value})} placeholder={'One option per line\nOption A\nOption B'}/></label>
            <label>{formDraft.type==='radio'?'Selected option':'Selected value(s)'}<textarea value={formDraft.selectedText} onChange={(event)=>setFormDraft({...formDraft,selectedText:event.target.value})} placeholder={formDraft.multiselect?'One selection per line':'Optional default selection'}/></label>
          </>}

          <div className="pdf-field-flags">
            <label><input type="checkbox" checked={formDraft.required} onChange={(event)=>setFormDraft({...formDraft,required:event.target.checked})}/> Required</label>
            <label><input type="checkbox" checked={formDraft.readOnly} onChange={(event)=>setFormDraft({...formDraft,readOnly:event.target.checked})}/> Read-only</label>
            {(formDraft.type==='dropdown'||formDraft.type==='list')&&<label><input type="checkbox" checked={formDraft.multiselect} onChange={(event)=>setFormDraft({...formDraft,multiselect:event.target.checked})}/> Multi-select</label>}
          </div>

          <div className="pdf-coordinate-grid">
            <label>X<input type="number" min="0" max="1" step="0.01" value={formDraft.x} onChange={(event)=>setFormDraft({...formDraft,x:Number(event.target.value)})}/></label>
            <label>Y<input type="number" min="0" max="1" step="0.01" value={formDraft.y} onChange={(event)=>setFormDraft({...formDraft,y:Number(event.target.value)})}/></label>
            {(formDraft.type==='checkbox'||formDraft.type==='radio')
              ? <label>Size<input type="number" min="0.01" max="0.25" step="0.01" value={formDraft.size} onChange={(event)=>setFormDraft({...formDraft,size:Number(event.target.value)})}/></label>
              : <>
                  <label>W<input type="number" min="0.01" max="1" step="0.01" value={formDraft.width} onChange={(event)=>setFormDraft({...formDraft,width:Number(event.target.value)})}/></label>
                  <label>H<input type="number" min="0.01" max="1" step="0.01" value={formDraft.height} onChange={(event)=>setFormDraft({...formDraft,height:Number(event.target.value)})}/></label>
                </>}
            {formDraft.type==='radio'&&<label>Gap<input type="number" min="0.01" max="0.3" step="0.01" value={formDraft.gap} onChange={(event)=>setFormDraft({...formDraft,gap:Number(event.target.value)})}/></label>}
          </div>

          <button disabled={mutating} onClick={()=>void addFormField()}>Add {formDraft.type} field</button>

          <div className="pdf-feature-list pdf-form-inventory">
            <b>{formFields.length} AcroForm field{formFields.length===1?'':'s'}</b>
            {formFields.map((field)=><span key={field.name} title={field.options.length?field.options.join(', '):undefined}>
              <strong>{field.name}</strong>
              <em>{field.type}{field.required?' · required':''}{field.readOnly?' · read-only':''}{field.password?' · password':''}{field.multiline?' · multiline':''}{field.richText?' · rich-text unsupported':''}{field.multiselect?' · multiselect':''}{field.editable?' · editable':''}{field.duplicateChoiceExports?' · duplicate exports unsupported':''}{field.type==='radio'&&!field.offToggleable?' · cannot clear':''}{field.type==='text'&&!field.password&&!field.richText&&field.value?` · value: ${field.value}`:''}{field.type==='checkbox'?` · ${field.checked?'checked':'unchecked'}`:''}{field.selected.length?` · selected: ${field.selected.map((value)=>field.choiceOptions.find((option)=>option.value===value)?.label??value).join(', ')}`:''}</em>
            </span>)}
          </div>

          {formFields.map((field)=>{
            const draft=formFillDraft[field.name];
            const disabled=mutating||field.readOnly;
            if(field.duplicateChoiceExports){
              return <small key={`fill-${field.name}`}>
                <b>{field.name}</b> contains duplicate choice export values; MALENJO inspects it but does not modify an ambiguous option mapping.
              </small>;
            }
            if(field.type==='checkbox'){
              return <label key={`fill-${field.name}`}><input
                type="checkbox"
                checked={Boolean(draft)}
                disabled={disabled}
                onChange={(event)=>setFormFillValue(field.name,event.target.checked)}
              /> {field.name}{field.readOnly?' · read-only':''}</label>;
            }
            if(field.type==='dropdown'&&field.editable){
              const selected=Array.isArray(draft)?draft:[];
              if(field.multiselect){
                return <small key={`fill-${field.name}`}>
                  <b>{field.name}</b> combines editable and multiselect flags; MALENJO inspects it but does not modify that unsafe combination.
                </small>;
              }
              const selectedIndex=selected.length
                ? field.choiceOptions.findIndex((option)=>option.value===selected[0])
                : -1;
              const hasCustomValue=selected.length>0&&selectedIndex<0;
              const selectedToken=selectedIndex>=0?`option-${selectedIndex}`:hasCustomValue?'custom':'clear';
              return <label key={`fill-${field.name}`}>{field.name}
                <select
                  value={selectedToken}
                  disabled={disabled}
                  onChange={(event)=>{
                    if(event.target.value==='clear'){
                      setFormFillValue(field.name,[]);
                      return;
                    }
                    if(event.target.value==='custom'){
                      if(!hasCustomValue)setFormFillValue(field.name,['']);
                      return;
                    }
                    const optionIndex=Number(event.target.value.replace(/^option-/,''));
                    const option=field.choiceOptions[optionIndex];
                    if(option)setFormFillValue(field.name,[option.value]);
                  }}
                >
                  <option value="clear">— Clear —</option>
                  {field.choiceOptions.map((option,index)=><option key={`${index}-${option.value}`} value={`option-${index}`}>{option.label}</option>)}
                  <option value="custom">— Custom value —</option>
                </select>
                {selectedToken==='custom'&&<input
                  value={hasCustomValue?selected[0]:''}
                  disabled={disabled}
                  placeholder="Custom value"
                  onChange={(event)=>setFormFillValue(field.name,[event.target.value])}
                />}
              </label>;
            }
            if(field.type==='radio'||((field.type==='dropdown'||field.type==='list')&&!field.multiselect)){
              const selectedValues=Array.isArray(draft)?draft:[];
              const selectedIndex=selectedValues.length
                ? field.choiceOptions.findIndex((option)=>option.value===selectedValues[0])
                : -1;
              const selectedToken=selectedIndex>=0?`option-${selectedIndex}`:'placeholder';
              const canClear=field.type!=='radio'||field.offToggleable;
              return <label key={`fill-${field.name}`}>{field.name}
                <select
                  value={selectedToken}
                  disabled={disabled}
                  onChange={(event)=>{
                    if(event.target.value==='clear'){
                      setFormFillValue(field.name,[]);
                      return;
                    }
                    if(event.target.value==='placeholder')return;
                    const optionIndex=Number(event.target.value.replace(/^option-/,''));
                    const option=field.choiceOptions[optionIndex];
                    if(option)setFormFillValue(field.name,[option.value]);
                  }}
                >
                  {selectedIndex<0&&!canClear&&<option value="placeholder" disabled>— No selection —</option>}
                  {canClear&&<option value="clear">— Clear —</option>}
                  {field.choiceOptions.map((option,index)=><option key={`${index}-${option.value}`} value={`option-${index}`}>{option.label}</option>)}
                </select>
              </label>;
            }
            if((field.type==='dropdown'||field.type==='list')&&field.multiselect){
              const selected=Array.isArray(draft)?draft:[];
              return <label key={`fill-${field.name}`}>{field.name}
                <select
                  multiple
                  value={selected}
                  disabled={disabled}
                  onChange={(event)=>setFormFillValue(
                    field.name,
                    Array.from(event.target.selectedOptions).map((option)=>option.value),
                  )}
                >
                  {field.choiceOptions.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>;
            }
            if(field.type==='text'){
              if(field.richText){
                return <small key={`fill-${field.name}`}><b>{field.name}</b> uses rich-text formatting that this editor does not modify.</small>;
              }
              if(field.password){
                return <label key={`fill-${field.name}`}>{field.name}
                  <input
                    type="password"
                    value={typeof draft==='string'?draft:''}
                    placeholder="Enter a replacement value to change this password field"
                    disabled={disabled}
                    autoComplete="new-password"
                    onChange={(event)=>setFormFillValue(
                      field.name,
                      event.target.value.length?event.target.value:undefined,
                    )}
                  />
                </label>;
              }
              if(field.multiline){
                return <label key={`fill-${field.name}`}>{field.name}
                  <textarea
                    value={typeof draft==='string'?draft:''}
                    disabled={disabled}
                    onChange={(event)=>setFormFillValue(field.name,event.target.value)}
                  />
                </label>;
              }
              return <label key={`fill-${field.name}`}>{field.name}
                <input
                  type="text"
                  value={typeof draft==='string'?draft:''}
                  disabled={disabled}
                  onChange={(event)=>setFormFillValue(field.name,event.target.value)}
                />
              </label>;
            }
            return <small key={`fill-${field.name}`}><b>{field.name}</b> ({field.type}) is detected but is not directly fillable in this pass.</small>;
          })}
          <button disabled={mutating||!fillableFormFields.length} onClick={()=>void fillForm()}><ListChecks size={13}/> Apply form values</button>
          <button disabled={mutating||!formFields.length} onClick={()=>void flattenForm()}><FileCheck2 size={13}/> Flatten form fields</button>
          <small>Text, checkbox, radio, dropdown and option-list values are edited in the MALENJO working copy with Undo/Redo. Required/read-only flags remain enforced. Flattening paints appearances and removes interactivity; Undo remains available until export/close.</small>
        </div>

        <div className="pdf-pane-title">Headers / footers</div>
        <div className="pdf-edit-form">
          <label>Scope<select value={headerFooterDraft.scope} onChange={(event)=>setHeaderFooterDraft({...headerFooterDraft,scope:event.target.value as 'selected'|'all'})}><option value="selected">Selected pages</option><option value="all">All pages</option></select></label>
          <label>Header<input value={headerFooterDraft.header} onChange={(event)=>setHeaderFooterDraft({...headerFooterDraft,header:event.target.value})} placeholder="Optional header · {page} {pages} {date}"/></label>
          <label>Footer<input value={headerFooterDraft.footer} onChange={(event)=>setHeaderFooterDraft({...headerFooterDraft,footer:event.target.value})} placeholder="Page {page} of {pages}"/></label>
          <div className="pdf-coordinate-grid">
            <label>Pt<input type="number" min="4" max="72" step="1" value={headerFooterDraft.fontSize} onChange={(event)=>setHeaderFooterDraft({...headerFooterDraft,fontSize:Number(event.target.value)})}/></label>
            <label>Margin<input type="number" min="0" max="180" step="1" value={headerFooterDraft.margin} onChange={(event)=>setHeaderFooterDraft({...headerFooterDraft,margin:Number(event.target.value)})}/></label>
          </div>
          <label>Header align<select value={headerFooterDraft.headerAlign} onChange={(event)=>setHeaderFooterDraft({...headerFooterDraft,headerAlign:event.target.value as 'left'|'center'|'right'})}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
          <label>Footer align<select value={headerFooterDraft.footerAlign} onChange={(event)=>setHeaderFooterDraft({...headerFooterDraft,footerAlign:event.target.value as 'left'|'center'|'right'})}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
          <button disabled={mutating||!(headerFooterDraft.header.trim()||headerFooterDraft.footer.trim())} onClick={()=>void applyHeaderFooter()}>Apply header / footer</button>
          <small>Supported tokens: <code>{'{page}'}</code>, <code>{'{pages}'}</code>, <code>{'{date}'}</code>. This writes permanent PDF text and is tracked in Undo/Redo.</small>
        </div>

        <div className="pdf-pane-title">Bates numbering</div>
        <div className="pdf-edit-form">
          <label>Scope<select value={batesDraft.scope} onChange={(event)=>setBatesDraft({...batesDraft,scope:event.target.value as 'selected'|'all'})}><option value="selected">Selected pages</option><option value="all">All pages</option></select></label>
          <div className="pdf-coordinate-grid">
            <label>Prefix<input value={batesDraft.prefix} onChange={(event)=>setBatesDraft({...batesDraft,prefix:event.target.value})}/></label>
            <label>Start<input type="number" min="0" max="999999999" step="1" value={batesDraft.startNumber} onChange={(event)=>setBatesDraft({...batesDraft,startNumber:Number(event.target.value)})}/></label>
            <label>Digits<input type="number" min="1" max="12" step="1" value={batesDraft.digits} onChange={(event)=>setBatesDraft({...batesDraft,digits:Number(event.target.value)})}/></label>
          </div>
          <label>Suffix<input value={batesDraft.suffix} onChange={(event)=>setBatesDraft({...batesDraft,suffix:event.target.value})}/></label>
          <label>Position<select value={batesDraft.position} onChange={(event)=>setBatesDraft({...batesDraft,position:event.target.value as typeof batesDraft.position})}>
            <option value="top-left">Top left</option><option value="top-center">Top center</option><option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option><option value="bottom-center">Bottom center</option><option value="bottom-right">Bottom right</option>
          </select></label>
          <div className="pdf-coordinate-grid">
            <label>Pt<input type="number" min="4" max="72" step="1" value={batesDraft.fontSize} onChange={(event)=>setBatesDraft({...batesDraft,fontSize:Number(event.target.value)})}/></label>
            <label>Margin<input type="number" min="0" max="180" step="1" value={batesDraft.margin} onChange={(event)=>setBatesDraft({...batesDraft,margin:Number(event.target.value)})}/></label>
          </div>
          <button disabled={mutating} onClick={()=>void applyBates()}>Apply Bates numbers</button>
          <small>Preview: <code>{batesDraft.prefix}{String(batesDraft.startNumber).padStart(Math.max(1,batesDraft.digits),'0')}{batesDraft.suffix}</code>. Numbering follows selected-page order when scope is Selected pages.</small>
        </div>

        <div className="pdf-pane-title">Page boxes</div>
        <div className="pdf-edit-form">
          <label>Scope<select value={pageBoxDraft.scope} onChange={(event)=>setPageBoxDraft({...pageBoxDraft,scope:event.target.value as 'selected'|'all'})}><option value="selected">Selected pages</option><option value="all">All pages</option></select></label>
          <label>Box<select value={pageBoxDraft.box} onChange={(event)=>setPageBoxDraft({...pageBoxDraft,box:event.target.value as 'crop'|'trim'|'bleed'|'art'})}><option value="crop">Crop box</option><option value="trim">Trim box</option><option value="bleed">Bleed box</option><option value="art">Art box</option></select></label>
          <div className="pdf-coordinate-grid">
            <label>Top<input type="number" min="0" max="720" step="1" value={pageBoxDraft.top} onChange={(event)=>setPageBoxDraft({...pageBoxDraft,top:Number(event.target.value)})}/></label>
            <label>Right<input type="number" min="0" max="720" step="1" value={pageBoxDraft.right} onChange={(event)=>setPageBoxDraft({...pageBoxDraft,right:Number(event.target.value)})}/></label>
            <label>Bottom<input type="number" min="0" max="720" step="1" value={pageBoxDraft.bottom} onChange={(event)=>setPageBoxDraft({...pageBoxDraft,bottom:Number(event.target.value)})}/></label>
            <label>Left<input type="number" min="0" max="720" step="1" value={pageBoxDraft.left} onChange={(event)=>setPageBoxDraft({...pageBoxDraft,left:Number(event.target.value)})}/></label>
          </div>
          <button disabled={mutating} onClick={()=>void applyPageBox()}>Apply page box</button>
          <small>Margins are points inset from each page’s MediaBox. Invalid/inverted boxes are rejected; the operation is undoable before export.</small>
        </div>

        <div className="pdf-pane-title">Logical page labels</div>
        <div className="pdf-edit-form">
          <small>Page labels change the numbering readers display, not the physical page order. A new range starts at current page {currentPage}.</small>
          <label>Numbering style<select value={pageLabelDraft.style} onChange={(event)=>setPageLabelDraft({...pageLabelDraft,style:event.target.value as PdfPageLabelRange['style']})}>
            <option value="D">Decimal (1, 2, 3)</option>
            <option value="r">Lowercase Roman (i, ii, iii)</option>
            <option value="R">Uppercase Roman (I, II, III)</option>
            <option value="a">Lowercase letters (a, b, c)</option>
            <option value="A">Uppercase letters (A, B, C)</option>
            <option value="none">Prefix only</option>
          </select></label>
          <label>Prefix<input maxLength={80} value={pageLabelDraft.prefix} onChange={(event)=>setPageLabelDraft({...pageLabelDraft,prefix:event.target.value})}/></label>
          <label>Starting number<input type="number" min="1" max="1000000000" step="1" value={pageLabelDraft.startNumber} onChange={(event)=>setPageLabelDraft({...pageLabelDraft,startNumber:Number(event.target.value)})}/></label>
          <button disabled={!sourceBytes||mutating} onClick={()=>void applyPageLabel()}>Set label at page {currentPage}</button>
          <button disabled={!sourceBytes||mutating||!pageLabelRanges.length} onClick={()=>void clearAllPageLabels()}>Clear all page labels</button>
          {pageLabelError&&<small role="alert">{pageLabelError}</small>}
          <b>Configured ranges ({pageLabelRanges.length})</b>
          {pageLabelRanges.map(range=><small key={range.startPage}>Page {range.startPage}: {range.prefix||'(no prefix)'} · {range.style==='none'?'prefix only':range.style} from {range.startNumber}</small>)}
          <small>Existing nested /Kids number trees are preserved but require a more advanced editor.</small>
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
        </>}

        {inspectorTab==='ai'&&<div className="pdf-inspector-tab-body">
          <div className="pdf-inspector-callout">
            <Sparkles size={18}/>
            <b>Malenjo AI</b>
            <p>The current PDF remains open in its tab. Open the local AI workspace to choose this document as a source and use the existing grounded/citation workflow.</p>
            <button onClick={()=>onNavigateModule?.('ai')} disabled={!onNavigateModule}>Open Malenjo AI</button>
          </div>
        </div>}

        {inspectorTab==='security'&&<div className="pdf-inspector-tab-body">
          <div className="pdf-inspector-callout">
            <ShieldCheck size={18}/>
            <b>Security</b>
            <p>PDF JavaScript execution is disabled here. Sanitization, CDR/redaction, watermark, encryption and malware workflows remain in Security Center.</p>
            <button onClick={()=>onNavigateModule?.('security')} disabled={!onNavigateModule}>Open Security Center</button>
          </div>
        </div>}

        {inspectorTab==='comments'&&<div className="pdf-inspector-tab-body">
          <div className="pdf-inspector-callout">
            <MessageSquare size={18}/>
            <b>Comments</b>
            <p>Comment authoring is already operational in the PDF left navigation and writes real /Text annotations.</p>
            <button onClick={()=>{setLeftPanel('comments');setLeftPanelCollapsed(false);}}>Open Comments panel</button>
          </div>
        </div>}

        {inspectorTab==='sign'&&<div className="pdf-inspector-tab-body">
          <div className="pdf-inspector-callout">
            <FileCheck2 size={18}/>
            <b>Sign</b>
            <p>{formFields.filter((field)=>field.type==='signature').length} signature field(s) detected in the current working copy. Cryptographic validation and signed-copy operations use MALENJO Sign.</p>
            <button onClick={()=>onNavigateModule?.('sign')} disabled={!onNavigateModule}>Open Sign workspace</button>
          </div>
        </div>}
      </aside>}
    </div>}
  </div>;
}
