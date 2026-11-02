import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
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
  Download, Printer, FilePenLine, Scissors, FilePlus2, ScanText,
  Sparkles,
  ShieldCheck,
  Maximize2,
  MonitorPlay,
  Lock,
} from 'lucide-react';
import type { DocumentSession } from '../files/session';
import type { RegisterDocumentCommands } from '../commands/types';
import { isDesktopRuntime } from '../files/api';
import { exportPdfBytes, exportPdfPlainText, exportPdfEmbeddedAttachment, exportPdfPageImagesZip, readPdfDocumentBytes } from './api';
import { exportPdfPagesAsJpegZip, exportPdfPagesAsPngZip } from './pageImageExport';
import {finishPdfInstallCommit} from './pdfInstallCommit';
import {
  comparePdfSelectableText, formatPdfTextComparison, type PdfTextComparison,
} from './textCompare';
import {
  flattenPdfOutline, normalizePdfAttachments, resolvePdfOutlinePage, readPdfAttachmentBytes,
  type PdfOutlineModel, type PdfOutlineEntry, type PdfAttachmentModel, type PdfAttachmentEntry,
} from './navigation';
import { extractPdfDocumentText } from './textExport';
import {
  addPdfLinkAnnotation,deletePdfLinkAnnotation,listPdfLinkAnnotations,
  updatePdfLinkAnnotation,type PdfLinkAnnotation,type PdfLinkTarget,
} from './links';
import {deletePdfExistingFormField,updatePdfExistingFieldProperties} from './formManagement';
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
  replacePdfPage,
  setPdfPageBox,
  inspectPdfVisualCropPage,
  splitPdfAtPage,
  fillPdfFormFields,
  flattenPdfForm,
  inspectPdfFormFields,
  type PdfFormFieldInfo,
  type PdfFormFieldUpdate,
} from './editor';
import { disposePdf, loadPdfBytes, PdfPasswordRequiredError, type PdfLoadResult } from './engine';
import { describePdfError, ENCRYPTED_EDIT_MESSAGE, looksEncryptedPdf } from './pdfUserErrors';
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
  clampPdfZoom,
  displayPdfRotation,
  effectivePdfScale,
  parsePdfPageDraft,
  stepPdfZoom,
  type PdfFitMode,
} from './layout';
import PdfPageCanvas from './PdfPageCanvas';
import {cropMarginsToRectangle,cropPointsToUnit,cropRectangleToMargins,cropUnitToPoints,
  type CropUnit,type CropRectangle} from './cropGeometry';
import { PdfFeatureIcon } from './PdfFeatureIcon';
import { plannedPdfFeatures } from './featureCatalog';
import { USER_PDF_TOOLS, USER_PDF_TOOL_GROUPS } from './userPdfTools';
import {extractPdfPageSearchText,findPdfTextMatches} from './pdfTextHighlights';
import PdfThumbnail from './PdfThumbnail';
import PdfProviderToolsPanel from './PdfProviderToolsPanel';
import { defaultPdfToolProvider } from './defaultProvider';
import { ensurePdfProviderRunning } from './providerLifecycle';
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
  PDF_TASK_CATEGORY_LABELS,
  type PdfTaskCategory,
} from './taskToolbar';
import {
  PDF_MASTER_TABS, moveMasterPdfTab, masterPdfTabFromShortcut, masterTabForCategory,
  type PdfMasterTab,
} from './masterRibbonTabs';
import { PDF_COMMANDS } from '../commands/masterCatalog';
import type { ModuleId } from '../core/types';

