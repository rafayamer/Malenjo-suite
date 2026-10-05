import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Crop,
  FileImage,
  FileText,
  LoaderCircle,
  RotateCw,
  ScanLine,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  MAX_SCAN_PAGES,
  OCR_MAX_DIMENSION,
  canvasToBlob,
  imageDimensions,
  renderProcessedScan,
  validateImageMetadata,
} from './image';
import {
  cancelActiveOcr,
  getPaddleStatus,
  ocrAccuracy,
  recognizeScan,
  type PaddleStatus,
} from './ocr';
import { buildSearchablePdf, downloadBytes } from './searchablePdf';
import {
  DEFAULT_SCAN_ADJUSTMENTS,
  type PerspectiveQuad,
  type ScanAdjustments,
  type ScanPage,
} from './types';

interface Props {
  mode: 'scanner' | 'ocr';
  onBackToFiles(): void;
}

function pageId(): string {
  return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function cloneAdjustments(): ScanAdjustments {
  return {
    ...DEFAULT_SCAN_ADJUSTMENTS,
    crop: { ...DEFAULT_SCAN_ADJUSTMENTS.crop },
    perspective: { ...DEFAULT_SCAN_ADJUSTMENTS.perspective },
  };
}

function formatConfidence(value?: number): string {
  return value === undefined ? '—' : `${Math.round(value * 10) / 10}%`;
}

export default function ScannerWorkspace({ mode, onBackToFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [pages, setPages] = useState<ScanPage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState('Idle');
  const [preferPaddle, setPreferPaddle] = useState(true);
  const [paddleStatus, setPaddleStatus] = useState<PaddleStatus | null>(null);
  const [expectedText, setExpectedText] = useState('');

  const selected = pages.find((page) => page.id === selectedId) ?? pages[0] ?? null;
  const selectedIndex = selected ? pages.findIndex((page) => page.id === selected.id) : -1;

  useEffect(() => {
    void getPaddleStatus().then(setPaddleStatus).catch(() => undefined);
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void cancelActiveOcr();
    };
  }, []);

  useEffect(() => {
    if (!selectedId && pages[0]) setSelectedId(pages[0].id);
  }, [pages, selectedId]);

  async function addFiles(files: FileList | File[]) {
    setError('');
    const incoming = Array.from(files);
    if (pages.length + incoming.length > MAX_SCAN_PAGES) {
      setError(`A scan session is limited to ${MAX_SCAN_PAGES} pages.`);
      return;
    }

    const additions: ScanPage[] = [];
    for (const file of incoming) {
      if (file.size > 25 * 1024 * 1024) {
        setError(`${file.name}: exceeds the 25 MB page limit.`);
        continue;
      }

      const url = URL.createObjectURL(file);
      try {
        const dimensions = await imageDimensions(url);
        const validation = validateImageMetadata(file.type || 'image/jpeg', file.size, dimensions.width, dimensions.height);
        if (validation) {
          URL.revokeObjectURL(url);
          setError(`${file.name}: ${validation}`);
          continue;
        }

        additions.push({
          id: pageId(),
          name: file.name,
          sourceUrl: url,
          mimeType: file.type || 'image/jpeg',
          originalBytes: file.size,
          width: dimensions.width,
          height: dimensions.height,
          adjustments: cloneAdjustments(),
        });
      } catch (reason) {
        URL.revokeObjectURL(url);
        setError(`${file.name}: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    }

    if (additions.length) {
      setPages((current) => [...current, ...additions]);
      setSelectedId((current) => current ?? additions[0].id);
      setMessage(`Added ${additions.length} scan page(s).`);
    }
  }

  async function startCamera() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch (reason) {
      setError(`Camera unavailable: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  async function captureCamera() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0);

    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    const file = new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await addFiles([file]);
  }

  function updateSelected(updater: (page: ScanPage) => ScanPage) {
    if (!selected) return;
    setPages((current) => current.map((page) => page.id === selected.id ? updater(page) : page));
  }

  function updateAdjustments(patch: Partial<ScanAdjustments>) {
    updateSelected((page) => ({
      ...page,
      adjustments: { ...page.adjustments, ...patch },
      ocr: undefined,
    }));
  }

  function updatePerspective(key: keyof PerspectiveQuad, value: number) {
    if (!selected) return;
    updateAdjustments({
      perspective: { ...selected.adjustments.perspective, [key]: value },
    });
  }

  function moveSelected(direction: -1 | 1) {
    if (selectedIndex < 0) return;
    const nextIndex = selectedIndex + direction;
    if (nextIndex < 0 || nextIndex >= pages.length) return;
    setPages((current) => {
      const copy = [...current];
      [copy[selectedIndex], copy[nextIndex]] = [copy[nextIndex], copy[selectedIndex]];
      return copy;
    });
  }

  function removeSelected() {
    if (!selected) return;
    URL.revokeObjectURL(selected.sourceUrl);
    const next = pages.filter((page) => page.id !== selected.id);
    setPages(next);
    setSelectedId(next[Math.min(selectedIndex, next.length - 1)]?.id ?? null);
  }

  async function processedBlob(page: ScanPage, maxDimension = OCR_MAX_DIMENSION): Promise<Blob> {
    const canvas = await renderProcessedScan(page.sourceUrl, page.adjustments, maxDimension);
    return canvasToBlob(canvas, 'image/jpeg', 0.9);
  }

  async function runOcr(target: 'selected' | 'all') {
    const targets = target === 'selected' ? (selected ? [selected] : []) : pages;
    if (!targets.length) return;

    setOcrBusy(true);
    setError('');
    setMessage('');
    setOcrProgress(0);

    try {
      for (let index = 0; index < targets.length; index += 1) {
        const page = targets[index];
        setOcrStatus(`Preparing ${page.name}`);
        const blob = await processedBlob(page);
        const result = await recognizeScan(blob, {
          preferPaddle,
          onProgress: (progress, status) => {
            const base = index / targets.length;
            setOcrProgress(base + progress / targets.length);
            setOcrStatus(status);
          },
        });

        setPages((current) => current.map((item) => item.id === page.id ? { ...item, ocr: result } : item));
        setOcrProgress((index + 1) / targets.length);
      }
      setMessage(`OCR completed for ${targets.length} page(s).`);
      setOcrStatus('Complete');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setOcrStatus('Stopped');
    } finally {
      setOcrBusy(false);
    }
  }

  async function cancelOcr() {
    await cancelActiveOcr();
    setOcrBusy(false);
    setOcrStatus('Cancelled');
    setMessage('OCR cancelled.');
  }

  function downloadText() {
    const text = pages.map((page, index) => `--- Page ${index + 1}: ${page.name} ---\n${page.ocr?.text ?? ''}`).join('\n\n');
    const bytes = new TextEncoder().encode(text);
    downloadBytes(bytes, 'MALENJO-OCR.txt', 'text/plain;charset=utf-8');
  }

  async function exportSearchablePdf() {
    if (!pages.length) return;
    setOcrStatus('Building searchable PDF');
    try {
      const output = [];
      for (const page of pages) {
        output.push({
          image: await processedBlob(page, 2400),
          text: page.ocr?.text ?? '',
        });
      }
      const bytes = await buildSearchablePdf(output);
      downloadBytes(bytes, 'MALENJO-searchable-scan.pdf', 'application/pdf');
      setMessage('Searchable PDF exported.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOcrStatus('Idle');
    }
  }

  const accuracy = useMemo(() => {
    if (!selected?.ocr || !expectedText.trim()) return null;
    return ocrAccuracy(expectedText, selected.ocr.text);
  }, [expectedText, selected?.ocr]);

  return <div className="scanner-workspace">
    <input
      ref={inputRef}
      className="visually-hidden"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/bmp,image/tiff"
      multiple
      onChange={(event) => {
        if (event.target.files) void addFiles(event.target.files);
        event.target.value = '';
      }}
    />

    <div className="scanner-toolbar">
      <div>
        <button onClick={onBackToFiles}><FileText size={16}/> Files</button>
        <button onClick={() => inputRef.current?.click()}><FileImage size={16}/> Import images</button>
        <button onClick={() => void startCamera()}><Camera size={16}/> Camera</button>
      </div>
      <div>
        <button disabled={!selected} onClick={() => updateAdjustments({ rotation: (((selected?.adjustments.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270 })}><RotateCw size={16}/> Rotate</button>
        <button disabled={!selected || selectedIndex <= 0} onClick={() => moveSelected(-1)}><ChevronUp size={16}/> Up</button>
        <button disabled={!selected || selectedIndex >= pages.length - 1} onClick={() => moveSelected(1)}><ChevronDown size={16}/> Down</button>
        <button disabled={!selected} onClick={removeSelected}><Trash2 size={16}/> Remove</button>
      </div>
      <div>
        <button disabled={!selected || ocrBusy} onClick={() => void runOcr('selected')}><ScanLine size={16}/> OCR page</button>
        <button disabled={!pages.length || ocrBusy} onClick={() => void runOcr('all')}><ScanLine size={16}/> OCR all</button>
        {ocrBusy && <button className="danger" onClick={() => void cancelOcr()}><Square size={14}/> Cancel</button>}
      </div>
    </div>

    {(message || error) && <div className={error ? 'scanner-message error' : 'scanner-message'}>{error || message}</div>}

    {ocrBusy && <div className="ocr-progress">
      <LoaderCircle className="spin" size={15}/><span>{ocrStatus}</span>
      <div><i style={{ width: `${Math.round(ocrProgress * 100)}%` }}/></div><b>{Math.round(ocrProgress * 100)}%</b>
    </div>}

    <div className="scanner-layout">
      <aside className="scan-pages">
        <div className="scan-pane-title">Pages <b>{pages.length}/{MAX_SCAN_PAGES}</b></div>
        {pages.map((page, index) => <button key={page.id} className={page.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(page.id)}>
          <img src={page.sourceUrl} alt=""/>
          <span><b>{index + 1}. {page.name}</b><small>{page.ocr ? `OCR ${formatConfidence(page.ocr.confidence)}` : 'Not recognized'}</small></span>
        </button>)}
        {!pages.length && <div className="scan-list-empty">Import images or use the camera to assemble a scan.</div>}
      </aside>

      <main className="scan-canvas-area">
        {selected
          ? <ProcessedPreview page={selected}/>
          : <div className="scanner-empty"><div className="empty-icon">M</div><h2>{mode === 'ocr' ? 'OCR Workspace' : 'Scanner'}</h2><p>Import document photos or capture pages from a camera. Pages stay local to this session.</p></div>}
      </main>

      <aside className="scan-inspector">
        <section>
          <h3><Crop size={15}/> Image cleanup</h3>
          <Range label="Brightness" value={selected?.adjustments.brightness ?? 100} min={50} max={150} disabled={!selected} onChange={(brightness) => updateAdjustments({ brightness })}/>
          <Range label="Contrast" value={selected?.adjustments.contrast ?? 100} min={50} max={180} disabled={!selected} onChange={(contrast) => updateAdjustments({ contrast })}/>
          <label className="check-row"><input type="checkbox" disabled={!selected} checked={selected?.adjustments.grayscale ?? false} onChange={(event) => updateAdjustments({ grayscale: event.target.checked })}/> Grayscale</label>
        </section>

        <section>
          <h3>Crop</h3>
          <Range label="Left" value={Math.round((selected?.adjustments.crop.x ?? 0) * 100)} min={0} max={45} disabled={!selected} onChange={(value) => selected && updateAdjustments({ crop: { ...selected.adjustments.crop, x: value / 100 } })}/>
          <Range label="Top" value={Math.round((selected?.adjustments.crop.y ?? 0) * 100)} min={0} max={45} disabled={!selected} onChange={(value) => selected && updateAdjustments({ crop: { ...selected.adjustments.crop, y: value / 100 } })}/>
          <Range label="Width" value={Math.round((selected?.adjustments.crop.width ?? 1) * 100)} min={10} max={100} disabled={!selected} onChange={(value) => selected && updateAdjustments({ crop: { ...selected.adjustments.crop, width: value / 100 } })}/>
          <Range label="Height" value={Math.round((selected?.adjustments.crop.height ?? 1) * 100)} min={10} max={100} disabled={!selected} onChange={(value) => selected && updateAdjustments({ crop: { ...selected.adjustments.crop, height: value / 100 } })}/>
        </section>

        <section>
          <h3>Perspective</h3>
          <label className="check-row"><input type="checkbox" disabled={!selected} checked={selected?.adjustments.perspectiveEnabled ?? false} onChange={(event) => updateAdjustments({ perspectiveEnabled: event.target.checked })}/> Manual quadrilateral correction</label>
          {selected?.adjustments.perspectiveEnabled && <div className="perspective-grid">
            {([
              ['TL X','tlx'],['TL Y','tly'],['TR X','trx'],['TR Y','try'],
              ['BR X','brx'],['BR Y','bry'],['BL X','blx'],['BL Y','bly'],
            ] as Array<[string,keyof PerspectiveQuad]>).map(([label,key]) =>
              <Range key={key} label={label} value={Math.round(selected.adjustments.perspective[key] * 100)} min={0} max={100} onChange={(value) => updatePerspective(key, value / 100)}/>
            )}
          </div>}
        </section>

        <section>
          <h3>OCR engine</h3>
          <label className="check-row"><input type="checkbox" checked={preferPaddle} onChange={(event) => setPreferPaddle(event.target.checked)}/> Prefer local PaddleOCR</label>
          <p className={paddleStatus?.available ? 'engine-ok' : 'engine-note'}>{paddleStatus?.message ?? 'Checking local OCR pack…'}</p>
          <p className="engine-note">Portable Tesseract.js fallback can download/cache English language data on first use; the installed PaddleOCR pack is the fully local/offline desktop path.</p>
        </section>

        <section>
          <h3>OCR result</h3>
          <textarea readOnly value={selected?.ocr?.text ?? ''} placeholder="Recognized text appears here."/>
          {selected?.ocr && <div className="ocr-metrics">
            <span>Engine <b>{selected.ocr.engine}</b></span>
            <span>Confidence <b>{formatConfidence(selected.ocr.confidence)}</b></span>
            <span>Latency <b>{selected.ocr.latencyMs} ms</b></span>
            <span>Cache <b>{selected.ocr.cached ? 'hit' : 'new'}</b></span>
          </div>}
        </section>

        <section>
          <h3>Accuracy benchmark</h3>
          <textarea value={expectedText} onChange={(event) => setExpectedText(event.target.value)} placeholder="Paste expected ground-truth text for this page."/>
          <div className="accuracy-score">{accuracy === null ? 'Add expected text to benchmark.' : `Normalized character accuracy: ${accuracy}%`}</div>
        </section>

        <section className="scan-export">
          <button disabled={!pages.some((page) => page.ocr)} onClick={downloadText}><FileText size={15}/> Export text</button>
          <button disabled={!pages.length} onClick={() => void exportSearchablePdf()}><FileText size={15}/> Searchable PDF</button>
        </section>
      </aside>
    </div>

    {cameraOpen && <div className="camera-overlay">
      <div className="camera-dialog">
        <button className="camera-close" onClick={stopCamera}><X size={18}/></button>
        <video ref={videoRef} playsInline muted/>
        <div><button onClick={() => void captureCamera()}><Camera size={17}/> Capture page</button><button onClick={stopCamera}>Done</button></div>
      </div>
    </div>}
  </div>;
}

function Range({ label, value, min, max, disabled, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange(value: number): void;
}) {
  return <label className="range-row">
    <span>{label}</span>
    <input type="range" min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}/>
    <b>{value}</b>
  </label>;
}

function ProcessedPreview({ page }: { page: ScanPage }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void renderProcessedScan(page.sourceUrl, page.adjustments, 1800)
      .then((rendered) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        canvas.getContext('2d')?.drawImage(rendered, 0, 0);
        setError('');
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, [page]);

  return <div className="processed-preview">
    <canvas ref={canvasRef}/>
    {error && <div className="preview-error">{error}</div>}
  </div>;
}
