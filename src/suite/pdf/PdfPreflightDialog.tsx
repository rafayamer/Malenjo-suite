import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { exportConversionFile } from './api';
import { PREFLIGHT_PROFILES, preflightPdf, preflightReportText, type PreflightProfile, type PreflightResult } from './security/pdfProfiles';
import { describePdfError } from './pdfUserErrors';

/** MAL-068: checks the open document against the selected profiles and reports what fails, and where. */
export default function PdfPreflightDialog({ domIdPrefix, bytes, sourceName, onClose }: { domIdPrefix: string; bytes: Uint8Array; sourceName: string; onClose(): void }) {
  const [profiles, setProfiles] = useState<Set<PreflightProfile>>(new Set(['pdfa-2b']));
  const [results, setResults] = useState<PreflightResult[] | null>(null);
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input')?.focus(); }, []);
  useEffect(() => { setResults(null); }, [bytes]);
  const titleId = `${domIdPrefix}-preflight-title`;
  async function run() {
    setWorking(true); setError('');
    try { setResults(await preflightPdf(bytes, PREFLIGHT_PROFILES.map(([p]) => p).filter((p) => profiles.has(p)))); }
    catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); }
  }
  async function save() {
    try {
      const name = `${sourceName.replace(/\.pdf$/i, '') || 'document'}-preflight.txt`;
      await exportConversionFile(name, new TextEncoder().encode(preflightReportText(results!, sourceName)), 'text/plain');
    } catch (reason) { setError(describePdfError(reason)); }
  }
  return <section ref={ref} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <header><h2 id={titleId}>Preflight</h2><button type="button" aria-label="Close preflight" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button></header>
    <fieldset>
      <legend>Check against</legend>
      {PREFLIGHT_PROFILES.map(([p, label]) => <label key={p} className="pdf-tool-dialog-choice"><input type="checkbox" checked={profiles.has(p)}
        onChange={(e) => { const next = new Set(profiles); if (e.target.checked) next.add(p); else next.delete(p); setProfiles(next); }}/>{label}</label>)}
    </fieldset>
    <button type="button" className="primary-action" disabled={working || !profiles.size} onClick={() => void run()}>{working ? 'Checking…' : 'Run preflight'}</button>
    {results && <div className="pdf-preflight-results">
      {results.map((r) => <section key={r.profile} aria-label={`${r.name} results`}>
        <h3>{r.name}: {r.passed ? 'passed' : `failed ${r.checks.filter((c) => !c.passed).length} of ${r.checks.length} checks`}</h3>
        <ul>{r.checks.map((c) => <li key={c.id} className={c.passed ? 'passed' : 'failed'}>
          <span>{c.passed ? 'Passed' : 'Failed'}: {c.group} — {c.label}</span>
          {c.details.length > 0 && <ul>{c.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
        </li>)}</ul>
      </section>)}
      <button type="button" onClick={() => void save()}>Save report</button>
    </div>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <small>MALENJO checks the conditions listed for each profile (fonts, colour, transparency, metadata, actions, annotations, tagging, page boxes). It is not a certified validator: a pass means none of these checks failed.</small>
  </section>;
}