interface Props {
  session: DocumentSession | null;
  active: boolean;
  notice: string;
  onBackToFiles(): void;
  onOpenBrowserPdf?(file:File):void;
  onNavigateModule?(id:ModuleId): void;
  onDirtyChange?(dirty:boolean): void;
  onSavingChange?(saving:boolean): void;
  /** Read-only, real renderer state for the compact application status bar. */
  onViewStatusChange?(status:{page:number;pageCount:number;zoom:string}):void;
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
  planned?:boolean;
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

function PdfMinimalCommandIcon({label}: {label:string}) {
  const value=label.toLowerCase();
  if (/print/.test(value)) return <Printer size={18} aria-hidden="true"/>;
  if (/export|save|download|extract/.test(value)) return <Download size={18} aria-hidden="true"/>;
  if (/scan|ocr|recognize/.test(value)) return <ScanText size={18} aria-hidden="true"/>;
  if (/delete|split|cut|crop/.test(value)) return <Scissors size={18} aria-hidden="true"/>;
  if (/insert|add|append|create/.test(value)) return <FilePlus2 size={18} aria-hidden="true"/>;
  if (/text|edit|highlight|comment|mark/.test(value)) return <FilePenLine size={18} aria-hidden="true"/>;
  return <FileText size={18} aria-hidden="true"/>;
}

export default function PdfWorkspace({ session, active, notice, onBackToFiles, onOpenBrowserPdf, onNavigateModule, onDirtyChange, onSavingChange, onViewStatusChange, registerCommands }: Props) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef=useRef<HTMLInputElement>(null);
  const searchSequenceRef=useRef(0);
  const imagesInputRef = useRef<HTMLInputElement>(null);
  const comparisonInputRef = useRef<HTMLInputElement>(null);
  const appendInputRef = useRef<HTMLInputElement>(null);
  const insertInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  // File-picker callbacks must edit the page clicked when the picker opened,
  // not whichever page becomes visible while the user chooses a PDF.
  const replaceTargetPageRef=useRef<number|null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  // Ignore out-of-order IntersectionObserver callbacks during explicit jumps.
  // The lock is released when the reader is manually scrolled away from its
  // destination, so manual scrolling still updates the page indicator.
  const pageJumpLockRef=useRef<{page:number;settled:boolean}|null>(null);
  const activeLoadRef = useRef<PdfLoadResult | null>(null);
  const requestIdRef = useRef(0);
  // A replacement is reserved immediately at load start, before PDF.js has
  // finished parsing. Async provider results must not overtake this request.
  const replacementPendingRef=useRef(false);
  const mutationPendingRef=useRef(false);
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
  // Updated at the same instant a new PDF is installed, before React renders.
  // Provider operations must not apply a result from an older working copy.
  const currentPdfBytesRef=useRef<Uint8Array|null>(null);
  const [sourceName, setSourceName] = useState('PDF Workspace');
  const [browserFile, setBrowserFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  // What the user is typing in the page-number box. Kept separate from
  // currentPage so the visible-page tracker can never overwrite a half-typed
  // number, and an empty box does not snap to page 1. null = not editing.
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  // A password-protected PDF waiting for its user password. The bytes stay in
  // memory only; the typed password lives in passwordDraft until submitted.
  const [passwordPrompt, setPasswordPrompt] = useState<{bytes:Uint8Array;name:string;file:File|null;incorrect:boolean}|null>(null);
  const [passwordDraft, setPasswordDraft] = useState('');
  // Encrypted PDFs can be viewed but pdf-lib cannot rewrite them safely.
  const [encryptedPdf, setEncryptedPdf] = useState(false);
  const [editPageInput,setEditPageInput]=useState('1');
  const [selectedPages, setSelectedPages] = useState<Set<number>>(() => new Set([1]));
  const [fitMode, setFitMode] = useState<PdfFitMode>('width');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [viewMode, setViewMode] = useState<PdfViewMode>('continuous');
  const [presentationMode, setPresentationMode] = useState(false);
  const previousPresentationViewRef=useRef<{mode:PdfViewMode;fit:PdfFitMode}|null>(null);
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
  // Noncritical PDF inspection is deliberately started AFTER the first canvas
  // has painted. Parsing forms/bookmarks/links/reviews on the main thread while
  // PDF.js renders page 1 made image-heavy PDFs appear to hang in Codespaces.
  const [inspectionReadySource, setInspectionReadySource] = useState<Uint8Array|null>(null);
  const [viewport, setViewport] = useState({ width: 900, height: 700 });
  const [historyRevision, setHistoryRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{page:number;excerpt:string;matches:number}>>([]);
  const [highlightQuery,setHighlightQuery]=useState('');
  const [searchStatus,setSearchStatus]=useState('');
  const [leftPanel, setLeftPanel] = useState<PdfLeftPanelId>(DEFAULT_PDF_LEFT_PANEL);
  // Workspace customization remains local to this installation and never
  // changes document bytes. Drag a navigation icon, or Alt+ArrowUp/Down.
  const [leftPanelOrder,setLeftPanelOrder]=useState<PdfLeftPanelId[]>(()=>{
    const defaults=PDF_LEFT_PANEL_ITEMS.map(item=>item.id);
    try{
      const saved=JSON.parse(window.localStorage.getItem('malenjo:pdf-left-panel-order-v1')??'null');
      if(Array.isArray(saved)&&saved.length===defaults.length &&
        defaults.every(id=>saved.includes(id)))return saved as PdfLeftPanelId[];
    }catch{ /* private browsing or first run */ }
    return defaults;
  });
  const draggedPanelRef=useRef<PdfLeftPanelId|null>(null);
  const [inspectorWidth,setInspectorWidth]=useState(()=>{
    try{
      const preferred=Number(window.localStorage.getItem('malenjo:pdf-inspector-width-v1'));
      if(Number.isFinite(preferred)&&preferred>=180&&preferred<=440)return preferred;
    }catch{ /* optional local preference */ }
    return 256;
  });
  const inspectorResizeRef=useRef<{startX:number;startWidth:number}|null>(null);
  useEffect(()=>{
    try{window.localStorage.setItem('malenjo:pdf-inspector-width-v1',String(inspectorWidth));}
    catch{ /* optional local preference */ }
  },[inspectorWidth]);
  useEffect(()=>{
    try{window.localStorage.setItem('malenjo:pdf-left-panel-order-v1',JSON.stringify(leftPanelOrder));}
    catch{ /* optional local preference */ }
  },[leftPanelOrder]);
  const moveLeftPanel=(source:PdfLeftPanelId,target:PdfLeftPanelId)=>{
    if(source===target)return;
    setLeftPanelOrder(current=>{
      const next=current.filter(id=>id!==source);
      const position=next.indexOf(target);
      if(position<0)return current;
      next.splice(position,0,source);
      return next;
    });
  };
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
  const [pdfLinks, setPdfLinks] = useState<PdfLinkAnnotation[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState('');
  const [linkDraft, setLinkDraft] = useState({
    targetKind:'page' as PdfLinkTarget['kind'],
    targetPage:1,
    url:'',
    x:0.12,y:0.3,width:0.35,height:0.05,
  });
  const [linkEdit, setLinkEdit] = useState<{
    item:PdfLinkAnnotation;
    targetKind:PdfLinkTarget['kind'];
    targetPage:number;
    url:string;
  }|null>(null);
  const [pdfAttachments, setPdfAttachments] = useState<PdfAttachmentModel>({entries:[],truncated:false});
  const [navigatorLoading, setNavigatorLoading] = useState(false);
  const [bookmarkError, setBookmarkError] = useState('');
  const [attachmentError, setAttachmentError] = useState('');
  const [extractingAttachment, setExtractingAttachment] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<DocumentInspectorTab>('properties');
  const [inspectorHidden, setInspectorHidden] = useState(true);
  const [taskCategory, setTaskCategory] = useState<PdfTaskCategory>('home');
  const [masterTab, setMasterTab] = useState<PdfMasterTab>('home');
  const [featureGalleryOpen, setFeatureGalleryOpen] = useState(false);
  const [featureGalleryMode, setFeatureGalleryMode] = useState<'category'|'all'|'master'>('category');
  const [featureGallerySearch, setFeatureGallerySearch] = useState('');
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
  const [managedFormField, setManagedFormField] = useState<{
    name:string;required:boolean;readOnly:boolean;
  }|null>(null);
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
  const [cropUnit,setCropUnit]=useState<CropUnit>('mm');
  const [cropMode,setCropMode]=useState(false);
  // Bind a visual crop to a specific page; scrolling must never move its overlay.
  const [cropTargetPage,setCropTargetPage]=useState<number|null>(null);
  const [cropGeometry,setCropGeometry]=useState<{width:number;height:number;visualSupported:boolean;reason:string}|null>(null);
  const [pageBoxDraft, setPageBoxDraft] = useState({
    scope:'selected' as 'selected'|'all',
    box:'crop' as 'crop'|'trim'|'bleed'|'art',
    top:0,
    right:0,
    bottom:0,
    left:0,
  });
  // Numeric margins use the source MediaBox. Dragging is only exact when the
  // displayed page is uncropped and natively unrotated.
  useEffect(()=>{
    if(!cropMode||!sourceBytes||cropTargetPage===null){setCropGeometry(null);return;}
    let cancelled=false;
    setCropGeometry(null);
    void inspectPdfVisualCropPage(sourceBytes,cropTargetPage).then(value=>{
      if(!cancelled)setCropGeometry(value);
    }).catch(reason=>{
      if(!cancelled){setCropGeometry(null);setError(describePdfError(reason));}
    });
    return ()=>{cancelled=true;};
  },[cropMode,cropTargetPage,sourceBytes]);
  const cropPreview=cropGeometry?.visualSupported&&pageBoxDraft.box==='crop'
    ?cropMarginsToRectangle(pageBoxDraft,cropGeometry.width,cropGeometry.height):null;
  const chooseCropRectangle=(rect:CropRectangle)=>{
    if(!cropGeometry?.visualSupported||cropTargetPage===null)return;
    try{
      const margins=cropRectangleToMargins(rect,cropGeometry.width,cropGeometry.height);
      setPageBoxDraft(draft=>({...draft,box:'crop',scope:'selected',...margins}));
      setError('');
    }catch(reason){setError(describePdfError(reason));}
  };
  const scrollFps = useScrollFps(scrollRef);
  const domIdPrefix=session?.id??previewIdRef.current;

  const installPdf = useCallback(async (
    input: ArrayBuffer | Uint8Array,
    name: string,
    file: File | null = null,
    preserveDirty = false,
    onCommitted?:()=>void,
    password?:string,
  ) => {
    const requestId = ++requestIdRef.current;
    replacementPendingRef.current=true;
    setLoading(true);
    setError('');
    setActionNotice('');
    setFirstPageMs(null);
    firstPageReportedRef.current = false;
    loadStartedRef.current = performance.now();
    let owned: Uint8Array | null = null;

    try {
      // File.arrayBuffer() already gives this reader an exclusive new buffer.
      // Keep that buffer instead of immediately copying up to 32 MB again;
      // Uint8Array inputs (including Undo/Redo) still receive an owned copy.
      // loadPdfBytes() clones separately for PDF.js worker transfer.
      owned = input instanceof Uint8Array ? Uint8Array.from(input) : new Uint8Array(input);
      const result = await loadPdfBytes(owned, password === undefined ? {} : {password});
      if (requestId !== requestIdRef.current) {
        await disposePdf(result);
        return false;
      }

      const previousLoad = activeLoadRef.current;
      activeLoadRef.current = result;
      setPdf(result);
      searchSequenceRef.current++;
      setSearching(false);
      setSearchResults([]);
      setHighlightQuery('');
      setSearchStatus('');
      comparisonAbortRef.current?.abort();
      setComparisonResult(null);
      currentPdfBytesRef.current=owned;
      setSourceBytes(owned);
      setPasswordPrompt(null);
      if(!preserveDirty)setEncryptedPdf(looksEncryptedPdf(owned));
      setBrowserFile(file);
      setSourceName(name);
      setPageCount(result.document.numPages);
      setRenderedPages(new Set());
      if(!preserveDirty){
        setCurrentPage(1);
        setCropMode(false);
        setCropTargetPage(null);
        setCropGeometry(null);
        setPageBoxDraft(draft=>({...draft,scope:'selected',box:'crop',top:0,right:0,bottom:0,left:0}));
        replaceTargetPageRef.current=null;
      }
      if(!preserveDirty){
        setSelectedPages(new Set([1]));
        selectionAnchorRef.current=1;
      }
      if(!preserveDirty){
        setFitMode('width');
        setZoom(1);
        setRotation(0);
      }
      setForceRenderAll(false);
      if(!preserveDirty){
        setDirty(false);
        historyRef.current=createPdfHistory(owned,1);
        setHistoryRevision((value)=>value+1);
      }
      finishPdfInstallCommit(onCommitted,()=>disposePdf(previousLoad));
      return true;
    } catch (reason) {
      if (requestId === requestIdRef.current) {
        if (reason instanceof PdfPasswordRequiredError && owned && !preserveDirty) {
          // Ask for the password instead of failing. Nothing is installed yet,
          // so a previously open PDF in this tab stays exactly as it was.
          setPasswordPrompt({bytes:owned,name,file,incorrect:reason.incorrect});
          setError('');
          return false;
        }
        // Loading is transactional: a corrupt replacement must not discard the
        // previously opened PDF, its unsaved bytes, or its undo/redo history.
        setError(describePdfError(reason));
      }
      return false;
    } finally {
      if(requestId===requestIdRef.current){
        replacementPendingRef.current=false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const document = session?.document;
    if (!document || document.kind !== 'pdf') return;

    let cancelled = false;

    if (document.browserFile) {
      const file = document.browserFile;
      if (file.size === 0 || file.size > 32 * 1024 * 1024) {
        setError('Browser PDF must be nonempty and no larger than 32 MB.');
        return;
      }
      setLoading(true);
      void file.arrayBuffer()
        .then((bytes) => {
          if (!cancelled) return installPdf(bytes, document.name, file);
        })
        .catch((reason) => {
          if (!cancelled) {
            setError(describePdfError(reason));
            setLoading(false);
          }
        });
      return () => { cancelled = true; };
    }

    if (!isDesktopRuntime()) return;

    setLoading(true);
    void readPdfDocumentBytes(document.id)
      .then((bytes) => {
        if (!cancelled) return installPdf(bytes, document.name);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(describePdfError(reason));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [installPdf, session?.id]);

  // Render the PDF immediately; warm up the reviewed offline processor
  // independently so no user-facing Start Provider step is required.
  // In browser/Codespaces preview the native sidecar is unavailable and is
  // deliberately never started.
  const hasLoadedPdf=Boolean(sourceBytes);
  useEffect(()=>{
    if(!active||!hasLoadedPdf||!isDesktopRuntime())return;
    void ensurePdfProviderRunning(defaultPdfToolProvider).catch(()=>{
      // Keep the document reader usable. Provider panel shows actionable
      // diagnostics if the optional processing engine cannot start.
    });
  },[active,hasLoadedPdf]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    textExportAbortRef.current?.abort();
    comparisonAbortRef.current?.abort();
    pageImageAbortRef.current?.abort();
    imagesAbortRef.current?.abort();
    void disposePdf(activeLoadRef.current);
  }, []);

  // Protect first-page interactive paint from heavyweight PDF-lib metadata
  // traversal. A newly opened/edited PDF schedules secondary inspection after
  // a browser rendering opportunity and an idle turn. The identity check
  // ensures stale inspection never applies to a replacement or Undo/Redo.
  const firstPdfPagePainted = renderedPages.size > 0;
  useEffect(()=>{
    setInspectionReadySource(null);
    if(!sourceBytes || !firstPdfPagePainted)return;
    let cancelled=false;
    let idleId:number|null=null;
    const timer=window.setTimeout(()=>{
      if(cancelled)return;
      if(typeof window.requestIdleCallback==='function'){
        idleId=window.requestIdleCallback(()=>{
          if(!cancelled)setInspectionReadySource(sourceBytes);
        },{timeout:1500});
      }else{
        setInspectionReadySource(sourceBytes);
      }
    },150);
    return ()=>{
      cancelled=true;
      window.clearTimeout(timer);
      if(idleId!==null)window.cancelIdleCallback(idleId);
    };
  },[sourceBytes,firstPdfPagePainted]);
  const deferredInspectionBytes=sourceBytes&&inspectionReadySource===sourceBytes
    ? sourceBytes : null;

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

  const goToPage = useCallback((requested: number, preserveSelection = false) => {
    const page = clampPdfPage(requested, pageCount);
    pageJumpLockRef.current={page,settled:false};
    setCurrentPage(page);
    // Explicit jumps should not slowly animate across dozens of heavy page
    // canvases; that causes render churn and stale intermediate page statuses.
    if(!preserveSelection){
      setSelectedPages((selected)=> selected.size<=1 ? new Set([page]) : selected);
      selectionAnchorRef.current=page;
    }
    window.requestAnimationFrame(()=>{
      // 'instant' overrides the reader's CSS scroll-behavior:smooth. 'auto'
      // inherits it, which animated through every intermediate page, rendered
      // them all and let stale observer updates reach the page indicator.
      document.getElementById(`${domIdPrefix}-page-${page}`)?.scrollIntoView({
        behavior:'instant',block:'start',
      });
      window.requestAnimationFrame(()=>{
        if(pageJumpLockRef.current?.page===page)pageJumpLockRef.current.settled=true;
      });
    });
  }, [domIdPrefix,pageCount]);

  const onPageVisible = useCallback((page: number) => {
    // The observer also reports pages adjacent to the requested target.
    // Never let a stale callback turn a jump to page 57 into page 56.
    const lock=pageJumpLockRef.current;
    if(lock&&page!==lock.page)return;
    setCurrentPage(page);
  }, []);
  const releasePageJumpOnManualScroll=()=>{
    pageJumpLockRef.current=null;
  };
  const releaseJumpIfTargetLeftView=()=>{
    const lock=pageJumpLockRef.current;
    if(!lock?.settled)return;
    const viewport=scrollRef.current?.getBoundingClientRect();
    const target=document.getElementById(`${domIdPrefix}-page-${lock.page}`)?.getBoundingClientRect();
    if(!viewport||!target)return;
    const overlap=Math.max(0,Math.min(viewport.bottom,target.bottom)-Math.max(viewport.top,target.top));
    if(overlap<Math.min(viewport.height,target.height)*.15)pageJumpLockRef.current=null;
  };

  const endCropPreview=()=>{
    setCropMode(false);
    setCropTargetPage(null);
    setCropGeometry(null);
  };
  const chooseEditPage=(page:number)=>{
    const selected=clampPdfPage(page,pageCount);
    if(cropMode&&cropTargetPage!==selected)endCropPreview();
    selectionAnchorRef.current=selected;
    setSelectedPages(new Set([selected]));
    goToPage(selected,true);
  };
  const startCropOnPage=(page:number)=>{
    const target=clampPdfPage(page,pageCount);
    chooseEditPage(target);
    setCropTargetPage(target);
    // Never reuse the margin values from another page or another edit.
    setPageBoxDraft({scope:'selected',box:'crop',top:0,right:0,bottom:0,left:0});
    setCropMode(true);
    configureProperties();
  };
  const beginReplacePage=(page:number)=>{
    if(!sourceBytes||mutating||loading||page<1||page>pageCount)return;
    chooseEditPage(page);
    replaceTargetPageRef.current=page;
    replaceInputRef.current?.click();
  };

  function selectThumbnail(page:number,additive:boolean,range:boolean){
    goToPage(page,true);
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
  // Explicit thumbnail selection is authoritative for "selected page"
  // operations, even after the user scrolls or searches to another page.
  const operationPages=selectedPageNumbers.length?selectedPageNumbers:[currentPage];
  const singleEditTarget=operationPages.length===1?operationPages[0]:null;
  useEffect(()=>{
    setEditPageInput(singleEditTarget===null?'':String(singleEditTarget));
  },[singleEditTarget]);
  const commitEditPageInput=(entered:string)=>{
    const page=Number(entered);
    if(!Number.isSafeInteger(page)||page<1||page>pageCount){
      setError(`Choose a page number between 1 and ${pageCount}.`);
      setEditPageInput(singleEditTarget===null?'':String(singleEditTarget));
      return;
    }
    setError('');
    chooseEditPage(page);
    setEditPageInput(String(page));
  };

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
  // A page released by the render memory budget must render again before the
  // scheduler treats it as painted (focus/adjacent priority stays correct).
  const onPageReleased = useCallback((page: number) => {
    setRenderedPages((current) => {
      if (!current.has(page)) return current;
      const next = new Set(current);
      next.delete(page);
      return next;
    });
  }, []);

  async function chooseBrowserPdf(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size === 0 || file.size > 32 * 1024 * 1024) {
      setError('Browser PDF must be nonempty and no larger than 32 MB.');
      return;
    }

    // Browser preview opened from the empty PDF module used to be destroyed
    // on navigation. Move the chosen file into a durable document tab.
    if(!session&&onOpenBrowserPdf){
      onOpenBrowserPdf(file);
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
    if(!sourceBytes||mutating||mutationPendingRef.current||
      replacementPendingRef.current||currentPdfBytesRef.current!==sourceBytes)return false;
    // Snapshot the replacement counter before awaiting any document processing.
    // It changes at the START of installPdf, not only after PDF.js parsing.
    if(encryptedPdf){
      setActionNotice('');
      setError(ENCRYPTED_EDIT_MESSAGE);
      return false;
    }
    const sourceRevision=requestIdRef.current;
    mutationPendingRef.current=true;
    setMutating(true);
    setError('');
    setActionNotice('Applying PDF edit to the live document…');
    try{
      const result=await operation(Uint8Array.from(sourceBytes));
      if(currentPdfBytesRef.current!==sourceBytes||
        requestIdRef.current!==sourceRevision||replacementPendingRef.current){
        throw new Error('This PDF changed or began loading another version while the tool was running. The older result was not applied.');
      }
      const targetPage=Math.max(1,preferredPage);
      // The synchronous commit callback runs before installPdf returns and
      // before any old-worker cleanup. Later failed loads cannot leave
      // mutated PDF bytes visible without their corresponding undo entry.
      const installed=await installPdf(result,sourceName,browserFile,true,()=>{
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
      });
      return installed;
    }catch(reason){
      setActionNotice('');
      setError(describePdfError(reason));
      return false;
    }finally{
      mutationPendingRef.current=false;
      setMutating(false);
    }
  }

  async function removePagesSafely(pages:number[]):Promise<void>{
    const targets=[...new Set(pages)].sort((a,b)=>a-b);
    if(!sourceBytes||mutating||loading||!targets.length||targets.length>=pageCount||
      targets.some(page=>!Number.isInteger(page)||page<1||page>pageCount))return;
    const label='Delete '+(targets.length===1?'page ':'pages ')+targets.join(', ')+'?';
    if(!window.confirm(label+'\n\nOnly the working PDF changes. Your original file remains untouched, and Undo can restore the pages.'))return;
    await mutateAction(
      'Removed '+targets.length+' page(s) from the working copy.',
      bytes=>targets.length===1
        ?deletePdfPage(bytes,targets[0])
        :deletePdfPages(bytes,targets),
      Math.max(1,Math.min(targets[0],pageCount-targets.length)),
    );
  }
  async function removeSelectedPagesSafely():Promise<void>{
    await removePagesSafely(operationPages);
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
          if(file.size>32*1024*1024)throw new Error(`${file.name} exceeds the 32 MB interactive PDF budget.`);
          result=await insertPdfAfter(result,new Uint8Array(await file.arrayBuffer()),currentPage);
        }
        return result;
      },
      currentPage+1,
    );
  }

  async function replaceSelectedPdfPage(event:React.ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    event.target.value='';
    const targetPage=replaceTargetPageRef.current;
    replaceTargetPageRef.current=null;
    if(!file||!sourceBytes||mutating||loading||targetPage===null||targetPage<1||targetPage>pageCount)return;
    if(file.size<1 || file.size>32*1024*1024){
      setError('Replacement PDF must be nonempty and no larger than 32 MB.');
      return;
    }
    if(!window.confirm(
      `Replace page ${targetPage} with page 1 of "${file.name}"?\n\n`+
      'The original file is unchanged. MALENJO will keep the edit in this tab with Undo available; incompatible signed/form/bookmark documents are safely rejected.'
    ))return;
    const originalBytes=sourceBytes;
    try{
      const imported=new Uint8Array(await file.arrayBuffer());
      if(currentPdfBytesRef.current!==originalBytes || replacementPendingRef.current){
        throw new Error('The PDF changed while reading the replacement. Select the target page and try again.');
      }
      await mutate(
        `Replaced page ${targetPage} with page 1 from ${file.name}.`,
        bytes=>replacePdfPage(bytes,imported,targetPage,1),
        targetPage,
      );
    }catch(reason){
      setError(describePdfError(reason));
    }
  }

  async function appendDocuments(event:React.ChangeEvent<HTMLInputElement>){
    const files=Array.from(event.target.files??[]);
    event.target.value='';
    if(!files.length||!sourceBytes)return;
    // Reuse the transactional edit lane so a slower multi-file append cannot
    // overwrite a document load or another user edit that began later.
    await mutate(`Appended ${files.length} PDF file(s).`,async(bytes)=>{
      let result=bytes;
      for(const file of files){
        if(file.size>32*1024*1024)throw new Error(`${file.name} exceeds the 32 MB interactive PDF budget.`);
        result=Uint8Array.from(await appendPdf(result,new Uint8Array(await file.arrayBuffer())));
      }
      return result;
    },currentPage);
  }

  async function undoEdit(){
    const history=historyRef.current;
    if(!history||mutating||mutationPendingRef.current||replacementPendingRef.current||
      currentPdfBytesRef.current!==sourceBytes||!canUndoPdfHistory(history))return;
    const undoneLabel=history.entries[history.cursor]?.label??'PDF edit';
    const transition=undoPdfHistory(history);
    if(!transition.changed)return;
    mutationPendingRef.current=true;
    setMutating(true);
    setError('');
    setActionNotice('Undoing PDF edit…');
    try{
      await installPdf(transition.entry.bytes,sourceName,browserFile,true,()=>{
        historyRef.current=transition.history;
        setHistoryRevision((value)=>value+1);
        setCurrentPage(transition.entry.page);
        setSelectedPages(new Set([transition.entry.page]));
        selectionAnchorRef.current=transition.entry.page;
        setDirty(transition.entry.dirty);
        onDirtyChange?.(transition.entry.dirty);
        setActionNotice(`Undid: ${undoneLabel}`);
      });
    }catch(reason){
      setError(describePdfError(reason));
    }finally{
      mutationPendingRef.current=false;
      setMutating(false);
    }
  }

  async function redoEdit(){
    const history=historyRef.current;
    if(!history||mutating||mutationPendingRef.current||replacementPendingRef.current||
      currentPdfBytesRef.current!==sourceBytes||!canRedoPdfHistory(history))return;
    const transition=redoPdfHistory(history);
    if(!transition.changed)return;
    mutationPendingRef.current=true;
    setMutating(true);
    setError('');
    setActionNotice('Redoing PDF edit…');
    try{
      await installPdf(transition.entry.bytes,sourceName,browserFile,true,()=>{
        historyRef.current=transition.history;
        setHistoryRevision((value)=>value+1);
        setCurrentPage(transition.entry.page);
        setSelectedPages(new Set([transition.entry.page]));
        selectionAnchorRef.current=transition.entry.page;
        setDirty(transition.entry.dirty);
        onDirtyChange?.(transition.entry.dirty);
        setActionNotice(`Redid: ${transition.entry.label}`);
      });
    }catch(reason){
      setError(describePdfError(reason));
    }finally{
      mutationPendingRef.current=false;
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
      if(key==='s'&&!event.shiftKey){
        event.preventDefault();
        void exportCurrent();
      }else if(key==='z'&&!event.shiftKey){
        event.preventDefault();
        void undoEdit();
      }else if((key==='z'&&event.shiftKey)||key==='y'){
        event.preventDefault();
        void redoEdit();
      }
    };
    window.addEventListener('keydown',onKeyDown);
    return()=>window.removeEventListener('keydown',onKeyDown);
  },[active,historyRevision,mutating,sourceBytes,dirty,sourceName]);


  useEffect(()=>{
    setFormFields([]);
    setFormFillDraft({});
    setFormFillTouched(new Set());
    setFormInspectedSource(null);
    setManagedFormField(null);
    if(!deferredInspectionBytes)return;

    const inspectedBytes=deferredInspectionBytes;
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
  },[deferredInspectionBytes]);

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
    if(!deferredInspectionBytes){
      setReviewAnnotations([]);
      setReviewFailure('');
      setReviewLoading(false);
      return;
    }
    let cancelled=false;
    setReviewLoading(true);
    setReviewFailure('');
    void listPdfReviewAnnotations(deferredInspectionBytes)
      .then(items=>{if(!cancelled)setReviewAnnotations(items);})
      .catch(reason=>{
        if(!cancelled){
          setReviewAnnotations([]);
          setReviewFailure(describePdfError(reason));
        }
      })
      .finally(()=>{if(!cancelled)setReviewLoading(false);});
    return ()=>{cancelled=true;};
  },[deferredInspectionBytes]);

  useEffect(()=>{
    setOptionalLayers(null);
    setLayersError('');
    if(!pdf || !deferredInspectionBytes){setLayersLoading(false);return;}
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
        setLayersError(describePdfError(reason));
        setOptionalLayers(null);
      })
      .finally(()=>{if(!cancelled)setLayersLoading(false);});
    return()=>{cancelled=true;};
  },[pdf,deferredInspectionBytes]);

