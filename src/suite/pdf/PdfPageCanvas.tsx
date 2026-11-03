import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type {CropRectangle} from './cropGeometry';
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import {highlightPdfTextNodes} from './pdfTextHighlights';
import type {PdfLinkAnnotation} from './links';
import type { PdfOptionalContentConfig } from './optionalLayers';
import { displayPdfRotation, effectivePdfScale, type PdfFitMode } from './layout';
import { renderBudgetFor } from './renderBudget';
import PdfDrawOverlay, { type DrawnShape } from './PdfDrawOverlay';
import type { DrawingKind } from './pdfMarkup';

interface Props {
  document: PDFDocumentProxy;
  optionalContentConfig?:PdfOptionalContentConfig|null;
  layerRevision?:number;
  pageNumber: number;
  fitMode: PdfFitMode;
  zoom: number;
  rotation: number;
  availableWidth: number;
  availableHeight: number;
  forceRender: boolean;
  renderAllowed: boolean;
  eager: boolean;
  domIdPrefix: string;
  highlightQuery?: string;
  onVisible(pageNumber: number): void;
  onRendered(pageNumber: number): void;
  /** Called when the page's pixels were released to stay within the memory budget. */
  onReleased?(pageNumber: number): void;
  links?:readonly PdfLinkAnnotation[];
  onActivateLink?(link:PdfLinkAnnotation):void;
  cropMode?:boolean;
  cropPreview?:CropRectangle|null;
  onCropSelection?(rect:CropRectangle):void;
  showEditSelection?:boolean;
  selectedForEdit?:boolean;
  onSelectForEdit?():void;
  onDeletePage?():void;
  onReplacePage?():void;
  onCropPage?():void;
  editingBusy?:boolean;
  /** MAL-055: active drawing tool; shapes are reported as fractions of the page as shown. */
  drawTool?:{kind:DrawingKind;color:string;busy:boolean;onShape(shape:DrawnShape):void}|null;
  /** MAL-011: clickable boxes over the page's own text runs (fractions of the page as shown). */
  textRuns?:{targets:readonly {id:number;text:string;editable:boolean;shown:{x:number;y:number;width:number;height:number}}[];selected:number|null;onSelect(id:number):void}|null;
}

