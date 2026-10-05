import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

interface Props {
  document: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  onSelect(pageNumber: number): void;
}

export default function PdfThumbnail({ document, pageNumber, active, onSelect }: Props) {
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
    if (!visible) return;

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
  }, [document, pageNumber, visible]);

  return <button
    ref={wrapperRef}
    className={active ? 'pdf-thumb active' : 'pdf-thumb'}
    onClick={() => onSelect(pageNumber)}
    aria-label={`Go to page ${pageNumber}`}
  >
    <div className="pdf-thumb-canvas">
      {failed ? <span>Preview unavailable</span> : <canvas ref={canvasRef}/>}
    </div>
    <span>Page {pageNumber}</span>
  </button>;
}
