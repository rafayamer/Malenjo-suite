import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { exportConversionFile } from './api';
import { inspectPdfProtection, unlockPdf, type PdfProtection } from './security/pdfDecrypt';
import { ALL_PERMISSIONS, protectPdf, type PdfPermissions, type PrintPermission } from './security/pdfEncrypt';
import { inspectPdfSanitization, sanitizePdf, SANITIZE_CATEGORIES, type SanitizeCategory, type SanitizeFinding } from './security/pdfSanitize';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
const baseName = (name: string) => (name || 'document.pdf').replace(/\.pdf$/i, '');
const closeOnEscape = (onClose: () => void) => (event: React.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };

const PERMISSION_LABELS: [Exclude<keyof PdfPermissions, 'print'>, string][] = [
  ['modify', 'Change the content'], ['copy', 'Copy text and images'], ['annotate', 'Add comments and fill forms'],
  ['fillForms', 'Fill form fields'], ['accessibility', 'Text access for screen readers'], ['assemble', 'Insert, rotate or delete pages'],
];

/** MAL-061: saves an AES-256 protected copy with an open password, an owner password and permission flags. */
export function PdfProtectDialog({ domIdPrefix, bytes, sourceName, busy, onNotice, onClose }: { domIdPrefix: string; bytes: Uint8Array; sourceName: string; busy: boolean; onNotice(text: string): void; onClose(): void }) {
  const [user, setUser] = useState(''); const [owner, setOwner] = useState(''); const [ownerAgain, setOwnerAgain] = useState('');
  const [permissions, setPermissions] = useState<PdfPermissions>({ ...ALL_PERMISSIONS, modify: false, copy: false, assemble: false });
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input')?.focus(); }, []);
  const titleId = `${domIdPrefix}-protect-title`;
  async function save() {
    setError('');
    if (owner !== ownerAgain) { setError('The owner passwords do not match.'); return; }
    setWorking(true);
    try {
      const out = await protectPdf(bytes, { userPassword: user, ownerPassword: owner, permissions });
      const name = `${baseName(sourceName)}-protected.pdf`;
      if (await exportConversionFile(name, out, 'application/pdf')) { onNotice(`Saved ${name}, protected with AES-256.`); setUser(''); setOwner(''); setOwnerAgain(''); }
    } catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); }
  }
  return <section ref={ref} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId} onKeyDown={closeOnEscape(onClose)}>
    <header><h2 id={titleId}>Protect PDF</h2><button type="button" aria-label="Close protect" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button></header>
    <fieldset>
      <legend>Passwords</legend>
      <label>Open password (optional)<input type="password" autoComplete="new-password" value={user} onChange={(e) => setUser(e.target.value)}/></label>
      <label>Owner password<input type="password" autoComplete="new-password" value={owner} onChange={(e) => setOwner(e.target.value)}/></label>
      <label>Owner password again<input type="password" autoComplete="new-password" value={ownerAgain} onChange={(e) => setOwnerAgain(e.target.value)}/></label>
    </fieldset>
    <fieldset>
      <legend>What people who open it may do</legend>
      <label>Printing<select aria-label="Printing" value={permissions.print} onChange={(e) => setPermissions({ ...permissions, print: e.target.value as PrintPermission })}>
        <option value="none">Not allowed</option><option value="low">Low resolution</option><option value="high">High resolution</option></select></label>
      {PERMISSION_LABELS.map(([key, label]) => <label key={key} className="pdf-tool-dialog-choice">
        <input type="checkbox" checked={permissions[key]} onChange={(e) => setPermissions({ ...permissions, [key]: e.target.checked })}/>{label}</label>)}
    </fieldset>
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <button type="button" className="primary-action" disabled={busy || working || !owner} onClick={() => void save()}>{working ? 'Protecting…' : 'Save protected copy'}</button>
    <small>The copy is encrypted with AES-256; the open document is unchanged. Permissions are honoured by conforming PDF readers, but software that ignores them can still print or copy. Keep the owner password: it is needed to change or remove the protection.</small>
  </section>;
}