export default function PdfPageCanvas({
  document,
  optionalContentConfig,
  layerRevision=0,
  pageNumber,
  fitMode,
  zoom,
  rotation,
  availableWidth,
  availableHeight,
  forceRender,
  renderAllowed,
  eager,
  domIdPrefix,
  highlightQuery='',
  onVisible,
  onRendered,
  onReleased,
  links=[],
  onActivateLink,
  cropMode=false,
  cropPreview=null,
  onCropSelection,
  showEditSelection=false,
  selectedForEdit=false,
  onSelectForEdit,
  onDeletePage,
  onReplacePage,
  onCropPage,
  editingBusy=false,
  drawTool=null,
  textRuns=null,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const cropOriginRef=useRef<{x:number;y:number}|null>(null);
  const [dragCrop,setDragCrop]=useState<CropRectangle|null>(null);
  const relativeCropPoint=(event:ReactPointerEvent<HTMLDivElement>)=>{
    const bounds=event.currentTarget.getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),
      y:Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height))};
  };
  const updateDrag=(event:ReactPointerEvent<HTMLDivElement>)=>{
    const start=cropOriginRef.current;
    if(!start)return;
    const end=relativeCropPoint(event);
    const rect={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),
      width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)};
    setDragCrop(rect);
    return rect;
  };
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef=useRef<HTMLDivElement>(null);
  const textDivsRef=useRef<HTMLSpanElement[]>([]);
  const [textRevision,setTextRevision]=useState(0);
  const [visible, setVisible] = useState(pageNumber === 1);
  const [baseSize, setBaseSize] = useState({ width: 612, height: 792 });
  const [failed, setFailed] = useState('');
  const [linkHitboxes,setLinkHitboxes]=useState<Array<{
    link:PdfLinkAnnotation;left:number;top:number;width:number;height:number;
  }>>([]);

  useEffect(() => {
    const node = shellRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      // Use the newest entry; visibility now toggles so pages far from the
      // viewport can be released by the render budget.
      const entry = entries[entries.length - 1];
      setVisible(entry.isIntersecting);
      if (entry.intersectionRatio >= 0.35) onVisible(pageNumber);
    }, {
      rootMargin: '900px 0px',
      threshold: [0, 0.35, 0.65],
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible, pageNumber]);

  useEffect(() => {
    if (!forceRender && (!renderAllowed || (!eager && !visible))) return;
    let cancelled = false;
    void document.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1, rotation: displayPdfRotation(page.rotate, rotation) });
      setBaseSize({ width: viewport.width, height: viewport.height });
    }).catch((reason) => {
      if (!cancelled) setFailed(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [document, eager, forceRender, pageNumber, renderAllowed, rotation, visible]);

  const scale = useMemo(() => effectivePdfScale(
    baseSize.width,
    baseSize.height,
    availableWidth,
    availableHeight,
    fitMode,
    zoom,
  ), [availableHeight, availableWidth, baseSize.height, baseSize.width, fitMode, zoom]);

  const placeholder = useMemo(() => ({
    width: Math.max(120, Math.round(baseSize.width * scale)),
    height: Math.max(160, Math.round(baseSize.height * scale)),
  }), [baseSize.height, baseSize.width, scale]);

  // Pinned pages (visible neighbourhood, focus/adjacent, printing) are never
  // released by the memory budget.
  const pinned = forceRender || eager || visible;
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  // Identity of the pixels currently on the canvas. A cached page that is
  // revisited with the same document/scale/rotation/layers is not re-rendered.
  const renderedKeyRef = useRef<{document:PDFDocumentProxy;key:string;config:unknown}|null>(null);
  // Whether the selectable text layer for the current pixels is finished. It
  // is tracked separately because scrolling away can cancel text rendering
  // after the canvas completed; a later cache hit must then rebuild the text.
  const textReadyRef = useRef(false);
  const renderKey = `${scale}|${rotation}|${layerRevision}`;
  const [releaseRevision, setReleaseRevision] = useState(0);
  const releasePixels = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 0; canvas.height = 0;
      // Drop the old display size too: after zooming out, a stale larger CSS
      // size would stretch this page's slot and shift the scroll layout.
      canvas.style.width = ''; canvas.style.height = '';
    }
    if (shellRef.current) shellRef.current.dataset.pdfRendered = 'false';
    textLayerRef.current?.replaceChildren();
    textDivsRef.current = [];
    renderedKeyRef.current = null;
    textReadyRef.current = false;
    setTextRevision((revision) => revision + 1);
    setReleaseRevision((revision) => revision + 1);
    onReleased?.(pageNumber);
  }, [onReleased, pageNumber]);

  useEffect(() => {
    renderBudgetFor(document).setPinned(pageNumber, pinned);
  }, [document, pageNumber, pinned]);
  useEffect(() => () => renderBudgetFor(document).forget(pageNumber), [document, pageNumber]);

  useEffect(() => {
    const rendered = renderedKeyRef.current;
    const current = rendered !== null && rendered.document === document &&
      rendered.key === renderKey && rendered.config === optionalContentConfig;
    const wanted = forceRender || (renderAllowed && (eager || visible));
    if (!wanted) {
      // Off-screen pages whose pixels are stale (zoom, rotation, layers or an
      // edit changed) are released now instead of re-rendered: re-rendering
      // every previously visited page on each zoom step was pure waste, and
      // stale canvas sizes would distort the scroll layout.
      if (rendered !== null && !current) {
        renderBudgetFor(rendered.document).forget(pageNumber);
        releasePixels();
      }
      return;
    }
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;
    let textLayer:TextLayer|null=null;
    // True once this run resized the canvas (allocating its backing store)
    // and false again once the pixels are complete and budget-tracked.
    let pixelsPending = false;
    const textContainer=textLayerRef.current;
    const isCancelled = () => cancelled;

    // PDF.js canvas pixels cannot be selected. Its official TextLayer overlays
    // real, invisible and selectable text spans on the exact same viewport,
    // including zoom and rotation.
    const renderTextLayer = async (
      page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>,
      viewport: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getViewport']>,
    ) => {
      if(!textContainer){ textReadyRef.current = true; return; }
      try {
        const textContent=await page.getTextContent();
        if(isCancelled())return;
        textContainer.replaceChildren();
        textContainer.style.setProperty('--scale-factor',String(viewport.scale));
        textContainer.style.setProperty('--total-scale-factor',String(viewport.scale));
        textLayer=new TextLayer({
          textContentSource:textContent,
          container:textContainer,
          viewport,
        });
        await textLayer.render();
        if(isCancelled())return;
        textDivsRef.current=textLayer.textDivs.filter(
          (node):node is HTMLSpanElement=>node instanceof HTMLSpanElement,
        );
        // PDF.js emits wrapper spans (including marked-content containers)
        // in addition to TextLayer.textDivs. Those wrappers can be the
        // browser hit target for an entire selectable text run. Apply the
        // text cursor to ALL generated spans, not just the leaf textDivs,
        // so hovering and selecting PDF text works at either DOM depth.
        // Keep textDivsRef restricted to actual glyph runs for Find highlights.
        for (const span of textContainer.querySelectorAll('span')) {
          span.style.setProperty('cursor','text','important');
          span.style.setProperty('user-select','text','important');
          span.style.setProperty('-webkit-user-select','text','important');
        }
        textReadyRef.current = true;
        setTextRevision(revision=>revision+1);
      } catch {
        // Canvas rendering already succeeded: optional text selection
        // must not turn a readable page into a fatal page error.
        if (!isCancelled()) {
          textContainer.replaceChildren();
          textDivsRef.current=[];
          textReadyRef.current = true;
          setTextRevision((revision)=>revision+1);
        }
      }
    };

    if (current) {
      renderBudgetFor(document).setPinned(pageNumber, pinnedRef.current);
      onRendered(pageNumber);
      if (!textReadyRef.current) {
        // Pixels are cached but the text layer was interrupted earlier:
        // rebuild only the text so selection and Find keep working.
        void (async () => {
          try {
            const page = await document.getPage(pageNumber);
            if (cancelled) return;
            const viewport = page.getViewport({ scale, rotation: displayPdfRotation(page.rotate, rotation) });
            await renderTextLayer(page, viewport);
          } catch { /* the readable canvas stays; text is optional */ }
        })();
      }
    } else {
      textReadyRef.current = false;
      textDivsRef.current=[];
      if(textContainer)textContainer.replaceChildren();

      void (async () => {
        try {
          setFailed('');
          const page = await document.getPage(pageNumber);
          if (cancelled) return;

          const viewport = page.getViewport({ scale, rotation: displayPdfRotation(page.rotate, rotation) });
          const canvas = canvasRef.current;
          if (!canvas) return;
          if (shellRef.current) shellRef.current.dataset.pdfRendered = 'false';

          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw new Error('Canvas rendering is unavailable.');

          // The old pixels are overwritten by the resize below, so they stop
          // counting against the budget and are no longer a valid cache.
          if (renderedKeyRef.current) {
            renderBudgetFor(renderedKeyRef.current.document).forget(pageNumber);
            renderedKeyRef.current = null;
          }
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          pixelsPending = true;
          canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
          canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;

          renderTask = page.render({
            canvas,
            canvasContext: context,
            viewport,
            optionalContentConfigPromise:optionalContentConfig?Promise.resolve(optionalContentConfig):undefined,
            transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
          });

          await renderTask.promise;
          if(cancelled)return;
          pixelsPending = false;
          renderedKeyRef.current = { document, key: renderKey, config: optionalContentConfig };
          // Explicit, testable paint signal (a never-drawn canvas is 300 px wide).
          if (shellRef.current) shellRef.current.dataset.pdfRendered = 'true';
          renderBudgetFor(document).retain(pageNumber, canvas.width * canvas.height, releasePixels, pinnedRef.current);
          onRendered(pageNumber);
          await renderTextLayer(page, viewport);
        } catch (error) {
          if (!cancelled && (error as { name?: string }).name !== 'RenderingCancelledException') {
            setFailed(error instanceof Error ? error.message : String(error));
          }
        }
      })();
    }

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      if (pixelsPending) {
        // An interrupted first (or re-)render already allocated a full-size
        // backing store that the budget never saw. Free it now; otherwise
        // fast scrolling would accumulate untracked canvases.
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = 0; canvas.height = 0;
          canvas.style.width = ''; canvas.style.height = '';
        }
        if (shellRef.current) shellRef.current.dataset.pdfRendered = 'false';
      }
      // Keep a finished page (pixels + selectable text) when it merely scrolls
      // away; only an interrupted text render leaves partial spans behind.
      if(!textReadyRef.current){
        if(textContainer)textContainer.replaceChildren();
        textDivsRef.current=[];
      }
    };
  }, [document, eager, forceRender, onRendered, pageNumber, renderAllowed, rotation, scale, visible, optionalContentConfig, layerRevision, renderKey, releasePixels, releaseRevision]);

  useEffect(()=>{
    let cancelled=false;
    const pageLinks=links.filter(link=>link.pageNumber===pageNumber&&
      link.rectangle&&(link.kind==='page'||link.kind==='https'));
    if(!pageLinks.length||!renderAllowed){
      setLinkHitboxes([]);
      return;
    }
    void document.getPage(pageNumber).then((page)=>{
      if(cancelled)return;
      const viewport=page.getViewport({scale,rotation:displayPdfRotation(page.rotate,rotation)});
      const hitboxes=pageLinks.flatMap(link=>{
        const rect=link.rectangle;
        if(!rect)return [];
        // PDF.js PageViewport exposes a 2D affine transform. Mapping both
        // opposite PDF-space corners handles zoom and 90/180/270 rotation.
        const [a,b,c,d,e,f]=viewport.transform;
        const [x1,y1,x2,y2]=rect;
        const ax=a*x1+c*y1+e,ay=b*x1+d*y1+f;
        const bx=a*x2+c*y2+e,by=b*x2+d*y2+f;
        const left=Math.min(ax,bx),top=Math.min(ay,by);
        const width=Math.abs(bx-ax),height=Math.abs(by-ay);
        if(![left,top,width,height].every(Number.isFinite)||
          width<2||height<2||width>20_000||height>20_000)return [];
        return [{link,left,top,width,height}];
      });
      setLinkHitboxes(hitboxes);
    }).catch(()=>{if(!cancelled)setLinkHitboxes([]);});
    return()=>{cancelled=true;};
  },[document,links,pageNumber,renderAllowed,rotation,scale]);

  useEffect(()=>{
    // Highlight only selectable text. A scanned/image-only PDF needs OCR and
    // must never pretend its painted pixels are searchable.
    highlightPdfTextNodes(textDivsRef.current,highlightQuery);
  },[highlightQuery,textRevision]);

  return <div
    ref={shellRef}
    id={`${domIdPrefix}-page-${pageNumber}`}
    className="pdf-page-shell"
    style={{ minWidth: placeholder.width, minHeight: placeholder.height, position:'relative', overflow:cropMode?'hidden':undefined }}
  >
    {/* width/height 0: no backing store until the page is actually drawn. A
        default 300x150 canvas per placeholder cost ~180 MB on a 1,000-page PDF. */}
    <canvas ref={canvasRef} width={0} height={0} aria-label={`PDF page ${pageNumber}`}/>
    <div ref={textLayerRef} className="pdf-text-layer textLayer"
      aria-label={`Selectable text on PDF page ${pageNumber}`}/>
    {linkHitboxes.map(({link,left,top,width,height})=>(
      <button key={link.index+'-'+link.ref}
        type="button"
        className="pdf-link-hitbox"
        aria-label={link.kind==='page'
          ?`Go to linked PDF page ${link.destination}`
          :`Open external HTTPS link ${link.destination}`}
        title={link.kind==='page'
          ?`Navigate to page ${link.destination}`
          :`Open external HTTPS link (confirmation required)`}
        style={{position:'absolute',left,top,width,height,
          zIndex:3,background:'transparent',border:'1px dotted transparent',
          cursor:'pointer'}}
        onClick={()=>onActivateLink?.(link)}
      />
    ))} 
    {cropMode&&<div
      role="region"
      aria-label={`Drag over PDF page ${pageNumber} to draw a crop rectangle. Precise measurements are available in Crop settings.`}
      data-pdf-crop-overlay={pageNumber}
      style={{position:'absolute',inset:0,zIndex:8,cursor:'crosshair',touchAction:'none'}}
      onPointerDown={event=>{
        if(event.button!==0)return;
        cropOriginRef.current=relativeCropPoint(event);
        setDragCrop(null);
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={event=>{updateDrag(event);}}
      onPointerUp={event=>{
        const rect=updateDrag(event);
        cropOriginRef.current=null;
        setDragCrop(null);
        if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
        if(rect&&rect.width>.003&&rect.height>.003)onCropSelection?.(rect);
      }}
      onPointerCancel={()=>{cropOriginRef.current=null;setDragCrop(null);}}
    >
      {(dragCrop??cropPreview)&&<div aria-hidden="true" style={{
        position:'absolute',pointerEvents:'none',
        left:`${(dragCrop??cropPreview)!.x*100}%`,top:`${(dragCrop??cropPreview)!.y*100}%`,
        width:`${(dragCrop??cropPreview)!.width*100}%`,height:`${(dragCrop??cropPreview)!.height*100}%`,
        outline:'2px dashed currentColor',boxShadow:'0 0 0 100vmax rgba(15,23,42,.35)',
      }}/>}
    </div>}
    {textRuns&&<div role="group" aria-label={`Text on PDF page ${pageNumber}`} style={{position:'absolute',inset:0,zIndex:9}}>
      {textRuns.targets.map(target=><button key={target.id} type="button"
        className={'pdf-text-run-target'+(textRuns.selected===target.id?' selected':'')}
        aria-label={`Edit text: ${target.text.slice(0,80)}`} aria-pressed={textRuns.selected===target.id}
        disabled={!target.editable} title={target.editable?'Edit this text':'This text cannot be edited in place'}
        style={{position:'absolute',left:`${target.shown.x*100}%`,top:`${target.shown.y*100}%`,width:`${target.shown.width*100}%`,height:`${target.shown.height*100}%`}}
        onClick={()=>textRuns.onSelect(target.id)}/>)}
    </div>}
    {drawTool&&<PdfDrawOverlay pageNumber={pageNumber} kind={drawTool.kind} color={drawTool.color} busy={drawTool.busy}
      surface={()=>canvasRef.current} onShape={drawTool.onShape}/>}
    {showEditSelection&&<div role="group" aria-label={`Actions for PDF page ${pageNumber}`}
      className="pdf-page-inline-actions">
      <button type="button" onClick={onSelectForEdit} disabled={editingBusy}
        aria-label={`Select page ${pageNumber} for editing`}
        aria-pressed={selectedForEdit}
        title={`Set page ${pageNumber} as the edit target`}>
        {selectedForEdit?`✓ Page ${pageNumber}`:`Select page ${pageNumber}`}
      </button>
      {selectedForEdit&&<>
        <button type="button" onClick={onReplacePage} disabled={editingBusy}
          aria-label={`Replace page ${pageNumber}`} title="Replace this page with a PDF page">Replace</button>
        <button type="button" onClick={onCropPage} disabled={editingBusy}
          aria-label={`Crop page ${pageNumber}`} title="Draw a crop rectangle on this page">Crop</button>
        <button type="button" onClick={onDeletePage} disabled={editingBusy}
          aria-label={`Delete page ${pageNumber}`} title="Delete this page (Undo available)">Delete</button>
      </>}
    </div>}
    {failed && <div className="pdf-page-error">Page {pageNumber}: {failed}</div>}
    <span className="pdf-page-number">{pageNumber}</span>
  </div>;
}
