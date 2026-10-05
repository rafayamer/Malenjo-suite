import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { effectivePdfScale, type PdfFitMode } from './layout';

interface Props {
  document: PDFDocumentProxy;
  pageNumber: number;
  fitMode: PdfFitMode;
  zoom: number;
  rotation: number;
  availableWidth: number;
  availableHeight: number;
  forceRender: boolean;
  domIdPrefix: string;
  onVisible(pageNumber: number): void;
  onRendered(pageNumber: number): void;
}

export default function PdfPageCanvas({
  document,
  pageNumber,
  fitMode,
  zoom,
  rotation,
  availableWidth,
  availableHeight,
  forceRender,
  domIdPrefix,
  onVisible,
  onRendered,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(pageNumber === 1);
  const [baseSize, setBaseSize] = useState({ width: 612, height: 792 });
  const [failed, setFailed] = useState('');

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
    let cancelled = false;
    void document.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1, rotation });
      setBaseSize({ width: viewport.width, height: viewport.height });
    });
    return () => { cancelled = true; };
  }, [document, pageNumber, rotation]);

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
    if (!visible && !forceRender) return;

    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;

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
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        });

        await renderTask.promise;
        if (!cancelled) onRendered(pageNumber);
      } catch (error) {
        if (!cancelled && (error as { name?: string }).name !== 'RenderingCancelledException') {
          setFailed(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, forceRender, onRendered, pageNumber, rotation, scale, visible]);

  return <div
    ref={shellRef}
    id={`${domIdPrefix}-page-${pageNumber}`}
    className="pdf-page-shell"
    style={{ minWidth: placeholder.width, minHeight: placeholder.height }}
  >
    <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`}/>
    {failed && <div className="pdf-page-error">Page {pageNumber}: {failed}</div>}
    <span className="pdf-page-number">{pageNumber}</span>
  </div>;
}
