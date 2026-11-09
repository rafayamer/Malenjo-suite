import { useEffect, useRef, useState } from 'react';
import { FilePlus2, X } from 'lucide-react';
import { exportConversionFile, signingHttp } from './api';
import { readPkcs12, type SigningIdentity } from './signing/pkcs12';
import { PADES_PROFILES, signPdf, type PadesProfile } from './signing/pdfSign';
import { verifyPdfSignatures, type SignatureReport } from './signing/pdfVerify';
import { commonName, parseCertificate, readCertificateFile, type Certificate } from './signing/x509';
import { describePdfError } from './pdfUserErrors';

export interface SignatureBoxState { picking: boolean; pageNumber?: number; box?: [number, number, number, number] }
interface Props {
  domIdPrefix: string; sourceName: string; getBytes(): Uint8Array | null; busy: boolean;
  box: SignatureBoxState; onBox(next: SignatureBoxState): void;
  onOpenPdfs?(files: File[]): void; onNotice(text: string): void; onClose(): void;
}
const TRUST_KEY = 'malenjo.pdf.trusted-certificates.v1';
const TSA_KEY = 'malenjo.pdf.tsa-url';
const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (c) => String.fromCharCode(c)).join(''));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function loadTrusted(): Certificate[] {
  try { return (JSON.parse(globalThis.localStorage?.getItem(TRUST_KEY) ?? '[]') as string[]).flatMap((b) => { try { return [parseCertificate(fromBase64(b))]; } catch { return []; } }); } catch { return []; }
}
const day = (d: Date) => d.toISOString().slice(0, 10);
const when = (d: Date | null | undefined) => (d ? `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC` : 'unknown');