  const currentLayers=optionalLayers?.document===pdf?.document?optionalLayers:null;

  function changeLayerVisibility(id:string,visible:boolean){
    if(!currentLayers||mutating||loading)return;
    try{
      const entries=setPdfOptionalLayerVisibility(currentLayers.config,id,visible);
      setOptionalLayers({...currentLayers,current:entries});
      setLayerRevision(value=>value+1);
    }catch(reason){
      setLayersError(describePdfError(reason));
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
      setLayersError(describePdfError(reason));
    }
  }

  useEffect(()=>{
    if(!pdf || !deferredInspectionBytes){
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
  },[pdf,deferredInspectionBytes]);

  useEffect(()=>{
    // Never leave actionable bookmark refs/drafts from a previous PDF available
    // while asynchronously inspecting a newly opened or edited working copy.
    setEditableBookmarks([]);
    setBookmarkEdit(null);
    if(!deferredInspectionBytes){
      setBookmarkEditError('');
      return;
    }
    let cancelled=false;
    void listPdfTopLevelBookmarks(deferredInspectionBytes)
      .then(items=>{if(!cancelled){setEditableBookmarks(items);setBookmarkEditError('');}})
      .catch(reason=>{
        if(!cancelled){
          setEditableBookmarks([]);
          setBookmarkEditError(describePdfError(reason));
        }
      });
    return ()=>{cancelled=true;};
  },[deferredInspectionBytes]);

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

  useEffect(()=>{
    setPdfLinks([]);
    setLinkEdit(null);
    setLinksError('');
    if(!deferredInspectionBytes){setLinksLoading(false);return;}
    let cancelled=false;
    setLinksLoading(true);
    void listPdfLinkAnnotations(deferredInspectionBytes)
      .then(items=>{if(!cancelled)setPdfLinks(items);})
      .catch(reason=>{
        if(!cancelled)setLinksError(describePdfError(reason));
      })
      .finally(()=>{if(!cancelled)setLinksLoading(false);});
    return()=>{cancelled=true;};
  },[deferredInspectionBytes]);

  function linkTarget(kind:PdfLinkTarget['kind'],page:number,url:string):PdfLinkTarget{
    return kind==='page'?{kind,pageNumber:page}:{kind,url};
  }

  async function addCurrentPageLink(){
    const {targetKind,targetPage,url,x,y,width,height}=linkDraft;
    await mutate(
      'Created native PDF link on page '+currentPage+'.',
      bytes=>addPdfLinkAnnotation(
        bytes,{pageNumber:currentPage,x,y,width,height},
        linkTarget(targetKind,targetPage,url),
      ),currentPage,
    );
  }

  function editPdfLink(item:PdfLinkAnnotation){
    if(item.kind==='unsupported'||!item.ref)return;
    setLinkEdit({
      item,
      targetKind:item.kind,
      targetPage:item.kind==='page'?Number(item.destination):1,
      url:item.kind==='https'?item.destination:'',
    });
  }

  async function applyPdfLinkEdit(){
    if(!linkEdit)return;
    const {item,targetKind,targetPage,url}=linkEdit;
    const applied=await mutate(
      'Updated native PDF link on page '+item.pageNumber+'.',
      bytes=>updatePdfLinkAnnotation(bytes,item,linkTarget(targetKind,targetPage,url)),
      item.pageNumber,
    );
    if(applied)setLinkEdit(null);
  }

  async function removePdfLink(item:PdfLinkAnnotation){
    if(!item.ref)return;
    if(!window.confirm('Delete the selected PDF link on page '+item.pageNumber+'? This can be undone.'))return;
    const deleted=await mutate(
      'Deleted native PDF link from page '+item.pageNumber+'.',
      bytes=>deletePdfLinkAnnotation(bytes,item),item.pageNumber,
    );
    if(deleted)setLinkEdit(null);
  }

  function activatePdfLink(link:PdfLinkAnnotation){
    if(link.kind==='page'){
      const target=Number(link.destination);
      if(Number.isSafeInteger(target)&&target>=1&&target<=pageCount)goToPage(target);
      else setError('The link target page is unavailable.');
      return;
    }
    if(link.kind==='https'){
      try{
        const target=new URL(link.destination);
        if(target.protocol!=='https:'||target.username||target.password)
          throw new Error('Imported PDF link is not a safe HTTPS URL.');
        if(window.confirm('This link opens an external website outside MALENJO. Continue?\n'+target.href)){
          window.open(target.href,'_blank','noopener,noreferrer');
        }
      }catch(reason){
        setError(describePdfError(reason));
      }
    }
  }

  async function openBookmark(entry:PdfOutlineEntry){
    if(!pdf)return;
    if(entry.dest){
      try{
        const page=await resolvePdfOutlinePage(pdf.document,entry.dest);
        if(page){goToPage(page);setActionNotice('Navigated to bookmark '+entry.title+'.');return;}
      }catch(reason){
        setError(describePdfError(reason));
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
      setError(describePdfError(reason));
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

  function chooseManagedFormField(name:string){
    const field=formFields.find(item=>item.name===name&&item.type!=='signature');
    if(!field){setManagedFormField(null);return;}
    setManagedFormField({name:field.name,required:field.required,readOnly:field.readOnly});
  }

  async function applyManagedFormFlags(){
    if(!managedFormField)return;
    await mutate(
      'Updated existing PDF field "'+managedFormField.name+'" flags.',
      bytes=>updatePdfExistingFieldProperties(bytes,managedFormField),
      currentPage,
    );
  }

  async function removeManagedFormField(){
    if(!managedFormField)return;
    if(!window.confirm('Permanently remove PDF field "'+managedFormField.name+'" and its widgets from the exported copy? You can Undo this change.'))return;
    await mutate(
      'Deleted PDF form field "'+managedFormField.name+'".',
      bytes=>deletePdfExistingFormField(bytes,managedFormField.name),
      currentPage,
    );
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
    if(!deferredInspectionBytes){
      setPageLabelRanges([]);
      setPageLabelError('');
      return;
    }
    let cancelled=false;
    setPageLabelRanges([]);
    void listPdfPageLabelRanges(deferredInspectionBytes)
      .then(ranges=>{if(!cancelled){setPageLabelRanges(ranges);setPageLabelError('');}})
      .catch(reason=>{
        if(!cancelled){
          setPageLabelRanges([]);
          setPageLabelError(describePdfError(reason));
        }
      });
    return ()=>{cancelled=true;};
  },[deferredInspectionBytes]);

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
    const committed=await mutate(
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
    if(committed){endCropPreview();setActionNotice('Crop applied to the working PDF. Undo restores the previous page.');}
  }

  async function searchPdf(){
    if(!pdf)return;
    const requested=searchQuery.trim();
    if(!requested){
      searchSequenceRef.current++;
      setSearching(false);
      setSearchResults([]);
      setHighlightQuery('');
      setSearchStatus('Type a word or phrase, then select Find.');
      return;
    }
    const revision=++searchSequenceRef.current;
    const document=pdf.document;
    setSearching(true);
    setError('');
    setSearchStatus('Searching selectable PDF text…');
    try{
      const results:Array<{page:number;excerpt:string;matches:number}>=[];
      const count=Math.min(document.numPages,500);
      let total=0;
      let textPages=0;
      for(let pageNumber=1;pageNumber<=count;pageNumber++){
        if(revision!==searchSequenceRef.current)return;
        const page=await document.getPage(pageNumber);
        const content=await page.getTextContent();
        const text=extractPdfPageSearchText(content.items);
        if(text)textPages++;
        const matches=findPdfTextMatches(text,requested,100);
        if(matches.length){
          total+=matches.length;
          if(results.length<100){
            const index=matches[0].start;
            results.push({
              page:pageNumber,
              matches:matches.length,
              excerpt:text.slice(Math.max(0,index-45),Math.min(text.length,index+requested.length+100)),
            });
          }
        }
      }
      if(revision!==searchSequenceRef.current)return;
      setSearchResults(results);
      setHighlightQuery(requested);
      const truncated=count<document.numPages||results.length>=100;
      if(!textPages){
        setSearchStatus('No selectable text was found. This PDF may be scanned; use OCR before searching.');
      }else if(total===0){
        setSearchStatus('No matching words found in selectable text.');
      }else{
        setSearchStatus(
          String(total)+' match'+(total===1?'':'es')+' on '+
          String(results.length)+' page'+(results.length===1?'':'s')+
          (truncated?' (limited to first 500 pages/100 results)':'')+'.',
        );
        goToPage(results[0].page);
      }
    }catch(reason){
      if(revision===searchSequenceRef.current){
        setSearchStatus('PDF text search could not finish.');
        setError(describePdfError(reason));
      }
    }finally{
      if(revision===searchSequenceRef.current)setSearching(false);
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
        setError(describePdfError(reason));
      }
    }finally{
      if(textExportAbortRef.current===controller)textExportAbortRef.current=null;
      setExportingText(false);
      onSavingChange?.(false);
    }
  }

  async function exportJpegPages(){
    if(!pdf||exportingPageImages||mutating||loading)return;
    const controller=new AbortController();
    pageImageAbortRef.current=controller;
    setExportingPageImages(true);
    setPageImageProgress(0);
    setError('');
    setActionNotice('Rendering PDF pages as JPEG images…');
    onSavingChange?.(true);
    try{
      const zip=await exportPdfPagesAsJpegZip(pdf.document,{
        signal:controller.signal,
        scale:1.5,
        quality:0.9,
        onProgress:(completed,total)=>setPageImageProgress(Math.round(completed*100/total)),
      });
      if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
      const base=sourceName.replace(/\.pdf$/i,'').replace(/[/\\\u0000-\u001F]/g,'_').slice(0,120)||'MALENJO-document';
      const saved=await exportPdfPageImagesZip(base+'-pages-jpg.zip',zip);
      if(saved)setActionNotice('Exported '+pdf.document.numPages+' JPEG page images to ZIP. The original PDF is unchanged.');
    }catch(reason){
      if(reason instanceof Error&&reason.name==='AbortError'){
        setActionNotice('PDF-to-JPEG cancelled; no partial file was saved.');
      }else{
        setError(describePdfError(reason));
      }
    }finally{
      if(pageImageAbortRef.current===controller)pageImageAbortRef.current=null;
      setExportingPageImages(false);
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
        setError(describePdfError(reason));
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
      }else setError(describePdfError(reason));
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
      setMasterTab('convert');
    }catch(reason){
      if(reason instanceof Error&&reason.name==='AbortError'){
        setActionNotice('PDF comparison cancelled; no partial result was saved.');
      }else{
        setError(describePdfError(reason));
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
      setError(describePdfError(reason));
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
      if(saved)setActionNotice(dirty
        ? 'Edited PDF exported as a separate copy. The source working session remains unsaved; use the exported copy or continue editing.'
        : 'PDF copy exported. The original document remains unchanged.');
      else setActionNotice('PDF export cancelled. No new file was saved.');
    }catch(reason){
      setError(describePdfError(reason));
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
      const saved = await exportPdfBytes(`${base}-${label}.pdf`,bytes);
      if(saved) setActionNotice(`Extracted ${pages.length} selected page(s) as a new PDF.`);
      else setActionNotice('Page extraction cancelled. No output was saved.');
    }catch(reason){
      setError(describePdfError(reason));
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
      const firstSaved = await exportPdfBytes(`${base}-part-1.pdf`,left);
      if(!firstSaved){
        setActionNotice('PDF split cancelled before saving its first part.');
        return;
      }
      const secondSaved = await exportPdfBytes(`${base}-part-2.pdf`,right);
      setActionNotice(secondSaved
        ? `Split after page ${currentPage} and exported two PDFs.`
        : 'PDF split only partially saved: part 1 was exported, part 2 was cancelled.');
    }catch(reason){
      setError(describePdfError(reason));
    }finally{
      onSavingChange?.(false);
    }
  }

  function printDocument() {
    if (!pdf || !sourceBytes) return;
    // Print the complete PDF bytes, not just lazily mounted page canvases.
    const copy = Uint8Array.from(sourceBytes);
    const url = URL.createObjectURL(new Blob([copy.buffer],{type:'application/pdf'}));
    const viewer = window.open(url, '_blank');
    if (!viewer) {
      URL.revokeObjectURL(url);
      setError('Print preview was blocked. Allow the full PDF viewer window.');
      return;
    }
    viewer.opener = null;
    setActionNotice('Opened the entire PDF in a separate viewer. Use its Print command to print all pages.');
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
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
          run:removeSelectedPagesSafely,
        },
        {
          id:'pdf-page-copy',
          label:'Duplicate selected PDF page',
          keywords:'pdf organize duplicate copy page',
          detail:'Requires exactly one selected page',
          enabled:!!sourceBytes&&!mutating&&operationPages.length===1,
          disabledReason:operationPages.length!==1?'Select exactly one page.':!sourceBytes?'No PDF is loaded.':'Wait for the current PDF edit to finish.',
          run:()=>mutateAction(`Duplicated page ${operationPages[0]}.`,bytes=>duplicatePdfPage(bytes,operationPages[0]),operationPages[0]+1),
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
          id:'pdf-page-replace',
          label:'Replace selected PDF page with imported page…',
          keywords:'pdf organize replace page first imported source',
          detail:'Replace exactly one selected page using page 1 of an imported PDF; Undo and Save PDF copy work normally.',
          enabled:!!sourceBytes&&!mutating&&!loading&&operationPages.length===1,
          disabledReason:!sourceBytes?'Open a PDF first.':operationPages.length!==1?'Select exactly one page to replace.':'Wait for the active PDF operation.',
          run:()=>beginReplacePage(operationPages[0]),
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
          id:'pdf-link-add',
          label:'Create configured PDF page or HTTPS link',
          keywords:'pdf hyperlink https link annotation destination pages',
          detail:'Add a PDF-native Link annotation at the configured rectangle on the current page',
          enabled:!!sourceBytes&&!mutating,
          disabledReason:!sourceBytes?'Open a PDF first.':'Wait for the PDF edit to finish.',
          run:()=>addCurrentPageLink(),
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
    inspectorHidden, textOverlay, shapeOverlay, commentDraft, bookmarkTitle, linkDraft,
  ]);

  useEffect(() => {
    if (!active) return;
    function onInspectorShortcut(event: KeyboardEvent) {
      if (!isDocumentInspectorToggleShortcut(event)) return;
      event.preventDefault();
      setInspectorHidden(value=>{if(value)setLeftPanelCollapsed(true);return !value;});
    }
    window.addEventListener('keydown', onInspectorShortcut);
    return () => window.removeEventListener('keydown', onInspectorShortcut);
  }, [active]);

  useEffect(()=>{
    if(!active||!pdf)return;
    function onFindShortcut(event:KeyboardEvent){
      if(!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey||
         event.key.toLowerCase()!=='f')return;
      event.preventDefault();
      setLeftPanel('search');
      setLeftPanelCollapsed(false);
      window.requestAnimationFrame(()=>{
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }
    window.addEventListener('keydown',onFindShortcut);
    return()=>window.removeEventListener('keydown',onFindShortcut);
  },[active,pdf]);

  useEffect(() => {
    if (!active) return;
    function onTaskShortcut(event: KeyboardEvent) {
      const target=event.target as HTMLElement|null;
      if(target?.closest('input,textarea,[contenteditable="true"]'))return;
      const tab=masterPdfTabFromShortcut(event);
      if(!tab)return;
      event.preventDefault();
      setMasterTab(tab);
      setTaskCategory(PDF_MASTER_TABS.find(item=>item.id===tab)!.category);
      window.requestAnimationFrame(()=>document.getElementById(`${domIdPrefix}-task-${tab}`)?.focus());
    }
    window.addEventListener('keydown',onTaskShortcut);
    return()=>window.removeEventListener('keydown',onTaskShortcut);
  },[active,domIdPrefix]);

  const zoomLabel = fitMode === 'width'
    ? 'Fit width'
    : fitMode === 'page'
      ? 'Fit page'
      : `${Math.round(zoom * 100)}%`;

  // Keep the shell status strip synchronized with the actual live PDF reader.
  // Do not synthesize a page count or make the app chrome modify the PDF.
  useEffect(()=>{
    if(active&&session)onViewStatusChange?.({page:currentPage,pageCount,zoom:zoomLabel});
  },[active,session?.id,currentPage,pageCount,zoomLabel,onViewStatusChange]);

  const viewPages=pdfViewPages(viewMode,currentPage,pageCount);

  // A Fit Width / Fit Page click must start from the REAL displayed scale,
  // rather than jumping from a hard-coded 100% as soon as the user zooms.
  const zoomByStep=async(direction:-1|1)=>{
    if(!pdf)return;
    if(fitMode==='custom'){
      setZoom(value=>stepPdfZoom(value,direction));
      return;
    }
    try{
      const page=await pdf.document.getPage(currentPage);
      const size=page.getViewport({scale:1,rotation:displayPdfRotation(page.rotate,rotation)});
      const currentScale=effectivePdfScale(
        size.width,size.height,viewport.width,viewport.height,fitMode,zoom);
      setZoom(stepPdfZoom(currentScale,direction));
      setFitMode('custom');
    }catch(reason){
      setError('MAL-PDF-ZOOM-001: '+(reason instanceof Error?reason.message:String(reason)));
    }
  };

  // Preserve ordinary wheel scrolling through the whole PDF. Modified wheel
  // events zoom the actual page instead of magnifying the whole application.
  useEffect(()=>{
    const reader=scrollRef.current;
    if(!reader||!active||!pdf)return;
    const onWheel=(event:WheelEvent)=>{
      if(!(event.ctrlKey||event.metaKey)||event.deltaY===0)return;
      event.preventDefault();
      void zoomByStep(event.deltaY<0?1:-1);
    };
    reader.addEventListener('wheel',onWheel,{passive:false});
    return()=>reader.removeEventListener('wheel',onWheel);
  },[active,pdf,fitMode,zoom,currentPage,rotation,viewport.width,viewport.height]);

  useEffect(()=>{
    function onFullscreenChange(){
      const active=Boolean(document.fullscreenElement);
      setFullscreen(active);
      if(!active){
        setPresentationMode(false);
        const previous=previousPresentationViewRef.current;
        if(previous){
          previousPresentationViewRef.current=null;
          setViewMode(previous.mode);
          setFitMode(previous.fit);
        }
      }
    }
    document.addEventListener('fullscreenchange',onFullscreenChange);
    return()=>document.removeEventListener('fullscreenchange',onFullscreenChange);
  },[]);

  const toggleFullscreen=async(presentation=false)=>{
    const element=workspaceRef.current;
    if(!element)return;
    try{
      if(document.fullscreenElement){
        await document.exitFullscreen();
        return;
      }
      await element.requestFullscreen();
      setPresentationMode(presentation);
      if(presentation){
        previousPresentationViewRef.current={mode:viewMode,fit:fitMode};
        setViewMode('single');
        setFitMode('page');
        window.requestAnimationFrame(()=>scrollRef.current?.focus({preventScroll:true}));
      }
    }catch(reason){
      setPresentationMode(false);
      setError('MAL-PDF-VIEW-002: Fullscreen is unavailable: '+(reason instanceof Error?reason.message:String(reason)));
    }
  };

  // Presentation is a true immersive reading mode. Document navigation
  // continues even though the toolbar/footer is deliberately hidden.
  useEffect(()=>{
    if(!active||!presentationMode)return;
    const onPresentationKey=(event:KeyboardEvent)=>{
      if(event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey)return;
      const target=event.target as HTMLElement|null;
      if(target?.closest('input,textarea,select,[contenteditable="true"]'))return;
      if(['PageDown','ArrowRight',' ','Spacebar'].includes(event.key)){
        event.preventDefault();goToPage(currentPage+1);
      }else if(['PageUp','ArrowLeft','Backspace'].includes(event.key)){
        event.preventDefault();goToPage(currentPage-1);
      }else if(event.key==='Home'){
        event.preventDefault();goToPage(1);
      }else if(event.key==='End'){
        event.preventDefault();goToPage(pageCount);
      }else if(event.key==='Escape'&&document.fullscreenElement){
        event.preventDefault();void document.exitFullscreen();
      }
    };
    window.addEventListener('keydown',onPresentationKey);
    return()=>window.removeEventListener('keydown',onPresentationKey);
  },[active,presentationMode,currentPage,pageCount,goToPage]);

  const thumbnailsRenderAllowed = forceRenderAll
    || pdfCriticalPassReady(currentPage, pageCount, renderedPages);
  const pdfLayoutClass = [
    'pdf-layout',
    leftPanelCollapsed ? 'left-panel-collapsed' : '',
    inspectorHidden ? 'inspector-hidden' : '',
  ].filter(Boolean).join(' ');

  const configureProperties=()=>{
    setInspectorTab('properties');
    setLeftPanelCollapsed(true);
    setInspectorHidden(false);
  };
  const openLeftPanel=(panel:PdfLeftPanelId)=>{
    setLeftPanel(panel);
    setInspectorHidden(true);
    setLeftPanelCollapsed(false);
  };
  const navigateAction=(label:string,id:ModuleId):PdfToolbarAction=>({
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
    // Global Open, Save, Undo, Redo and the reader's Properties toggle have
    // one stable home in the top bar/footer. Do not duplicate them in ribbons.
    home:[
      {id:'print',label:'Print',enabled:!!pdf&&!mutating,disabledReason:!pdf?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:printDocument},
    ],
    edit:[
      {id:'place-text',label:'Place text',enabled:!!sourceBytes&&!mutating&&!!textOverlay.text.trim(),disabledReason:!sourceBytes?'No PDF is loaded.':!textOverlay.text.trim()?'Enter text in the Properties inspector first.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction('Added permanent text to the PDF.',bytes=>addPdfTextOverlay(bytes,{pageNumber:currentPage,...textOverlay}),currentPage)},
      {id:'rectangle',label:shapeOverlay.mode==='highlight'?'Highlight rectangle':'Outline rectangle',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction(`Added ${shapeOverlay.mode} rectangle.`,bytes=>addPdfRectangleOverlay(bytes,{pageNumber:currentPage,...shapeOverlay}),currentPage)},
      {id:'configure-edit',label:'Edit settings',enabled:true,run:configureProperties},
      {id:'open-page-numbers',label:'Page numbers settings',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'Open a PDF before adding page numbers.':mutating?'Wait for the current PDF edit.':undefined,run:configureProperties},
      providerAction,
    ],
    convert:[
      {id:'export-text',label:exportingText?'Extracting text '+textExportProgress+'%':'PDF to text (.txt)',enabled:!!pdf&&!mutating&&!exportingText,disabledReason:!pdf?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':exportingText?'PDF text export is running.':undefined,run:exportText},
      {id:'export-page-images',label:exportingPageImages?'PNG '+pageImageProgress+'%':'PDF pages to PNG ZIP',enabled:!!pdf&&!mutating&&!loading&&!exportingPageImages,disabledReason:!pdf?'No PDF is loaded.':exportingPageImages?'An image export is in progress.':'Wait for the current PDF operation to finish.',run:exportPageImages},
      {id:'export-page-jpeg',label:exportingPageImages?'JPG '+pageImageProgress+'%':'PDF to JPG',enabled:!!pdf&&!mutating&&!loading&&!exportingPageImages,disabledReason:!pdf?'No PDF is loaded.':exportingPageImages?'An image export is in progress.':'Wait for the current PDF operation to finish.',run:exportJpegPages},
      ...(exportingPageImages?[{id:'cancel-page-images',label:'Cancel PNG export',enabled:true,run:()=>pageImageAbortRef.current?.abort()}]:[]),
      {id:'images-to-pdf',label:creatingImagePdf?'Images '+imagePdfProgress+'%':'Images to PDF…',enabled:!creatingImagePdf&&!mutating,disabledReason:creatingImagePdf?'Image conversion is running.':mutating?'Wait for the current PDF mutation to finish.':undefined,run:()=>imagesInputRef.current?.click()},
      {id:'compare-pdf',label:comparingPdf?'Compare '+comparisonProgress+'%':'Compare PDF text…',enabled:!!pdf&&!loading&&!mutating&&!comparingPdf,disabledReason:!pdf?'Open a PDF first.':comparingPdf?'Comparison is in progress.':'Wait for the current PDF operation.',run:()=>comparisonInputRef.current?.click()},
      ...(comparingPdf?[{id:'cancel-compare',label:'Cancel comparison',enabled:true,run:()=>comparisonAbortRef.current?.abort()}]:[]),
      ...(exportingText?[{id:'cancel-text',label:'Cancel text export',enabled:true,run:()=>textExportAbortRef.current?.abort()}]:[]),
      ...(creatingImagePdf?[{id:'cancel-images',label:'Cancel image conversion',enabled:true,run:()=>imagesAbortRef.current?.abort()}]:[]),
      providerAction,
    ],
    organize:[
      {id:'open-crop-settings',label:cropMode?'Cancel crop preview':'Crop visually…',enabled:!!sourceBytes&&!mutating&&operationPages.length===1,disabledReason:!sourceBytes?'Open a PDF before cropping.':operationPages.length!==1?'Choose one page to crop.':'Wait for the current PDF edit.',run:()=>{
        if(cropMode)endCropPreview();else startCropOnPage(operationPages[0]);
      }},
      {id:'remove-pages',label:`Delete ${operationPages.length} page${operationPages.length===1?'':'s'}`,enabled:!!sourceBytes&&!mutating&&operationPages.length<pageCount,disabledReason:!sourceBytes?'No PDF is loaded.':operationPages.length>=pageCount?'A PDF must retain at least one page.':mutating?'Wait for the current PDF edit to finish.':undefined,run:removeSelectedPagesSafely},
      {id:'replace-page',label:'Replace page…',enabled:!!sourceBytes&&!mutating&&!loading&&operationPages.length===1,
        disabledReason:!sourceBytes?'Open a PDF first.':operationPages.length!==1?'Select exactly one page for replacement.':'Wait for the active PDF operation.',
        run:()=>beginReplacePage(operationPages[0])},
      {id:'copy-page',label:'Duplicate page',enabled:!!sourceBytes&&!mutating&&operationPages.length===1,disabledReason:operationPages.length!==1?'Select exactly one page.':mutating?'Wait for the current PDF edit to finish.':!sourceBytes?'No PDF is loaded.':undefined,run:()=>mutateAction(`Duplicated page ${operationPages[0]}.`,bytes=>duplicatePdfPage(bytes,operationPages[0]),operationPages[0]+1)},
      {id:'extract-pages',label:'Extract selected',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:extractSelected},
      {id:'split',label:'Split here',enabled:!!sourceBytes&&!mutating&&currentPage<pageCount,disabledReason:!sourceBytes?'No PDF is loaded.':currentPage>=pageCount?'Move before the final page to split the PDF.':mutating?'Wait for the current PDF edit to finish.':undefined,run:splitCurrent},
      {id:'insert',label:'Insert PDF…',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>insertInputRef.current?.click()},
      {id:'append',label:'Append PDF…',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>appendInputRef.current?.click()},
      {id:'blank',label:'Blank after',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'No PDF is loaded.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction(`Inserted a blank page after page ${currentPage}.`,bytes=>insertBlankPdfPage(bytes,currentPage),currentPage+1)},
      {id:'page-labels',label:'Set page label',enabled:!!sourceBytes&&!mutating,disabledReason:!sourceBytes?'Open a PDF first.':'Wait for PDF edit.',run:applyPageLabel},
      {id:'earlier',label:'Move earlier',enabled:!!sourceBytes&&!mutating&&operationPages.length===1&&operationPages[0]>1,disabledReason:!sourceBytes?'No PDF is loaded.':operationPages.length!==1?'Select exactly one page.':operationPages[0]<=1?'The first page cannot move earlier.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction('Moved page earlier.',bytes=>movePdfPage(bytes,operationPages[0],operationPages[0]-1),operationPages[0]-1)},
      {id:'later',label:'Move later',enabled:!!sourceBytes&&!mutating&&operationPages.length===1&&operationPages[0]<pageCount,disabledReason:!sourceBytes?'No PDF is loaded.':operationPages.length!==1?'Select exactly one page.':operationPages[0]>=pageCount?'The final page cannot move later.':mutating?'Wait for the current PDF edit to finish.':undefined,run:()=>mutateAction('Moved page later.',bytes=>movePdfPage(bytes,operationPages[0],operationPages[0]+1),operationPages[0]+1)},
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
      navigateAction('Open Sign workspace','sign'),
      {id:'signatures-panel',label:'Signature fields',enabled:true,run:()=>openLeftPanel('signatures')},
      providerAction,
    ],
    forms:[
      {id:'add-form-field',label:`Add ${formDraft.type} field`,enabled:!!sourceBytes&&!mutating&&!!formDraft.name.trim(),disabledReason:!sourceBytes?'No PDF is loaded.':!formDraft.name.trim()?'Enter a field name in Form settings first.':mutating?'Wait for the current PDF edit to finish.':undefined,run:addFormField},
      {id:'fill-form',label:'Apply field values',enabled:!!sourceBytes&&!mutating&&fillableFormFields.length>0,disabledReason:!sourceBytes?'No PDF is loaded.':!fillableFormFields.length?'No editable AcroForm fields are present.':mutating?'Wait for the current PDF edit to finish.':undefined,run:fillForm},
      {id:'flatten-form',label:'Flatten fields',enabled:!!sourceBytes&&!mutating&&formFields.length>0,disabledReason:!sourceBytes?'No PDF is loaded.':!formFields.length?'No AcroForm fields are present.':mutating?'Wait for the current PDF edit to finish.':undefined,run:flattenForm},
      {id:'configure-forms',label:'Form settings',enabled:true,run:configureProperties},
      providerAction,
    ],
    ai:[navigateAction('Open CAD viewer','cad'),navigateAction('Open DICOM viewer','dicom'),providerAction],
    scan:[navigateAction('Open Scanner','scanner'),providerAction],
    automate:[navigateAction('Open Automation Studio','automation'),providerAction],
  };
  const directoryVisible=USER_PDF_TOOLS.filter(tool=>
    (tool.label+' '+tool.group).toLowerCase().includes(featureGallerySearch.trim().toLowerCase()));
  const directoryAction=(id:string,category:PdfTaskCategory)=>
    taskActions[category].find(action=>action.id===id);
  const plannedForMaster=masterTab==='tools'?[]
    :masterTab==='protect'?[...plannedPdfFeatures('protect'),...plannedPdfFeatures('sign')]
    :plannedPdfFeatures(taskCategory);
  const plannedActions:PdfToolbarAction[]=plannedForMaster.map(feature=>({
    id:feature.id,label:feature.label,enabled:false,disabledReason:feature.reason,planned:true,
    run:()=>undefined,
  }));
  // Real verified commands must precede planned placeholders so Rotate and
  // editing actions are visible immediately, not buried behind disabled tiles.
  const activeTaskActions=[...taskActions[taskCategory],...plannedActions]
    .filter(action=>action.id!=='local-provider-tools'||masterTab==='tools');
  // Show as many commands as the measured reader width comfortably fits
  // (about 92 px each) before using More; wide screens no longer hide 7 of
  // 12 Organize commands behind an overflow menu.
  const ribbonVisibleCount=viewport.width<540?2:viewport.width<900?3:Math.max(5,Math.min(14,Math.floor((viewport.width-260)/92)));
  const primaryTaskActions=activeTaskActions.slice(0,ribbonVisibleCount);
  const overflowTaskActions=activeTaskActions.slice(ribbonVisibleCount);
  const shortActionLabel=(action:PdfToolbarAction)=>action.label
    .replace(/^Local tools$/,'Local').replace(/^PDF to /,'To ').replace(/^Open /,'').replace(/^Show /,'')
    .replace(/^Hide /,'').replace(/^Add /,'').replace(/\u2026/g,'')
    .replace(/\s*\(\.txt\)/,'').replace(/\s*ZIP$/,'')
    .slice(0,20);
  const taskActionTitle=(action:PdfToolbarAction)=>action.enabled?action.label:`${action.label} — ${action.disabledReason??'Unavailable'}`;
  const focusMasterTab=(tab:PdfMasterTab)=>{
    setMasterTab(tab);
    setTaskCategory(PDF_MASTER_TABS.find(item=>item.id===tab)!.category);
    setFeatureGalleryOpen(false);
    window.requestAnimationFrame(()=>document.getElementById(`${domIdPrefix}-task-${tab}`)?.focus());
  };

  return <div ref={workspaceRef} className={`pdf-workspace${presentationMode?' presentation-mode':''}`}
    data-pdf-first-rendered={firstPdfPagePainted?'true':'false'}
    data-pdf-secondary-inspection={deferredInspectionBytes?'ready':sourceBytes?'deferred':'unloaded'}>
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
      ref={replaceInputRef}
      className="visually-hidden"
      type="file"
      accept="application/pdf,.pdf"
      aria-label="Select PDF to replace page"
      onChange={(event)=>void replaceSelectedPdfPage(event)}
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
        {PDF_MASTER_TABS.map((tab)=><button
          id={`${domIdPrefix}-task-${tab.id}`}
          key={tab.id}
          role="tab"
          aria-selected={masterTab===tab.id}
          aria-controls={`${domIdPrefix}-task-tools`}
          aria-keyshortcuts={tab.shortcut}
          tabIndex={masterTab===tab.id?0:-1}
          className={masterTab===tab.id?'active':''}
          title={`${tab.label} · ${tab.shortcut}`}
          onClick={()=>{setMasterTab(tab.id);setTaskCategory(tab.category);setFeatureGalleryOpen(false);if(tab.id==='organize')openLeftPanel('pages');else endCropPreview();}}
          onKeyDown={(event)=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
            event.preventDefault();
            focusMasterTab(moveMasterPdfTab(masterTab,event.key as 'ArrowLeft'|'ArrowRight'|'Home'|'End'));
          }}
        >{tab.label}</button>)}
      </div>

      {masterTab==='organize'&&pdf&&<section className="pdf-organize-page-picker" aria-label="Choose pages to edit">
        <strong>Editing {singleEditTarget!==null?`page ${singleEditTarget}`:`${operationPages.length} selected pages`}</strong>
        <label>Go to page <input type="number" min={1} max={pageCount} step={1}
          aria-label="Page number to edit"
          value={editPageInput}
          onChange={event=>setEditPageInput(event.target.value)}
          onBlur={event=>commitEditPageInput(event.currentTarget.value)}
          onKeyDown={event=>{
            if(event.key==='Enter'){event.preventDefault();commitEditPageInput(event.currentTarget.value);event.currentTarget.blur();}
            if(event.key==='Escape'){setEditPageInput(singleEditTarget===null?'':String(singleEditTarget));event.currentTarget.blur();}
          }}/></label>
        <button type="button" onClick={()=>chooseEditPage(currentPage)}
          disabled={singleEditTarget===currentPage}>Edit the page I'm viewing ({currentPage})</button>
        <button type="button" onClick={()=>openLeftPanel('pages')}>Select pages from thumbnails</button>
        <div role="group" aria-label="Quick page editing actions" className="pdf-organize-quick-actions">
          <button type="button" disabled={mutating||loading||singleEditTarget===null}
            onClick={()=>{if(singleEditTarget!==null)beginReplacePage(singleEditTarget);}}>
            Replace {singleEditTarget!==null?`page ${singleEditTarget}`:'one page'}…</button>
          <button type="button" disabled={mutating||loading||singleEditTarget===null}
            onClick={()=>{if(singleEditTarget!==null)startCropOnPage(singleEditTarget);}}>
            Crop {singleEditTarget!==null?`page ${singleEditTarget}`:'one page'}…</button>
          <button type="button" disabled={mutating||loading||operationPages.length>=pageCount}
            onClick={()=>void removeSelectedPagesSafely()}>
            Delete {operationPages.length===1?`page ${operationPages[0]}`:`${operationPages.length} pages`}…</button>
        </div>
        <small role="note">Select a page on the PDF or in thumbnails. Changes appear in the editor; Undo restores the previous version. Original file is unchanged.</small>
      </section>}
      <div id={`${domIdPrefix}-task-tools`} className="pdf-context-toolbar" role="toolbar" aria-label={`${PDF_MASTER_TABS.find(item=>item.id===masterTab)!.label} PDF tools`}>
        <div className="pdf-task-actions">
          <button type="button" className="pdf-feature-index-trigger"
            aria-label="Browse all PDF features"
            title="Browse PDF features and availability"
            aria-expanded={featureGalleryOpen}
            aria-controls={`${domIdPrefix}-feature-gallery`}
            onClick={()=>setFeatureGalleryOpen(value=>!value)}>
            <FileText size={19} aria-hidden="true"/>
            <span className="pdf-feature-caption">Features</span>
          </button>
          {primaryTaskActions.map((action)=><span
            className={'pdf-feature-command'+(action.planned?' planned':'')}
            key={action.id}
            data-pdf-feature={action.id}
            title={taskActionTitle(action)}
            aria-label={action.planned?action.label+' — Not available yet':undefined}>
            <button type="button"
              disabled={!action.enabled}
              aria-label={taskActionTitle(action)}
              title={taskActionTitle(action)}
              onClick={()=>{void action.run();}}>
              <PdfFeatureIcon id={action.id} label={action.label}/>
              <span className="pdf-feature-caption">{shortActionLabel(action)}</span>
            </button>
            {action.planned&&<span className="pdf-feature-planned-dot" aria-hidden="true"/>}
          </span>)}
          {!activeTaskActions.length&&<span className="pdf-task-empty">No operational {PDF_MASTER_TABS.find(item=>item.id===masterTab)!.label.toLowerCase()} commands are available in this build yet. Use Ctrl+K to discover available document actions.</span>}
          {overflowTaskActions.length>0&&<details className="pdf-task-overflow">
            <summary aria-label={`More ${PDF_MASTER_TABS.find(item=>item.id===masterTab)!.label} tools`}>More</summary>
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


      </div>
      {featureGalleryOpen&&<section id={`${domIdPrefix}-feature-gallery`}
        className="pdf-feature-gallery"
        aria-label={`${PDF_MASTER_TABS.find(item=>item.id===masterTab)!.label} PDF features`}
        onKeyDown={event=>{if(event.key==='Escape'){setFeatureGalleryOpen(false);event.stopPropagation();}}}>
        <header>
          <div><strong>PDF features</strong>
            <p>Browse 90 Master v2 features or the 33 existing PDF tool shortcuts. Unverified commands remain disabled.</p></div>
          <button type="button" onClick={()=>setFeatureGalleryOpen(false)}
            aria-label="Close PDF features" title="Close PDF features">×</button>
        </header>
        <div className="pdf-feature-gallery-tabs" role="group" aria-label="PDF feature view">
          <button type="button" aria-pressed={featureGalleryMode==='category'}
            onClick={()=>setFeatureGalleryMode('category')}>Current ribbon</button>
          <button type="button" aria-pressed={featureGalleryMode==='all'}
            onClick={()=>setFeatureGalleryMode('all')}>33 tool shortcuts</button>
          <button type="button" aria-pressed={featureGalleryMode==='master'}
            onClick={()=>{setFeatureGalleryMode('master');setFeatureGallerySearch('');}}>All 90 PDF features</button>
        </div>
        {featureGalleryMode==='master' ? <div className="pdf-user-tool-directory" data-feature-index="MAL-001-MAL-090">
          <label htmlFor={`${domIdPrefix}-master-search`}>Find a MALENJO feature</label>
          <input id={`${domIdPrefix}-master-search`} type="search"
            value={featureGallerySearch} onChange={event=>setFeatureGallerySearch(event.target.value)}
            placeholder="Search MAL-001…MAL-090"/>
          {PDF_MASTER_TABS.map(({label})=>{
            const commands=PDF_COMMANDS.filter(command=>command.category===label &&
              (command.id+' '+command.label+' '+command.requirementGroup)
                .toLowerCase().includes(featureGallerySearch.trim().toLowerCase()));
            if(!commands.length)return null;
            return <section className="pdf-user-tool-group" key={label} aria-label={label+' PDF feature requirements'}>
              <h3>{label} · {commands.length}</h3>
              <div className="pdf-feature-gallery-grid">
                {commands.map(command=><span key={command.id} data-mal-command={command.id}
                  className="pdf-feature-gallery-cell planned" tabIndex={0}
                  role="group" aria-label={command.id+' '+command.label+' — Not release-ready'}
                  title={command.tooltip}>
                  <button type="button" disabled
                    title={command.tooltip}
                    aria-label={command.id+' '+command.label+' — Not release-ready'}>
                    <PdfFeatureIcon id={command.id} label={command.label} size={22}/>
                    <span className="pdf-feature-gallery-label">{command.label}</span>
                    <small>{command.id} · Not ready</small>
                  </button>
                </span>)}
              </div>
            </section>;
          })}
          {!PDF_COMMANDS.some(command=>(command.id+' '+command.label+' '+command.requirementGroup)
            .toLowerCase().includes(featureGallerySearch.trim().toLowerCase()))&&
            <p role="status">No PDF features match your search.</p>}
        </div> : featureGalleryMode==='all' ? <div className="pdf-user-tool-directory">
          <label htmlFor={`${domIdPrefix}-feature-search`}>Find PDF tool</label>
          <input id={`${domIdPrefix}-feature-search`} type="search"
            placeholder="Search all PDF features"
            value={featureGallerySearch} onChange={event=>setFeatureGallerySearch(event.target.value)}/>
          {USER_PDF_TOOL_GROUPS.map(group=>{
            const tools=directoryVisible.filter(tool=>tool.group===group);
            if(!tools.length)return null;
            return <section className="pdf-user-tool-group" key={group} aria-label={group}>
              <h3>{group}</h3>
              <div className="pdf-feature-gallery-grid">
                {tools.map(tool=>{
                  const action=tool.actionId ? directoryAction(tool.actionId,tool.category) : undefined;
                  const canOrganize=tool.id==='organize-pdf' && !!pdf;
                  const canNavigate=!!tool.destination && !!onNavigateModule;
                  const enabled=canOrganize||canNavigate||Boolean(action?.enabled);
                  const reason=action?.disabledReason ?? tool.explanation;
                  return <span key={tool.id} data-user-pdf-tool={tool.id}
                    className={'pdf-feature-gallery-cell'+(!enabled?' planned':'')}
                    title={enabled?tool.explanation:tool.label+' — '+reason}>
                    <button type="button" disabled={!enabled}
                      aria-label={tool.label + (enabled?'':' — Unavailable: '+reason)}
                      title={enabled?tool.explanation:'Unavailable: '+reason}
                      onClick={()=>{
                        if(!enabled)return;
                        setFeatureGalleryOpen(false);
                        setTaskCategory(tool.category);
                      setMasterTab(masterTabForCategory(tool.category));
                        if(canOrganize){openLeftPanel('pages');return;}
                        if(tool.destination){onNavigateModule?.(tool.destination);return;}
                        if(action)void action.run();
                      }}>
                      <PdfFeatureIcon id={tool.id} label={tool.label} size={22}/>
                      <span className="pdf-feature-gallery-label">{tool.label}</span>
                      <small>{enabled?'Open tool':'Not ready'}</small>
                    </button>
                  </span>;
                })}
              </div>
            </section>;
          })}
          {!directoryVisible.length&&<p role="status">No matching PDF tools.</p>}
        </div> : <div className="pdf-feature-gallery-grid">
          {activeTaskActions.map(action=><span className={'pdf-feature-gallery-cell'+(action.planned?' planned':'')}
            key={action.id} data-pdf-feature={action.id} title={taskActionTitle(action)}>
            <button type="button" disabled={!action.enabled}
              title={taskActionTitle(action)}
              aria-label={taskActionTitle(action)}
              onClick={()=>{setFeatureGalleryOpen(false);void action.run();}}>
              <PdfFeatureIcon id={action.id} label={action.label} size={22}/>
              <span className="pdf-feature-gallery-label">{action.label}</span>
              <small>{action.planned?'Not ready':action.enabled?'Available':'Unavailable now'}</small>
            </button>
          </span>)}
        </div>}
      </section>}
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
      onApplyPdf={(label,bytes,expectedSource)=>{
        if(currentPdfBytesRef.current!==expectedSource||sourceBytes!==expectedSource||
          replacementPendingRef.current||mutationPendingRef.current){
          return false;
        }
        return mutate(label,async()=>bytes,currentPage);
      }}
    />}

    {(notice || actionNotice) && <div className="pdf-notice">{notice || actionNotice}</div>}
    {error && <div className="pdf-notice error" role="alert"><strong>MAL-PDF-001</strong> · {error}</div>}
    {pdf && encryptedPdf && <div className="pdf-notice pdf-encrypted-notice" role="status">
      <Lock size={14} aria-hidden="true"/> Protected PDF: you can read, search, zoom and print it. Editing is off because the file is encrypted; remove its password or restrictions first, then edit the unlocked copy.
    </div>}

    {!pdf && passwordPrompt && <form className="pdf-empty pdf-password-prompt"
      aria-labelledby={`${domIdPrefix}-password-title`}
      onSubmit={(event)=>{
        event.preventDefault();
        const prompt=passwordPrompt;
        const typed=passwordDraft;
        // Clear the field immediately; the password is handed to PDF.js once.
        setPasswordDraft('');
        void installPdf(prompt.bytes,prompt.name,prompt.file,false,undefined,typed);
      }}>
      <div className="pdf-empty-icon" aria-hidden="true"><Lock size={30} strokeWidth={1.6}/></div>
      <h1 id={`${domIdPrefix}-password-title`}>Password required</h1>
      <p><strong>{passwordPrompt.name}</strong> is password-protected. Enter its password to open it. MALENJO does not save the password.</p>
      <label className="pdf-password-field">Password
        <input type="password" autoComplete="off" autoFocus value={passwordDraft}
          aria-invalid={passwordPrompt.incorrect}
          aria-describedby={passwordPrompt.incorrect?`${domIdPrefix}-password-error`:undefined}
          disabled={loading}
          onChange={(event)=>setPasswordDraft(event.target.value)}/>
      </label>
      {passwordPrompt.incorrect&&<p id={`${domIdPrefix}-password-error`} className="pdf-password-error" role="alert">Incorrect password. Check it and try again.</p>}
      <button className="primary-action" type="submit" disabled={loading||!passwordDraft}>
        <Lock size={16} aria-hidden="true"/> {loading?'Opening…':'Open PDF'}
      </button>
      <small>Protected PDFs open read-only: viewing, searching and printing work; editing needs an unlocked copy.</small>
    </form>}

    {!pdf && !passwordPrompt && <div className="pdf-empty">
      <div className="pdf-empty-icon" aria-hidden="true"><FileText size={32} strokeWidth={1.6}/></div>
      <h1>PDF Workspace</h1>
      <p>{loading
        ? 'Loading PDF with the local PDF.js renderer…'
        : 'Choose a PDF to open it in its own MALENJO document tab, where you can view, find, edit and export safely.'}</p>
      <button className="primary-action" disabled={loading} onClick={() => fileInputRef.current?.click()}>
        <FileText size={17}/> {loading ? 'Loading…' : 'Choose PDF'}
      </button>
      <small>Open more PDFs with Open File to keep them in separate document tabs.</small>
    </div>}

    {pdf && <div className={pdfLayoutClass} style={{'--ml-inspector-width':`${inspectorWidth}px`} as CSSProperties}>
      <aside className={leftPanelCollapsed ? 'pdf-left-shell collapsed' : 'pdf-left-shell'} aria-label="PDF navigation rail and panel">
        <nav className="pdf-left-rail" aria-label="PDF navigation">
          {leftPanelOrder.map(id=>{
            const item=pdfLeftPanelItem(id);
            return <button key={id} type="button"
              className={leftPanel===id?'active':''}
              aria-pressed={leftPanel===id}
              aria-label={item.label}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              title={item.label+' — drag to reorder, or Alt+Up/Down'}
              draggable
              onDragStart={event=>{draggedPanelRef.current=id;event.dataTransfer.effectAllowed='move';}}
              onDragEnd={()=>{draggedPanelRef.current=null;}}
              onDragOver={event=>event.preventDefault()}
              onDrop={event=>{
                event.preventDefault();
                if(draggedPanelRef.current)moveLeftPanel(draggedPanelRef.current,id);
                draggedPanelRef.current=null;
              }}
              onKeyDown={event=>{
                if(!event.altKey || !['ArrowUp','ArrowDown'].includes(event.key))return;
                event.preventDefault();
                const position=leftPanelOrder.indexOf(id);
                const otherPosition=position+(event.key==='ArrowUp'?-1:1);
                if(otherPosition>=0&&otherPosition<leftPanelOrder.length){
                  setLeftPanelOrder(current=>{
                    const next=[...current];
                    [next[position],next[otherPosition]]=[next[otherPosition],next[position]];
                    return next;
                  });
                }
              }}
              onClick={()=>{setLeftPanel(id);setInspectorHidden(true);setLeftPanelCollapsed(false);}}
            ><PdfLeftPanelIcon id={id}/><span className="pdf-left-nav-label">{item.label}</span></button>;
          })}
          <button
            className="pdf-left-collapse"
            aria-label={leftPanelCollapsed?'Expand PDF navigation panel':'Collapse PDF navigation panel'}
            title={leftPanelCollapsed?'Expand panel':'Collapse panel'}
            onClick={()=>{setInspectorHidden(true);setLeftPanelCollapsed((value)=>!value);}}
          >{leftPanelCollapsed?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</button>
        </nav>

        {!leftPanelCollapsed&&<section className="pdf-left-panel" aria-label={`${pdfLeftPanelItem(leftPanel).label} panel`}>
          <div className="pdf-left-panel-title">
            <b>{pdfLeftPanelItem(leftPanel).label}</b>
            <span>{pdfLeftPanelItem(leftPanel).description}</span>
          </div>

          {leftPanel==='pages'&&<div className="pdf-left-panel-body pdf-pages-panel">
            <div className="pdf-selection-bar">
              <span>{selectedPageNumbers.length || 1} selected. Click thumbnails; Ctrl/Cmd-click adds pages.</span>
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
                  renderAllowed={active&&thumbnailsRenderAllowed}
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
            <div className="pdf-find" role="search" aria-label="Find words inside PDF">
              <div><Search size={14}/><input ref={searchInputRef} value={searchQuery} onChange={(event)=>{
                searchSequenceRef.current++;
                setSearching(false);
                setSearchQuery(event.target.value);
                setSearchResults([]);
                setHighlightQuery('');
                setSearchStatus('');
              }} onKeyDown={(event)=>{if(event.key==='Enter')void searchPdf();}} placeholder="Find words in this PDF…" aria-label="Find PDF text"/></div>
              <button disabled={searching||!searchQuery.trim()} onClick={()=>void searchPdf()}>{searching?'Searching…':'Find in PDF'}</button>
              <p className="pdf-search-help">Select or copy words directly on a PDF page. Press Ctrl+F to search. Scanned image pages need OCR.</p>
              {searchStatus&&<p className="pdf-search-status" role="status">{searchStatus}</p>}
              {!!searchResults.length&&<div className="pdf-search-results" aria-label="PDF text matches">{searchResults.map((result)=><button key={result.page} onClick={()=>goToPage(result.page)}><b>Page {result.page} · {result.matches} match{result.matches===1?'':'es'}</b><span>{result.excerpt}</span></button>)}</div>}
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
              <div className="pdf-edit-form">
                <b>PDF page links</b>
                <small>Create a PDF-native clickable region on the current page. HTTPS URLs are never opened automatically by MALENJO.</small>
                <label>Destination<select value={linkDraft.targetKind} onChange={event=>setLinkDraft({...linkDraft,targetKind:event.target.value as PdfLinkTarget['kind']})}>
                  <option value="page">Internal page</option>
                  <option value="https">HTTPS website</option>
                </select></label>
                {linkDraft.targetKind==='page'
                  ? <label>Destination page<input type="number" min="1" max={pageCount} step="1" value={linkDraft.targetPage} onChange={event=>setLinkDraft({...linkDraft,targetPage:Number(event.target.value)})}/></label>
                  : <label>HTTPS URL<input type="url" maxLength={2000} placeholder="https://example.com" value={linkDraft.url} onChange={event=>setLinkDraft({...linkDraft,url:event.target.value})}/></label>}
                <div className="pdf-coordinate-grid">
                  {(['x','y','width','height'] as const).map(key=><label key={key}>{key}<input type="number" min="0" max="1" step="0.01" value={linkDraft[key]} onChange={event=>setLinkDraft({...linkDraft,[key]:Number(event.target.value)})}/></label>)}
                </div>
                <button disabled={!sourceBytes||mutating||linksLoading} onClick={()=>void addCurrentPageLink()}>Create link on page {currentPage}</button>
                <b>Existing page links ({pdfLinks.length})</b>
                {linksLoading&&<small role="status">Reading PDF links…</small>}
                {linksError&&<small role="alert">{linksError}</small>}
                {!linksLoading&&!linksError&&!pdfLinks.length&&<small>No link annotations in this PDF.</small>}
                {pdfLinks.slice(0,80).map(item=><div className="pdf-left-info" key={item.pageNumber+'-'+item.index+'-'+item.ref}>
                  <strong>Page {item.pageNumber} · {item.kind==='page'?'Go to page':item.kind==='https'?'HTTPS':'Unsupported action'}</strong>
                  <small>{item.destination}</small>
                  <div>
                    <button onClick={()=>goToPage(item.pageNumber)}>Show source page</button>
                    {item.kind==='page'&&<button onClick={()=>goToPage(Number(item.destination))}>Go to destination</button>}
                    <button disabled={!item.ref||item.kind==='unsupported'||mutating} onClick={()=>editPdfLink(item)}>Edit destination</button>
                    <button disabled={!item.ref||mutating} onClick={()=>void removePdfLink(item)}>Delete link</button>
                  </div>
                  {linkEdit?.item.ref===item.ref&&linkEdit?.item.pageNumber===item.pageNumber&&linkEdit.item.index===item.index&&<div>
                    <label>Destination<select value={linkEdit.targetKind} onChange={event=>setLinkEdit({...linkEdit,targetKind:event.target.value as PdfLinkTarget['kind']})}>
                      <option value="page">Internal page</option>
                      <option value="https">HTTPS website</option>
                    </select></label>
                    {linkEdit.targetKind==='page'
                      ? <label>Page<input type="number" min="1" max={pageCount} step="1" value={linkEdit.targetPage} onChange={event=>setLinkEdit({...linkEdit,targetPage:Number(event.target.value)})}/></label>
                      : <label>HTTPS URL<input type="url" maxLength={2000} value={linkEdit.url} onChange={event=>setLinkEdit({...linkEdit,url:event.target.value})}/></label>}
                    <button disabled={mutating} onClick={()=>void applyPdfLinkEdit()}>Save link</button>
                    <button onClick={()=>setLinkEdit(null)}>Cancel</button>
                  </div>}
                </div>)}
                {pdfLinks.length>80&&<small>Showing 80 of {pdfLinks.length} links. Remaining links are preserved.</small>}
                <small>Imported JavaScript, file, and unsupported PDF actions cannot be edited or opened here. New and edited destinations allow only internal pages or HTTPS.</small>
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

      <div ref={scrollRef} className="pdf-scroll" tabIndex={0}
        aria-label="Scrollable PDF pages. Page Up/Down and arrow keys navigate. Plus/minus zoom; 0 actual size, W fit width, F fit page; F9 presents."
        onWheelCapture={releasePageJumpOnManualScroll}
        onTouchStartCapture={releasePageJumpOnManualScroll}
        onPointerDownCapture={releasePageJumpOnManualScroll}
        onScroll={releaseJumpIfTargetLeftView}
        onKeyDown={event=>{
          if(event.target!==event.currentTarget || event.altKey || event.metaKey)return;
          if(event.key==='PageDown'||event.key==='PageUp'||event.key==='ArrowRight'||event.key==='ArrowLeft'){
            event.preventDefault();goToPage(currentPage+(['PageDown','ArrowRight'].includes(event.key)?1:-1));
          }else if(event.key==='Home'&&event.ctrlKey){
            event.preventDefault();goToPage(1);
          }else if(event.key==='End'&&event.ctrlKey){
            event.preventDefault();goToPage(pageCount);
          }else if(!event.ctrlKey&&!event.shiftKey && (event.key==='+'||event.key==='=')){
            event.preventDefault();void zoomByStep(1);
          }else if(!event.ctrlKey&&!event.shiftKey && event.key==='-'){
            event.preventDefault();void zoomByStep(-1);
          }else if(!event.ctrlKey && event.key==='0'){
            event.preventDefault();setFitMode('custom');setZoom(1);
          }else if(!event.ctrlKey && event.key.toLowerCase()==='w'){
            event.preventDefault();setFitMode('width');
          }else if(!event.ctrlKey && event.key.toLowerCase()==='f'){
            event.preventDefault();setFitMode('page');
          }else if(!event.ctrlKey&&event.key==='F9'){
            event.preventDefault();void toggleFullscreen(true);
          }
        }}>
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
              forceRender={active&&forceRenderAll}
              renderAllowed={active&&(forceRenderAll || schedule.allowed)}
              eager={active&&(forceRenderAll || schedule.eager)}
              domIdPrefix={domIdPrefix}
              highlightQuery={highlightQuery}
              links={pdfLinks}
              onActivateLink={activatePdfLink}
              onVisible={onPageVisible}
              onRendered={onPageRendered}
              onReleased={onPageReleased}
              showEditSelection={masterTab==='organize'}
              selectedForEdit={selectedPages.has(page)}
              onSelectForEdit={()=>chooseEditPage(page)}
              cropMode={cropMode&&page===cropTargetPage&&Boolean(cropGeometry?.visualSupported)&&rotation===0}
              cropPreview={page===cropTargetPage?cropPreview:null}
              onCropSelection={chooseCropRectangle}
              onDeletePage={()=>void removePagesSafely([page])}
              onReplacePage={()=>beginReplacePage(page)}
              onCropPage={()=>startCropOnPage(page)}
              editingBusy={mutating||loading}
            />;
          })}
        </div>
      </div>

      {!inspectorHidden&&<aside className="pdf-inspector" aria-label="Left document properties and edit inspector">
        <div className="pdf-inspector-resize-handle" role="separator" tabIndex={0}
          aria-orientation="vertical" aria-label="Resize document properties panel"
          aria-valuemin={180} aria-valuemax={440} aria-valuenow={inspectorWidth}
          title="Drag to resize Properties, or use Left/Right arrow keys"
          onKeyDown={event=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
            event.preventDefault();
            if(event.key==='Home')setInspectorWidth(180);
            else if(event.key==='End')setInspectorWidth(440);
            else setInspectorWidth(width=>Math.max(180,Math.min(440,width+(event.key==='ArrowRight'?16:-16))));
          }}
          onPointerDown={event=>{
            if(event.button!==0)return;
            inspectorResizeRef.current={startX:event.clientX,startWidth:inspectorWidth};
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={event=>{
            const drag=inspectorResizeRef.current;
            if(!drag)return;
            setInspectorWidth(Math.max(180,Math.min(440,drag.startWidth+event.clientX-drag.startX)));
          }}
          onPointerUp={event=>{
            inspectorResizeRef.current=null;
            if(event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={()=>{inspectorResizeRef.current=null;}}
        />
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
            aria-label="Hide left document inspector"
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
           <div><dt>History</dt><dd>{historyRef.current?`${historyRef.current.cursor} undo step(s) available · ${formatBytes(historyRef.current.totalBytes)} (up to 30, memory-limited)`:'—'}</dd></div>
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

          <button disabled={mutating||!formDraft.name.trim()} title={formDraft.name.trim()?undefined:'Enter a field name first.'} onClick={()=>void addFormField()}>Add {formDraft.type} field</button>

          <div className="pdf-feature-list pdf-form-inventory">
            <b>{formFields.length} AcroForm field{formFields.length===1?'':'s'}</b>
            {formFields.map((field)=><span key={field.name} title={field.options.length?field.options.join(', '):undefined}>
              <strong>{field.name}</strong>
              <em>{field.type}{field.required?' · required':''}{field.readOnly?' · read-only':''}{field.password?' · password':''}{field.multiline?' · multiline':''}{field.richText?' · rich-text unsupported':''}{field.multiselect?' · multiselect':''}{field.editable?' · editable':''}{field.duplicateChoiceExports?' · duplicate exports unsupported':''}{field.type==='radio'&&!field.offToggleable?' · cannot clear':''}{field.type==='text'&&!field.password&&!field.richText&&field.value?` · value: ${field.value}`:''}{field.type==='checkbox'?` · ${field.checked?'checked':'unchecked'}`:''}{field.selected.length?` · selected: ${field.selected.map((value)=>field.choiceOptions.find((option)=>option.value===value)?.label??value).join(', ')}`:''}</em>
            </span>)}
          </div>

          <div className="pdf-edit-form">
            <b>Manage existing AcroForm field</b>
            <small>Change the required/read-only flags or remove a field from this PDF. Signatures, XFA and unsupported structures are protected. Use Undo if needed.</small>
            <label>Field<select value={managedFormField?.name??''} disabled={mutating||formInspectedSource!==sourceBytes} onChange={event=>chooseManagedFormField(event.target.value)}>
              <option value="">— Choose existing field —</option>
              {formFields.filter(field=>field.type!=='signature').map(field=><option key={field.name} value={field.name}>{field.name} · {field.type}</option>)}
            </select></label>
            {managedFormField&&<>
              <label><input type="checkbox" checked={managedFormField.required} onChange={event=>setManagedFormField({...managedFormField,required:event.target.checked})}/> Required</label>
              <label><input type="checkbox" checked={managedFormField.readOnly} onChange={event=>setManagedFormField({...managedFormField,readOnly:event.target.checked})}/> Read-only</label>
              <button disabled={mutating||formInspectedSource!==sourceBytes} onClick={()=>void applyManagedFormFlags()}>Apply field flags</button>
              <button disabled={mutating||formInspectedSource!==sourceBytes} onClick={()=>void removeManagedFormField()}>Delete field and widgets</button>
            </>}
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

        <div className="pdf-pane-title">Crop and page boxes</div>
        <div className="pdf-edit-form">
          <small>Crop is non-destructive to the original file. Choose a page, drag a rectangle directly over the live page, then Apply crop. Before applying, the shaded area is a preview only.</small>
          <button type="button" disabled={!sourceBytes||mutating||loading}
            onClick={()=>{if(cropMode)endCropPreview();else startCropOnPage(operationPages.length===1?operationPages[0]:currentPage);}}>
            {cropMode?'Cancel crop preview':'Draw crop on page '+(operationPages.length===1?operationPages[0]:currentPage)}</button>
          {cropMode&&<small role="status">{!cropGeometry?'Preparing crop preview…'
            :cropGeometry.visualSupported&&rotation===0?'Drag across the displayed page. Adjust the four margins below; the outline updates live.'
            :cropGeometry.reason||'Reset the viewer rotation before drawing. Numeric margins remain available.'}</small>}
          <label>Measurements <select value={cropUnit} onChange={event=>setCropUnit(event.target.value as CropUnit)}
            aria-label="Crop measurement unit">
            <option value="mm">Millimeters (mm)</option>
            <option value="cm">Centimeters (cm)</option>
            <option value="in">Inches (in)</option>
          </select></label>
          <label>Apply to<select value={pageBoxDraft.scope}
            onChange={event=>setPageBoxDraft({...pageBoxDraft,scope:event.target.value as 'selected'|'all'})}>
            <option value="selected">Selected pages</option><option value="all">All pages</option>
          </select></label>
          <label>Page box<select value={pageBoxDraft.box}
            onChange={event=>setPageBoxDraft({...pageBoxDraft,box:event.target.value as 'crop'|'trim'|'bleed'|'art'})}>
            <option value="crop">Crop (visible page)</option>
            <option value="trim">Trim (print production)</option>
            <option value="bleed">Bleed (print production)</option>
            <option value="art">Art (print production)</option>
          </select></label>
          <div className="pdf-coordinate-grid">
            {(['top','right','bottom','left'] as const).map(side=><label key={side}>
              {side.charAt(0).toUpperCase()+side.slice(1)} ({cropUnit})
              <input type="number" min="0" step="0.1" aria-label={`Crop ${side} in ${cropUnit}`}
                value={Number(cropPointsToUnit(pageBoxDraft[side],cropUnit).toFixed(2))}
                onChange={event=>{
                  setPageBoxDraft(draft=>({...draft,[side]:cropUnitToPoints(Number(event.target.value),cropUnit)}));
                  if(pageBoxDraft.box==='crop'){
                    setCropTargetPage(operationPages.length===1?operationPages[0]:currentPage);
                    setCropMode(true);
                  }
                }}/>
            </label>)}
          </div>
          <button disabled={!sourceBytes||mutating||loading} onClick={()=>void applyPageBox()}>
            Apply {pageBoxDraft.box==='crop'?'crop':'page box'} to {pageBoxDraft.scope==='selected'?operationPages.length:pageCount} page(s)
          </button>
          {cropMode&&<button type="button" onClick={()=>{endCropPreview();setPageBoxDraft(d=>({...d,top:0,right:0,bottom:0,left:0}));}}>Cancel crop preview</button>}
          <small>Measurements are in {cropUnit}. The preview shows the crop rectangle before committing; only Apply changes the working PDF. Undo and Save PDF copy operate on the committed result. Existing cropped/rotated pages use numeric inputs for safety.</small>
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
          <button disabled={mutating||operationPages.length>=pageCount} onClick={()=>void removeSelectedPagesSafely()}>Remove selected pages…</button>
          <button disabled={mutating||operationPages.length!==1} onClick={()=>void mutate(`Duplicated page ${operationPages[0]}.`,bytes=>duplicatePdfPage(bytes,operationPages[0]),operationPages[0]+1)}>Duplicate</button>
          <button disabled={mutating||operationPages.length!==1||operationPages[0]<=1} onClick={()=>void mutate('Moved page earlier.',bytes=>movePdfPage(bytes,operationPages[0],operationPages[0]-1),operationPages[0]-1)}>Move earlier</button>
          <button disabled={mutating||operationPages.length!==1||operationPages[0]>=pageCount} onClick={()=>void mutate('Moved page later.',bytes=>movePdfPage(bytes,operationPages[0],operationPages[0]+1),operationPages[0]+1)}>Move later</button>
          <button disabled={mutating} onClick={()=>void mutate(`Inserted a blank page after page ${currentPage}.`,bytes=>insertBlankPdfPage(bytes,currentPage),currentPage+1)}>Blank after</button>
          <button disabled={mutating} onClick={()=>void extractSelected()}>Extract selected</button>
          <button disabled={mutating} onClick={()=>insertInputRef.current?.click()}>Insert PDF here…</button>
          <button disabled={mutating||currentPage>=pageCount} onClick={()=>void splitCurrent()}>Split here</button>
          <button disabled={mutating} onClick={()=>appendInputRef.current?.click()}>Append PDF…</button>
        </div>
        <div className="pdf-edit-note">Choose a page number or click Select on a viewed page. Ctrl/Cmd-click thumbnails to select multiple pages. Your source file stays unchanged; Save PDF copy exports edits.</div>

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
    {pdf && <footer className="pdf-reader-footer" aria-label="PDF page navigation and view controls">
        <div className="pdf-view-controls">
          <div className="pdf-toolbar-group pdf-page-nav">
            <button type="button" disabled={!pdf}
              aria-label={leftPanelCollapsed?'Show document navigation':'Hide document navigation'}
              title={leftPanelCollapsed?'Show pages panel':'Hide pages panel'}
              onClick={()=>{setLeftPanel('pages');setInspectorHidden(true);setLeftPanelCollapsed((value)=>!value);}}>
              <FileText size={17} aria-hidden="true"/>
            </button>
            <button disabled={!pdf || currentPage <= 1} onClick={() => goToPage(currentPage - 1)} aria-label="Previous page"><ChevronLeft size={16}/></button>
            <input
              aria-label="Current PDF page"
              disabled={!pdf}
              inputMode="numeric"
              value={pdf ? (pageDraft ?? String(currentPage)) : ''}
              onFocus={(event) => { setPageDraft(String(currentPage)); event.currentTarget.select(); }}
              onChange={(event) => setPageDraft(event.target.value)}
              onBlur={() => {
                const target = pageDraft === null ? null : parsePdfPageDraft(pageDraft, pageCount);
                setPageDraft(null);
                if (target !== null && target !== currentPage) goToPage(target);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const target = pageDraft === null ? null : parsePdfPageDraft(pageDraft, pageCount);
                  // Commit, then show the live page again. Invalid input
                  // simply reverts to the current page instead of page 1.
                  if (target !== null) goToPage(target);
                  setPageDraft(null);
                } else if (event.key === 'Escape') {
                  setPageDraft(null);
                  event.currentTarget.blur();
                }
              }}
            />
            <span>/ {pageCount || '—'}</span>
            <button disabled={!pdf || currentPage >= pageCount} onClick={() => goToPage(currentPage + 1)} aria-label="Next page"><ChevronRight size={16}/></button>
          </div>
          <div className="pdf-toolbar-group">
            <span aria-label={`Pages selected for editing: ${selectedPageNumbers.join(', ')||'none'}`}
              title={`Edits target selected page(s): ${selectedPageNumbers.join(', ')||'none'}`}>
              Edit: {selectedPageNumbers.length>3
                ? selectedPageNumbers.length+' pages'
                : selectedPageNumbers.join(', ')||'none'}
            </span>
            <button disabled={!pdf||selectedPageNumbers.length===1&&selectedPageNumbers[0]===currentPage}
              aria-label="Select current viewed page for editing"
              title="Switch editing selection to the page you are viewing"
              onClick={()=>{
                selectionAnchorRef.current=currentPage;
                setSelectedPages(new Set([currentPage]));
              }}>Select viewed</button>
            <button disabled={!pdf} className={leftPanel==='search'&&!leftPanelCollapsed?'active':''}
              onClick={()=>{
                setLeftPanel('search');
                setLeftPanelCollapsed(false);
                window.requestAnimationFrame(()=>searchInputRef.current?.focus());
              }} title="Find words in this PDF (Ctrl+F)" aria-label="Find words in PDF"><Search size={15}/> Find</button>
            <button disabled={!pdf} onClick={() => void zoomByStep(-1)} aria-label="Zoom out"><Minus size={16}/></button>
            <button className="pdf-zoom-label" disabled={!pdf} onClick={() => setFitMode((mode) => mode === 'width' ? 'page' : 'width')} aria-label={`Zoom mode: ${zoomLabel}`}>{zoomLabel}</button>
            <button disabled={!pdf} onClick={() => void zoomByStep(1)} aria-label="Zoom in"><Plus size={16}/></button>
            <button disabled={!pdf} onClick={() => {setFitMode('custom');setZoom(1);}} aria-label="Actual size" title="Set actual size (100%)">100%</button>
            <label className="pdf-zoom-range" title="Set a precise PDF zoom level">
              <span className="visually-hidden">Zoom percentage</span>
              <input type="range" aria-label="PDF zoom percentage" disabled={!pdf}
                min={25} max={400} step={5}
                value={Math.round(clampPdfZoom(zoom)*100)}
                onChange={event=>{setFitMode('custom');setZoom(clampPdfZoom(Number(event.target.value)/100));}}/>
            </label>
            <button disabled={!pdf} className={viewMode==='single'?'active':''} onClick={()=>setViewMode('single')} aria-label="Single page view" title="Single page">1</button>
            <button disabled={!pdf} className={viewMode==='continuous'?'active':''} onClick={()=>setViewMode('continuous')} aria-label="Continuous page view" title="Continuous">↕</button>
            <button disabled={!pdf} className={viewMode==='two'?'active':''} onClick={()=>setViewMode('two')} aria-label="Two-page view" title="Two page">2</button>
            <button disabled={!sourceBytes||mutating||loading} onClick={() => void mutate(
              `Permanently rotated page ${currentPage} by 90°.`,bytes=>rotatePdfPagePermanent(bytes,currentPage),currentPage,
            ).then(applied=>{if(applied)setRotation(0);})}
              aria-label="Rotate current PDF page clockwise (saved edit)"
              title="Rotate this PDF page 90°. The edit appears immediately, is included in Save PDF copy and can be undone."><RotateCw size={16}/></button>
            <button disabled={!pdf} onClick={()=>void toggleFullscreen(false)} aria-label={fullscreen?'Exit full screen':'Full screen'} title={fullscreen?'Exit full screen':'Full screen'}><Maximize2 size={16}/></button>
            <button disabled={!pdf} onClick={()=>void toggleFullscreen(true)} aria-label="Presentation mode" title="Presentation mode"><MonitorPlay size={16}/></button>
            <button
              disabled={!pdf}
              onClick={()=>setInspectorHidden(value=>{if(value)setLeftPanelCollapsed(true);return !value;})}
              aria-label={inspectorHidden?'Show left document inspector':'Hide left document inspector'}
              title={`${inspectorHidden?'Show':'Hide'} document properties and edit inspector on the left · ${DOCUMENT_INSPECTOR_SHORTCUT}`}
            >{inspectorHidden?<PanelRightOpen size={16}/>:<PanelRightClose size={16}/>}</button>
          </div>
        </div>
    </footer>}
  </div>;
}
