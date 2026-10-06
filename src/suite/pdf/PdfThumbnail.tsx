import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

interface Props {
  document: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  selected: boolean;
  renderAllowed: boolean;
  onSelect(pageNumber: number, additive: boolean, range: boolean): void;
}

export default function PdfThumbnail({ document, pageNumber, active, selected, renderAllowed, onSelect }: Props) {
  const wrapperRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 3);
  const [failed, setFailed] = useState(false);

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
  }, [document, pageNumber, renderAllowed, visible]);

  return <button
    ref={wrapperRef}
    className={`pdf-thumb${active ? ' active' : ''}${selected ? ' selected' : ''}`}
    onClick={(event) => onSelect(pageNumber, event.ctrlKey || event.metaKey, event.shiftKey)}
    aria-label={`Select page ${pageNumber}`}
    aria-pressed={selected}
  >
    <div className="pdf-thumb-canvas">
      {failed ? <span>Preview unavailable</span> : <canvas ref={canvasRef}/>}
    </div>
    <span>Page {pageNumber}</span>
  </button>;
}
