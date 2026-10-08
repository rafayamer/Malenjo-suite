import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfOptionalContentConfig } from './optionalLayers';
import { PDF_PAGE_DRAG_TYPE, createPdfPageDragPayload, readPdfPageDragPayload } from './pageDrag';

interface Props {
  document: PDFDocumentProxy;
  optionalContentConfig?:PdfOptionalContentConfig|null;
  layerRevision?:number;
  pageNumber: number;
  logicalLabel?: string;
  active: boolean;
  selected: boolean;
  renderAllowed: boolean;
  onSelect(pageNumber: number, additive: boolean, range: boolean): void;
  dragScope?:string;
  reorderEnabled?:boolean;
  pageCount?:number;
  onReorder?(fromPage:number,toPage:number):void;
}

export default function PdfThumbnail({ document, optionalContentConfig, layerRevision=0, pageNumber, logicalLabel, active, selected, renderAllowed, onSelect, dragScope='', reorderEnabled=false, pageCount=0, onReorder }: Props) {
  const wrapperRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 3);
  const [failed, setFailed] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || visible || typeof IntersectionObserver === 'undefined') {
      if (!node && !visible) setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '500px 0px' });

    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!renderAllowed || !visible) return;

    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;

    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;

        const base = page.getViewport({ scale: 1 });
        const scale = 108 / Math.max(1, base.width);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;

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
      } catch (error) {
        if (!cancelled && (error as { name?: string }).name !== 'RenderingCancelledException') {
          setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, renderAllowed, visible, optionalContentConfig, layerRevision]);

  return <button
    ref={wrapperRef}
    className={`pdf-thumb${active ? ' active' : ''}${selected ? ' selected' : ''}${dropTarget ? ' drop-target' : ''}`}
    draggable={reorderEnabled}
    title={reorderEnabled?'Drag to reorder this PDF page. Use Move earlier/later for keyboard access.':undefined}
    onDragStart={(event)=>{
      if(!reorderEnabled||!dragScope){event.preventDefault();return;}
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData(PDF_PAGE_DRAG_TYPE,createPdfPageDragPayload(dragScope,pageNumber));
    }}
    onDragOver={(event)=>{
      if(!reorderEnabled||!event.dataTransfer.types.includes(PDF_PAGE_DRAG_TYPE))return;
      event.preventDefault();
      event.dataTransfer.dropEffect='move';
      setDropTarget(true);
    }}
    onDragLeave={()=>setDropTarget(false)}
    onDragEnd={()=>setDropTarget(false)}
    onDrop={(event)=>{
      setDropTarget(false);
      if(!reorderEnabled||!dragScope||!onReorder)return;
      event.preventDefault();
      const source=readPdfPageDragPayload(event.dataTransfer.getData(PDF_PAGE_DRAG_TYPE),dragScope,pageCount);
      if(source!==null&&source!==pageNumber)onReorder(source,pageNumber);
    }}
    onClick={(event) => onSelect(pageNumber, event.ctrlKey || event.metaKey, event.shiftKey)}
    aria-label={`Select page ${pageNumber}`}
    aria-pressed={selected}
  >
    <div className="pdf-thumb-canvas">
      {failed ? <span>Preview unavailable</span> : <canvas ref={canvasRef}/>}
    </div>
    <span>Page {pageNumber}{logicalLabel && logicalLabel !== String(pageNumber) ? ` · ${logicalLabel}` : ''}</span>
  </button>;
}
