import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { exportConversionFile } from './api';
import { loadTrusted } from './PdfSignaturePanel';
import { prepareSigningRequest, signingAuditReport, signingRequestStatus, type Recipient, type RequestStatus } from './signing/signingRequest';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
interface Props {
  domIdPrefix: string; bytes: Uint8Array; sourceName: string; busy: boolean; defaultName: string;
  onApply(label: string, operation: Operation): Promise<boolean>;
  /** Opens Digital signatures to sign the given prepared field. */
  onSignField(field: string): void;
  onClose(): void;
}
const when = (d: Date | null | undefined) => (d ? `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC` : '');

/** MAL-066: prepare a signing request, follow its status, sign the next field, save the audit report. */
export default function PdfSigningRequestPanel({ domIdPrefix, bytes, sourceName, busy, defaultName, onApply, onSignField, onClose }: Props) {
  const [status, setStatus] = useState<RequestStatus | null | undefined>(undefined);
  const [title, setTitle] = useState(''); const [message, setMessage] = useState(''); const [order, setOrder] = useState<'sequential' | 'any'>('sequential');
  const [preparedBy, setPreparedBy] = useState(defaultName);
  const [recipients, setRecipients] = useState<Recipient[]>([{ name: '', email: '' }]);
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input, header button')?.focus(); }, [status === undefined]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { let live = true; signingRequestStatus(bytes, loadTrusted()).then((s) => { if (live) setStatus(s); }).catch((reason) => { if (live) { setStatus(null); setError(describePdfError(reason)); } }); return () => { live = false; }; }, [bytes]);
  const titleId = `${domIdPrefix}-requests-title`;
  async function prepare() {
    setWorking(true); setError('');
    try {
      await onApply('Prepared a signing request.', async (latest) => {
        const out = await prepareSigningRequest(latest, { title, message, order, recipients, preparedBy });
        return { bytes: out.bytes, summary: `Prepared “${out.request.title}” for ${out.request.recipients.length} recipient(s). Save the PDF and send it to ${out.request.recipients[0].name}${order === 'sequential' ? ' first' : ''}.` };
      });
    } catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); }
  }
  async function saveReport() {
    try {
      const html = await signingAuditReport(bytes, loadTrusted(), sourceName);
      await exportConversionFile(`${sourceName.replace(/\.pdf$/i, '') || 'document'}-signing-audit.html`, new TextEncoder().encode(html), 'text/html');
    } catch (reason) { setError(describePdfError(reason)); }
  }
  return <section ref={ref} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <header><h2 id={titleId}>Signing requests</h2><button type="button" aria-label="Close signing requests" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button></header>
    {status === undefined && <p>Reading the document…</p>}
    {status === null && <fieldset>
      <legend>Prepare a request</legend>
      <label>Title<input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)}/></label>
      <label>Message to recipients<textarea rows={2} value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)}/></label>
      <label>Prepared by<input value={preparedBy} maxLength={120} onChange={(e) => setPreparedBy(e.target.value)}/></label>
      <label>Order<select aria-label="Signing order" value={order} onChange={(e) => setOrder(e.target.value as 'sequential' | 'any')}><option value="sequential">One after another, in this order</option><option value="any">In any order</option></select></label>
      <ol className="pdf-merge-list static" aria-label="Recipients">{recipients.map((r, i) => <li key={i}>
        <input aria-label={`Recipient ${i + 1} name`} placeholder="Name" value={r.name} maxLength={120} onChange={(e) => setRecipients(recipients.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))}/>
        <input aria-label={`Recipient ${i + 1} email`} placeholder="Email (optional)" type="email" value={r.email} maxLength={200} onChange={(e) => setRecipients(recipients.map((x, k) => (k === i ? { ...x, email: e.target.value } : x)))}/>
        <button type="button" aria-label={`Remove recipient ${i + 1}`} disabled={recipients.length === 1} onClick={() => setRecipients(recipients.filter((_, k) => k !== i))}><X size={14} aria-hidden="true"/></button>
      </li>)}</ol>
      <button type="button" disabled={recipients.length >= 20} onClick={() => setRecipients([...recipients, { name: '', email: '' }])}><Plus size={15} aria-hidden="true"/> Add recipient</button>
      <button type="button" className="primary-action" disabled={busy || working || !title.trim() || recipients.some((r) => !r.name.trim())} onClick={() => void prepare()}>{working ? 'Preparing…' : 'Prepare request'}</button>
      <small>Each recipient gets a signature box at the bottom of the last page, and the request is stored inside the PDF. MALENJO sends no email: save the PDF and pass it to each recipient, who signs their box with their certificate.</small>
    </fieldset>}
    {status && <>
      <p role="status"><strong>{status.request.title}</strong>: {status.complete ? 'completed — everyone has signed.' : `${status.recipients.filter((r) => r.state === 'signed').length} of ${status.recipients.length} signed.`}{status.request.message ? ` “${status.request.message}”` : ''}</p>
      <table className="pdf-batch-results" aria-label="Recipients and signing status">
        <thead><tr><th scope="col">Recipient</th><th scope="col">Status</th></tr></thead>
        <tbody>{status.recipients.map((r) => <tr key={r.recipient.field}>
          <td>{r.recipient.name}{r.recipient.email ? ` <${r.recipient.email}>` : ''}</td>
          <td>{r.state === 'signed' ? `Signed by ${r.report?.signer} ${when(r.report?.timestamp?.trusted ? r.report.timestamp.time : r.report?.signedAt)} — ${r.report?.status === 'valid' ? 'valid' : r.report?.status === 'warning' ? 'intact, check notes' : 'INVALID'}${r.nameMatches === false ? ' (certificate name differs)' : ''}`
            : r.state === 'ready' ? 'Ready to sign' : 'Waiting for earlier recipients'}</td>
        </tr>)}</tbody>
      </table>
      {status.next && <button type="button" className="primary-action" disabled={busy} onClick={() => onSignField(status.next!.recipient.field)}>Sign as {status.next.recipient.name}…</button>}
      <button type="button" onClick={() => void saveReport()}>Save audit report (HTML)</button>
      <small>Status comes from the signatures in this file, checked against the certificates you trust (Digital signatures, Validate).</small>
    </>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
  </section>;
}