/** MAL-065: certificate-based signing with PAdES profiles and trusted timestamps, and signature validation. */
export default function PdfSignaturePanel({ domIdPrefix, sourceName, getBytes, busy, box, onBox, onOpenPdfs, onNotice, onClose }: Props) {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState('');
  const [identity, setIdentity] = useState<SigningIdentity | null>(null);
  const [profile, setProfile] = useState<PadesProfile>('B-T');
  const [tsaUrl, setTsaUrl] = useState(() => { try { return globalThis.localStorage?.getItem(TSA_KEY) ?? ''; } catch { return ''; } });
  const [reason, setReason] = useState(''); const [location, setLocation] = useState(''); const [contact, setContact] = useState('');
  const [visible, setVisible] = useState(false);
  const [trusted, setTrusted] = useState<Certificate[]>(loadTrusted);
  const [reports, setReports] = useState<SignatureReport[] | null>(null);
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const ref = useRef<HTMLElement>(null); const p12Input = useRef<HTMLInputElement>(null); const certInput = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('button[data-autofocus]')?.focus(); }, []);
  const titleId = `${domIdPrefix}-signatures-title`;
  const storeTrusted = (next: Certificate[]) => { setTrusted(next); try { globalThis.localStorage?.setItem(TRUST_KEY, JSON.stringify(next.map((c) => toBase64(c.der)))); } catch { /* kept for this session only */ } };

  async function run(task: () => Promise<void>) { setWorking(true); setError(''); try { await task(); } catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); } }
  const unlock = () => run(async () => { const id = await readPkcs12(file!.bytes, password); setPassword(''); setIdentity(id); });
  const sign = () => run(async () => {
    const bytes = getBytes();
    if (!bytes || !identity) return;
    if (profile !== 'B-B') { try { globalThis.localStorage?.setItem(TSA_KEY, tsaUrl.trim()); } catch { /* not kept */ } }
    const result = await signPdf(bytes, identity, { profile, tsaUrl: tsaUrl.trim(), reason: reason.trim(), location: location.trim(), contactInfo: contact.trim(), transport: signingHttp,
      appearance: visible && box.box && box.pageNumber ? { pageNumber: box.pageNumber, box: box.box } : null });
    const name = `${(sourceName || 'document.pdf').replace(/\.pdf$/i, '')}-signed.pdf`;
    const saved = await exportConversionFile(name, result.bytes, 'application/pdf');
    if (onOpenPdfs) onOpenPdfs([new File([result.bytes as BlobPart], name, { type: 'application/pdf' })]);
    onNotice(`Signed by ${commonName(identity.certificate)} at PAdES ${result.level}${saved ? `; saved ${name}` : ''}${onOpenPdfs ? ' and opened it in a new tab' : ''}.`);
  });
  const validate = () => run(async () => { const bytes = getBytes(); if (bytes) setReports(await verifyPdfSignatures(bytes, trusted)); });

  return <section ref={ref} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onBox({ picking: false }); onClose(); } }}>
    <header><h2 id={titleId}>Digital signatures</h2><button type="button" aria-label="Close digital signatures" title="Close" onClick={() => { onBox({ picking: false }); onClose(); }}><X size={16} aria-hidden="true"/></button></header>
    <fieldset>
      <legend>Sign</legend>
      <input ref={p12Input} className="visually-hidden" type="file" accept=".p12,.pfx,application/x-pkcs12" aria-hidden="true" tabIndex={-1}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void f.arrayBuffer().then((b) => { setFile({ name: f.name, bytes: new Uint8Array(b) }); setIdentity(null); }); }}/>
      <button type="button" data-autofocus onClick={() => p12Input.current?.click()}><FilePlus2 size={15} aria-hidden="true"/> Signing certificate (.p12 or .pfx)…</button>
      {file && !identity && <>
        <label>Certificate password<input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !working) void unlock(); }}/></label>
        <button type="button" disabled={working} onClick={() => void unlock()}>Open certificate</button>
      </>}
      {identity && <p role="status">Signing as {commonName(identity.certificate)}, issued by {identity.certificate.issuerName.replace(/^.*CN=([^,]+).*$/, '$1')}, valid until {day(identity.certificate.notAfter)}.</p>}
      <label>Profile<select aria-label="PAdES profile" value={profile} onChange={(e) => setProfile(e.target.value as PadesProfile)}>
        {PADES_PROFILES.map(([p, label]) => <option key={p} value={p}>{label}</option>)}</select></label>
      {profile !== 'B-B' && <label>Timestamp authority (RFC 3161)<input type="url" value={tsaUrl} placeholder="https://timestamp.example.com/tsa" onChange={(e) => setTsaUrl(e.target.value)}/></label>}
      <label>Reason<input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)}/></label>
      <label>Location<input value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)}/></label>
      <label>Contact<input value={contact} maxLength={200} onChange={(e) => setContact(e.target.value)}/></label>
      <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)}/>Show a signature box on the page</label>
      {visible && <button type="button" aria-pressed={box.picking} onClick={() => onBox({ ...box, picking: !box.picking })}>{box.picking ? 'Stop drawing' : box.box ? `Box on page ${box.pageNumber} — draw again` : 'Draw the signature box'}</button>}
      <button type="button" className="primary-action" disabled={busy || working || !identity || (profile !== 'B-B' && !tsaUrl.trim()) || (visible && !box.box)} onClick={() => void sign()}>{working ? 'Working…' : 'Sign and save a copy'}</button>
      <small>The signed copy is saved and opened in a new tab; signing adds to the file without changing what was there. B-T and above ask the timestamp authority for a trusted time; B-LT and B-LTA also download the certificates' revocation lists and embed them. The certificate and its password stay on this device and are forgotten when you close this panel.</small>
    </fieldset>
    <fieldset>
      <legend>Validate</legend>
      <input ref={certInput} className="visually-hidden" type="file" accept=".cer,.crt,.pem,.der" multiple aria-hidden="true" tabIndex={-1}
        onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ''; void Promise.all(list.map(async (f) => readCertificateFile(new Uint8Array(await f.arrayBuffer())))).then((sets) => storeTrusted([...trusted, ...sets.flat()].filter((c, i, all) => all.findIndex((x) => x.der.length === c.der.length && x.der.every((v, k) => v === c.der[k])) === i))).catch((reason) => setError(describePdfError(reason))); }}/>
      <ul aria-label="Trusted certificates">{trusted.map((c, i) => <li key={i}>{commonName(c)} (until {day(c.notAfter)})
        <button type="button" aria-label={`Stop trusting ${commonName(c)}`} onClick={() => storeTrusted(trusted.filter((_, k) => k !== i))}><X size={14} aria-hidden="true"/></button></li>)}</ul>
      <button type="button" onClick={() => certInput.current?.click()}>Add trusted certificate…</button>
      <button type="button" disabled={working} onClick={() => void validate()}>Check signatures</button>
      {reports && !reports.length && <p role="status">This PDF has no signatures.</p>}
      {reports?.map((r) => <section key={r.field} className={`pdf-signature-report ${r.status}`} aria-label={`Signature ${r.field}`}>
        <h3>{r.field}: {r.status === 'valid' ? 'Valid' : r.status === 'warning' ? 'Signature intact, but check the notes' : 'Invalid'}</h3>
        <ul>
          <li>{r.kind === 'document-timestamp' ? 'Timestamp by' : 'Signed by'}: {r.signer || 'unknown'}{r.chain.length > 1 ? ` (chain: ${r.chain.join(' → ')})` : ''}</li>
          <li>Time: {when(r.timestamp?.trusted ? r.timestamp.time : r.signedAt)}{r.timestamp?.trusted ? ' (trusted timestamp)' : r.kind === 'signature' ? ' (from the signer’s computer)' : ''}</li>
          {r.level && <li>Level: {r.level}</li>}
          <li>Document integrity: {r.integrity ? 'unchanged since signing' : 'altered or unreadable'}</li>
          <li>Certificate: {r.certificateTrusted ? 'trusted' : 'not trusted'}</li>
          {r.kind === 'signature' && <li>Revocation: {r.revocation === 'not-revoked' ? 'checked from embedded data, not revoked' : r.revocation === 'revoked' ? 'revoked' : 'no embedded revocation data'}</li>}
          <li>Coverage: {r.coverage === 'whole-file' ? 'the whole file' : r.changes === 'signature-maintenance' ? 'later updates only add signatures or validation data' : 'the document was changed after signing'}</li>
          {r.reason && <li>Reason: {r.reason}</li>}
          {r.problems.map((p, i) => <li key={i} className="problem">{p}</li>)}
        </ul>
      </section>)}
    </fieldset>
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
  </section>;
}
