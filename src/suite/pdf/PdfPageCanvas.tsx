import { useEffect, useMemo, useRef, useState } from 'react';
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import {highlightPdfTextNodes} from './pdfTextHighlights';
import type {PdfLinkAnnotation} from './links';
import type { PdfOptionalContentConfig } from './optionalLayers';
import { effectivePdfScale, type PdfFitMode } from './layout';

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
  links?:readonly PdfLinkAnnotation[];
  onActivateLink?(link:PdfLinkAnnotation):void;
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
  links=[],
  onActivateLink,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
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
      const entry = entries[0];
      if (entry.isIntersecting) setVisible(true);
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
      const viewport = page.getViewport({ scale: 1, rotation });
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

  useEffect(() => {
    if (!forceRender && (!renderAllowed || (!eager && !visible))) return;

    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;
    let textLayer:TextLayer|null=null;
    const textContainer=textLayerRef.current;
    textDivsRef.current=[];
    if(textContainer)textContainer.replaceChildren();

    void (async () => {
      try {
        setFailed('');
        const page = await document.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas rendering is unavailable.');

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
        onRendered(pageNumber);
        // PDF.js canvas pixels cannot be selected. Its official TextLayer
        // overlays real, invisible and selectable text spans on the exact
        // same viewport, including zoom and rotation.
        if(textContainer){
          try {
          const textContent=await page.getTextContent();
          if(cancelled)return;
          textContainer.style.setProperty('--scale-factor',String(viewport.scale));
          textContainer.style.setProperty('--total-scale-factor',String(viewport.scale));
          textLayer=new TextLayer({
            textContentSource:textContent,
            container:textContainer,
            viewport,
          });
          await textLayer.render();
          if(cancelled)return;
          textDivsRef.current=textLayer.textDivs.filter(
            (node):node is HTMLSpanElement=>node instanceof HTMLSpanElement,
          );
          setTextRevision(revision=>revision+1);
          } catch (error) {
            // Canvas rendering already succeeded: optional text selection
            // must not turn a readable page into a fatal page error.
            if (!cancelled) {
              textContainer.replaceChildren();
              textDivsRef.current=[];
              setTextRevision((revision)=>revision+1);
            }
          }
        }
      } catch (error) {
        if (!cancelled && (error as { name?: string }).name !== 'RenderingCancelledException') {
          setFailed(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      if(textContainer)textContainer.replaceChildren();
      textDivsRef.current=[];
    };
  }, [document, eager, forceRender, onRendered, pageNumber, renderAllowed, rotation, scale, visible, optionalContentConfig, layerRevision]);

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
      const viewport=page.getViewport({scale,rotation});
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
    style={{ minWidth: placeholder.width, minHeight: placeholder.height, position:'relative' }}
  >
    <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`}/>
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
    {failed && <div className="pdf-page-error">Page {pageNumber}: {failed}</div>}
    <span className="pdf-page-number">{pageNumber}</span>
  </div>;
}
