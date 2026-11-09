import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { strToU8, zipSync } from 'fflate';
import { exportConversionFile } from './api';
import { disposePdf, loadPdfForConversion } from './engine';
import { pdfToDocx, pdfToPptx, pdfToXlsx } from './convert/officeExport';
import { readPdfStructure } from './convert/pdfStructure';
import { describePdfError } from './pdfUserErrors';

export type OfficeTarget = 'docx' | 'pptx' | 'xlsx';
interface Profile { name: string; target: OfficeTarget; images: boolean; pages: string; builtIn?: boolean }
const BUILT_IN: Profile[] = [
  { name: 'Word document (text and images)', target: 'docx', images: true, pages: 'all', builtIn: true },
  { name: 'Word document (text only)', target: 'docx', images: false, pages: 'all', builtIn: true },
  { name: 'PowerPoint slides', target: 'pptx', images: true, pages: 'all', builtIn: true },
  { name: 'Excel tables', target: 'xlsx', images: false, pages: 'all', builtIn: true },
];
const TARGETS: [OfficeTarget, string][] = [['docx', 'Word (DOCX)'], ['pptx', 'PowerPoint (PPTX)'], ['xlsx', 'Excel (XLSX)']];
const MIME: Record<OfficeTarget, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const STORE = 'malenjo.pdf.conversion-profiles';
function savedProfiles(): Profile[] {
  try { const list = JSON.parse(localStorage.getItem(STORE) ?? '[]'); return Array.isArray(list) ? list.filter((p) => p && typeof p.name === 'string' && ['docx', 'pptx', 'xlsx'].includes(p.target)).slice(0, 30) : []; } catch { return []; }
}
function pagesFrom(text: string, count: number): number[] {
  const value = text.trim().toLowerCase();
  if (!value || value === 'all') return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (const piece of value.split(',').map((p) => p.trim()).filter(Boolean)) {
    const match = /^(\d+)\s*(?:-\s*(\d*))?$/.exec(piece);
    if (!match) throw new Error(`“${piece}” is not a page or range.`);
    const from = Number(match[1]), to = match[2] === undefined ? from : match[2] === '' ? count : Number(match[2]);
    if (from < 1 || from > to || to > count) throw new Error(`Pages ${piece} are outside 1–${count}.`);
    for (let p = from; p <= to; p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

interface Source { id: string; name: string; bytes: () => Promise<Uint8Array>; chosen: boolean }
interface Result { source: string; status: 'ok' | 'failed'; output: File | null; notes: string[] }
interface Props {
  domIdPrefix: string; sourceName: string; getBytes(): Uint8Array | null; busy: boolean;
  onOpenOutputs?(files: File[]): void; onNotice(message: string): void; onClose(): void;
}

/** MAL-037 / 038 / 039 / 045: convert one or several PDFs to Word, PowerPoint or Excel with a fidelity report per file. */
export default function PdfOfficeConvertDialog({ domIdPrefix, sourceName, getBytes, busy, onOpenOutputs, onNotice, onClose }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>(() => [...BUILT_IN, ...savedProfiles()]);
  const [profile, setProfile] = useState<Profile>(BUILT_IN[0]);
  const [profileName, setProfileName] = useState('');
  const [sources, setSources] = useState<Source[]>(() => [{ id: 'current', name: sourceName || 'document.pdf', bytes: async () => { const b = getBytes(); if (!b) throw new Error('No PDF is open.'); return b; }, chosen: true }]);
  const [openResults, setOpenResults] = useState(true);
  const [running, setRunning] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>('select')?.focus(); }, []);
  const set = (patch: Partial<Profile>) => setProfile({ ...profile, ...patch, builtIn: false });

  function saveProfile() {
    const name = profileName.trim().slice(0, 50);
    if (!name) { setError('Name the profile first.'); return; }
    if (BUILT_IN.some((p) => p.name === name)) { setError('That name belongs to a built-in profile.'); return; }
    const saved = [...savedProfiles().filter((p) => p.name !== name), { name, target: profile.target, images: profile.images, pages: profile.pages }];
    try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* storage unavailable: the profile lasts for this session */ }
    setProfiles([...BUILT_IN, ...saved]); setProfile({ ...profile, name }); setProfileName(''); setError('');
  }
  function addFiles(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => /\.pdf$/i.test(f.name));
    if (sources.length + files.length > 50) { setError('A batch holds up to 50 PDFs.'); return; }
    setSources([...sources, ...files.map((file, i) => ({ id: `${Date.now()}-${i}`, name: file.name, bytes: async () => new Uint8Array(await file.arrayBuffer()), chosen: true }))]);
  }

  async function convert() {
    setError(''); setResults([]);
    const chosen = sources.filter((s) => s.chosen);
    if (!chosen.length) { setError('Choose at least one PDF.'); return; }
    const out: Result[] = [];
    const used = new Set<string>();
    for (const [index, source] of chosen.entries()) {
      setRunning(`Converting ${source.name} (${index + 1} of ${chosen.length})…`);
      let loaded: Awaited<ReturnType<typeof loadPdfForConversion>> | null = null;
      try {
        const bytes = await source.bytes();
        if (bytes.length > 64 * 1024 * 1024) throw new Error('Files over 64 MB are not converted here.');
        loaded = await loadPdfForConversion(bytes);
        const pages = pagesFrom(profile.pages, loaded.document.numPages);
        if (pages.length > 200) throw new Error('Convert up to 200 pages at a time.');
        const structure = await readPdfStructure(loaded.document, pages, { images: profile.images && profile.target !== 'xlsx' });
        const root = source.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-') || 'document';
        let base = root;
        for (let k = 2; used.has(base); k++) base = `${root} (${k})`;
        used.add(base);
        const result = profile.target === 'docx' ? pdfToDocx(structure, base) : profile.target === 'pptx' ? await pdfToPptx(structure, bytes, base) : pdfToXlsx(structure, base);
        const [file] = result.files;
        out.push({ source: source.name, status: 'ok', output: new File([file.bytes.slice().buffer as ArrayBuffer], file.name, { type: MIME[profile.target] }), notes: result.notes });
      } catch (reason) {
        out.push({ source: source.name, status: 'failed', output: null, notes: [describePdfError(reason)] });
      } finally { await disposePdf(loaded); }
    }
    setRunning(''); setResults(out);
    const done = out.filter((r) => r.output);
    onNotice(`Converted ${done.length} of ${out.length} PDF${out.length > 1 ? 's' : ''} to ${TARGETS.find(([t]) => t === profile.target)![1]}.`);
    if (openResults && done.length && onOpenOutputs) onOpenOutputs(done.map((r) => r.output!));
  }
  async function downloadAll() {
    try {
      const done = results.filter((r) => r.output);
      const files: Record<string, Uint8Array> = {};
      for (const r of done) files[r.output!.name] = new Uint8Array(await r.output!.arrayBuffer());
      files['conversion-report.json'] = strToU8(JSON.stringify({ profile: { target: profile.target, images: profile.images, pages: profile.pages },
        files: results.map((r) => ({ source: r.source, status: r.status, output: r.output?.name ?? null, report: r.notes })) }, null, 2));
      if (await exportConversionFile('conversion-results.zip', zipSync(files, { level: 6 }), 'application/zip')) onNotice('Exported conversion-results.zip.');
    } catch (reason) { setError(describePdfError(reason)); }
  }

  const id = (s: string) => `${domIdPrefix}-office-${s}`;
  return <section ref={panelRef} className="pdf-markup-panel pdf-form-panel" role="dialog" aria-modal="false" aria-labelledby={id('title')}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={id('title')}>Convert to Office</h2>
      <button type="button" aria-label="Close convert to Office" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <fieldset>
      <legend>Conversion profile</legend>
      <label><span>Profile</span><select aria-label="Conversion profile" value={profile.name} onChange={(e) => { const p = profiles.find((x) => x.name === e.target.value); if (p) setProfile(p); }}>
        {!profiles.some((p) => p.name === profile.name) && <option value={profile.name}>{profile.name || 'Custom settings'}</option>}
        {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</select></label>
      <label><span>Convert to</span><select aria-label="Convert to" value={profile.target} onChange={(e) => set({ target: e.target.value as OfficeTarget, name: 'Custom settings' })}>
        {TARGETS.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></label>
      <label><span>Pages (for example 1-3, 5 or all)</span><input aria-label="Pages to convert" value={profile.pages} onChange={(e) => set({ pages: e.target.value, name: 'Custom settings' })}/></label>
      {profile.target !== 'xlsx' && <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={profile.images} onChange={(e) => set({ images: e.target.checked, name: 'Custom settings' })}/>Include images</label>}
      <label><span>Save these settings as</span><input aria-label="New profile name" value={profileName} onChange={(e) => setProfileName(e.target.value)}/></label>
      <button type="button" onClick={saveProfile}>Save profile</button>
    </fieldset>
    <fieldset>
      <legend>PDFs to convert</legend>
      <ul className="pdf-merge-list static" aria-label="PDFs to convert">{sources.map((s) => <li key={s.id}><label className="pdf-tool-dialog-choice">
        <input type="checkbox" checked={s.chosen} onChange={(e) => setSources(sources.map((x) => (x.id === s.id ? { ...x, chosen: e.target.checked } : x)))}/>{s.name}</label></li>)}</ul>
      <button type="button" onClick={() => fileRef.current?.click()}>Add PDFs…</button>
      <input ref={fileRef} type="file" hidden multiple accept="application/pdf,.pdf" aria-label="PDFs to add" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}/>
      <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={openResults} onChange={(e) => setOpenResults(e.target.checked)}/>Open results in their editors</label>
    </fieldset>
    <div className="pdf-tool-dialog-actions">
      <button type="button" className="primary-action" disabled={busy || Boolean(running)} onClick={() => void convert()}>Convert</button>
      {results.some((r) => r.output) && <button type="button" onClick={() => void downloadAll()}>Download results (ZIP)</button>}
    </div>
    {running && <p role="status">{running}</p>}
    {results.length > 0 && <section aria-label="Conversion results">
      <p><strong>Fidelity report</strong></p>
      <ul>{results.map((r) => <li key={r.source}><strong>{r.source}</strong>: {r.status === 'ok' ? `converted to ${r.output!.name}` : 'failed'}
        <ul>{r.notes.map((n) => <li key={n}>{n}</li>)}</ul></li>)}</ul>
    </section>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <small>Conversion rebuilds structure from the page layout; it is never lossless. Each result lists what could not be reconstructed. Word, Excel and PowerPoint results open in MALENJO's result editors for review, correction and export.</small>
  </section>;
}
