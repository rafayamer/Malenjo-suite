import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { compressPdfLossless } from './pdfCompress';
import { COMPRESSION_PROFILES, canvasRecoder, compressPdfImages, type CompressionProfile } from './pdfImageCompress';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
interface Props {
  domIdPrefix: string;
  busy: boolean;
  onApply(label: string, operation: Operation): Promise<boolean>;
  onClose(): void;
}

const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
const change = (before: number, after: number) => `${size(before)} → ${size(after)} (${Math.round((1 - after / before) * 100)}% smaller)`;

/** MAL-024 lossless and MAL-025 image compression, with a size report. */
export default function PdfCompressDialog({ domIdPrefix, busy, onApply, onClose }: Props) {
  const [mode, setMode] = useState<'lossless' | 'images'>('lossless');
  const [profile, setProfile] = useState<CompressionProfile | 'custom'>('balanced');
  const [custom, setCustom] = useState({ dpi: 150, qualityPercent: 75 });
  const [report, setReport] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>('input[type="radio"]:checked')?.focus(); }, []);

  async function apply() {
    setWorking(true); setError(''); setReport('');
    let summary = '';
    const operation: Operation = mode === 'lossless'
      ? async (latest) => {
        const r = await compressPdfLossless(latest);
        if (r.unchanged) throw new Error('This PDF is already compact; lossless compression could not make it smaller. Nothing was changed.');
        summary = `Lossless compression: ${change(r.before, r.after)}. ${r.streamsCompressed} stream(s) compressed, ${r.duplicatesMerged} duplicate(s) merged, ${r.unusedRemoved} unused object(s) removed. Page content is unchanged.`;
        return { bytes: r.bytes, summary };
      }
      : async (latest) => {
        const target = profile === 'custom' ? { dpi: custom.dpi, quality: custom.qualityPercent / 100 } : COMPRESSION_PROFILES[profile];
        const r = await compressPdfImages(latest, { dpi: target.dpi, quality: target.quality, recoder: canvasRecoder });
        if (r.unchanged) throw new Error(`No image could be made smaller at ${target.dpi} dpi and ${Math.round(target.quality * 100)}% quality. Nothing was changed.`);
        summary = `Image compression: ${change(r.before, r.after)}. ${r.downsampled} image(s) reduced to ${target.dpi} dpi, ${r.recompressed} re-encoded, ${r.skipped} left as they were (unsupported type), of ${r.images}.`;
        return { bytes: r.bytes, summary };
      };
    try {
      if (await onApply(mode === 'lossless' ? 'Compressed the PDF (lossless).' : 'Compressed PDF images.', operation)) setReport(summary);
    } catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); }
  }

  const titleId = `${domIdPrefix}-compress-title`;
  return <section ref={dialogRef} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={titleId}>Compress PDF</h2>
      <button type="button" aria-label="Close compress" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <fieldset>
      <legend>Method</legend>
      <label className="pdf-tool-dialog-choice"><input type="radio" name={`${domIdPrefix}-compress-mode`} checked={mode === 'lossless'} onChange={() => setMode('lossless')}/>Lossless (pages look exactly the same)</label>
      <label className="pdf-tool-dialog-choice"><input type="radio" name={`${domIdPrefix}-compress-mode`} checked={mode === 'images'} onChange={() => setMode('images')}/>Reduce images (smaller, lower image detail)</label>
    </fieldset>
    {mode === 'images' && <fieldset>
      <legend>Image quality</legend>
      <label>Profile<select aria-label="Compression profile" value={profile} onChange={(e) => setProfile(e.target.value as CompressionProfile | 'custom')}>
        {(Object.keys(COMPRESSION_PROFILES) as CompressionProfile[]).map((id) => <option key={id} value={id}>{COMPRESSION_PROFILES[id].label}</option>)}
        <option value="custom">Custom</option>
      </select></label>
      {profile === 'custom' && <>
        <label>Resolution (dpi)<input aria-label="Image resolution in dpi" type="number" min={36} max={600} value={custom.dpi} onChange={(e) => setCustom({ ...custom, dpi: Number(e.target.value) })}/></label>
        <label>JPEG quality (%)<input aria-label="JPEG quality percent" type="number" min={10} max={100} value={custom.qualityPercent} onChange={(e) => setCustom({ ...custom, qualityPercent: Number(e.target.value) })}/></label>
      </>}
    </fieldset>}
    {report && <p role="status">{report}</p>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <button type="button" className="primary-action" disabled={busy || working} onClick={() => void apply()}>{working ? 'Compressing…' : 'Compress'}</button>
    <small>The working copy is replaced and Undo restores it. Signed and certified PDFs are refused. Image compression changes only colour and greyscale photos; line art, masks and special colour spaces are kept as they are.</small>
  </section>;
}