/** MAL-062: removes protection with the owner password and opens the unprotected copy as a new tab. */
export function PdfUnlockDialog({ domIdPrefix, bytes, sourceName, onOpenPdfs, onNotice, onClose }: { domIdPrefix: string; bytes: Uint8Array; sourceName: string; onOpenPdfs?(files: File[]): void; onNotice(text: string): void; onClose(): void }) {
  const [password, setPassword] = useState(''); const [info, setInfo] = useState<PdfProtection | null>(null);
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input')?.focus(); void inspectPdfProtection(bytes).then(setInfo).catch(() => setInfo(null)); }, [bytes]);
  const titleId = `${domIdPrefix}-unlock-title`;
  async function unlock() {
    setWorking(true); setError('');
    try {
      const result = await unlockPdf(bytes, password);
      const name = `${baseName(sourceName)}-unlocked.pdf`;
      setPassword('');
      if (onOpenPdfs) { onOpenPdfs([new File([result.bytes as BlobPart], name, { type: 'application/pdf' })]); onNotice(`Removed ${result.method} protection; ${name} opened in a new tab.`); onClose(); }
      else if (await exportConversionFile(name, result.bytes, 'application/pdf')) onNotice(`Removed ${result.method} protection and saved ${name}.`);
    } catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); }
  }
  return <section ref={ref} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId} onKeyDown={closeOnEscape(onClose)}>
    <header><h2 id={titleId}>Remove protection</h2><button type="button" aria-label="Close remove protection" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button></header>
    {info && <p>{info.encrypted ? `Protected with ${info.method}.${info.opensWithoutPassword ? ' It opens without a password but restricts what readers may do.' : ''}` : 'This PDF is not protected.'}</p>}
    <label>Owner password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && !working) void unlock(); }}/></label>
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <button type="button" className="primary-action" disabled={working || !info?.encrypted} onClick={() => void unlock()}>{working ? 'Removing…' : 'Remove protection'}</button>
    <small>An unprotected copy opens in a new tab; the protected file is unchanged. Removing protection needs the owner (permissions) password, unless the file restricts nothing.</small>
  </section>;
}

/** MAL-070: lists sensitive content by category and removes the selected categories from the working copy. */
export function PdfSanitizeDialog({ domIdPrefix, bytes, busy, onApply, onClose }: { domIdPrefix: string; bytes: Uint8Array; busy: boolean; onApply(label: string, operation: Operation): Promise<boolean>; onClose(): void }) {
  const [findings, setFindings] = useState<SanitizeFinding[] | null>(null);
  const [selected, setSelected] = useState<Set<SanitizeCategory>>(new Set());
  const [report, setReport] = useState<string[]>([]); const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    inspectPdfSanitization(bytes).then((list) => { if (!live) return; setFindings(list); setSelected(new Set(list.map((f) => f.category))); setError(''); })
      .catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [bytes]);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input, header button')?.focus(); }, [findings !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const titleId = `${domIdPrefix}-sanitize-title`;
  async function remove() {
    setWorking(true); setError(''); setReport([]);
    let lines: string[] = [];
    try {
      const ok = await onApply('Sanitized the PDF.', async (latest) => {
        const result = await sanitizePdf(latest, [...selected]);
        const removed = result.removed.reduce((n, f) => n + f.items.length, 0);
        lines = [`Removed ${removed} item(s): ${result.removed.map((f) => SANITIZE_CATEGORIES.find(([c]) => c === f.category)![1].toLowerCase()).join(', ')}.`, ...result.kept];
        return { bytes: result.bytes, summary: lines[0] };
      });
      if (ok) setReport(lines);
    } catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); }
  }
  return <section ref={ref} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId} onKeyDown={closeOnEscape(onClose)}>
    <header><h2 id={titleId}>Sanitize PDF</h2><button type="button" aria-label="Close sanitize" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button></header>
    {!findings && !error && <p>Inspecting the document…</p>}
    {findings && !findings.length && <p>No metadata, attachments, scripts, links or hidden content were found.</p>}
    {findings && findings.length > 0 && <fieldset>
      <legend>Found in this PDF</legend>
      {findings.map((f) => <div key={f.category} className="pdf-sanitize-category">
        <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={selected.has(f.category)}
          onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(f.category); else next.delete(f.category); setSelected(next); }}/>
          {SANITIZE_CATEGORIES.find(([c]) => c === f.category)![1]} ({f.items.length})</label>
        <ul>{f.items.slice(0, 8).map((item, i) => <li key={i}>{item}</li>)}{f.items.length > 8 && <li>…and {f.items.length - 8} more</li>}</ul>
      </div>)}
    </fieldset>}
    {report.length > 0 && <div role="status">{report.map((line, i) => <p key={i}>{line}</p>)}</div>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <button type="button" className="primary-action" disabled={busy || working || !selected.size} onClick={() => void remove()}>{working ? 'Removing…' : 'Remove selected'}</button>
    <small>The working copy is changed and Undo restores it. Removing scripts also removes form calculations and validation. Signed PDFs are refused.</small>
  </section>;
}
