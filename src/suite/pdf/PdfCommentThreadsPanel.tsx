import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { commentNotifications, listCommentThreads, REVIEW_STATES, replyToComment, setCommentState, type CommentThread, type ReviewState } from './pdfComments';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
export interface NewCommentState { placing: boolean; text: string; author: string }
interface Props {
  domIdPrefix: string; bytes: Uint8Array; busy: boolean;
  draft: NewCommentState; onDraft(next: NewCommentState): void;
  onApply(label: string, operation: Operation): Promise<boolean>; onGoToPage(page: number): void; onClose(): void;
}
const NAME_KEY = 'malenjo.pdf.reviewer-name';
const SEEN_KEY = 'malenjo.pdf.comments-seen.v1';
export function reviewerName(fallback: string): string { try { return globalThis.localStorage?.getItem(NAME_KEY) || fallback; } catch { return fallback; } }
export function seenComments(): Set<string> { try { return new Set(JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) ?? '[]') as string[]); } catch { return new Set(); } }
function markSeen(ids: string[]) {
  const all = [...seenComments(), ...ids].slice(-5000);
  try { globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify([...new Set(all)])); } catch { /* kept until the app closes */ }
}
const when = (d: Date | null) => (d ? d.toLocaleString() : '');

/** MAL-056: comment threads with replies, @mentions, resolution and notifications for you. */
export default function PdfCommentThreadsPanel({ domIdPrefix, bytes, busy, draft, onDraft, onApply, onGoToPage, onClose }: Props) {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [seen, setSeen] = useState(seenComments);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(true);
  const [error, setError] = useState('');
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input')?.focus(); }, []);
  useEffect(() => { let live = true; listCommentThreads(bytes).then((t) => { if (live) setThreads(t); }).catch((reason) => { if (live) setError(describePdfError(reason)); }); return () => { live = false; }; }, [bytes]);
  const user = draft.author;
  const notifications = commentNotifications(threads, user, seen);
  const titleId = `${domIdPrefix}-threads-title`;
  const apply = async (label: string, run: (latest: Uint8Array) => Promise<Uint8Array>, summary: string) => {
    setError('');
    return onApply(label, async (latest) => ({ bytes: await run(latest), summary })).catch((reason) => { setError(describePdfError(reason)); return false; });
  };

  return <section ref={ref} className="pdf-tool-dialog pdf-threads-panel" role="dialog" aria-labelledby={titleId}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDraft({ ...draft, placing: false }); onClose(); } }}>
    <header><h2 id={titleId}>Comment threads</h2><button type="button" aria-label="Close comment threads" title="Close" onClick={() => { onDraft({ ...draft, placing: false }); onClose(); }}><X size={16} aria-hidden="true"/></button></header>
    <label>Your name<input value={user} maxLength={160} onChange={(e) => { onDraft({ ...draft, author: e.target.value }); try { globalThis.localStorage?.setItem(NAME_KEY, e.target.value); } catch { /* not kept */ } }}/></label>
    <section aria-label="For you" className="pdf-threads-for-you">
      <h3>For you ({notifications.length} new)</h3>
      {notifications.length ? <ul>{notifications.map((n) => <li key={n.commentId}>
        <button type="button" className="link-button" onClick={() => onGoToPage(n.pageNumber)}>Page {n.pageNumber}</button>: {n.kind === 'mention' ? `${n.author} mentioned you` : `${n.author} replied`} — “{n.text.slice(0, 120)}”</li>)}</ul>
        : <p>Nothing new. Mentions of you (@{user.split(/\s+/)[0] || 'name'}) and replies to your comments appear here when you open the PDF.</p>}
      {notifications.length > 0 && <button type="button" onClick={() => { markSeen(notifications.map((n) => n.commentId)); setSeen(seenComments()); }}>Mark all as seen</button>}
    </section>
    <fieldset>
      <legend>New comment</legend>
      <label>Comment<textarea rows={3} value={draft.text} maxLength={4000} onChange={(e) => onDraft({ ...draft, text: e.target.value })}/></label>
      <small>Mention someone with @name, or @[First Last] for a name with spaces.</small>
      <button type="button" aria-pressed={draft.placing} disabled={busy || !draft.text.trim() || !user.trim()} onClick={() => onDraft({ ...draft, placing: !draft.placing })}>{draft.placing ? 'Stop placing' : 'Place on the page'}</button>
    </fieldset>
    <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)}/>Show resolved threads</label>
    <div className="pdf-threads" aria-label="Comment threads">
      {!threads.length && <p>No comments yet.</p>}
      {threads.filter((t) => showResolved || t.state !== 'Completed').map((t) => <article key={t.ref} aria-label={`Thread by ${t.author || 'unknown'} on page ${t.pageNumber}`} className={`pdf-thread state-${t.state}`}>
        <header><button type="button" className="link-button" onClick={() => onGoToPage(t.pageNumber)}>Page {t.pageNumber}</button> · {t.author || 'Unknown'} · {when(t.date)} · <strong>{REVIEW_STATES.find(([s]) => s === t.state)![1]}</strong>{t.stateBy ? ` (${t.stateBy})` : ''}</header>
        <p>{t.text}</p>
        {t.replies.length > 0 && <ul aria-label="Replies">{t.replies.map((r) => <li key={r.ref}><strong>{r.author || 'Unknown'}</strong>: {r.text} <small>{when(r.date)}</small></li>)}</ul>}
        <label>Reply<input aria-label={`Reply to ${t.author || 'comment'} on page ${t.pageNumber}`} value={replies[t.ref] ?? ''} maxLength={4000} onChange={(e) => setReplies({ ...replies, [t.ref]: e.target.value })}/></label>
        <div className="pdf-tool-dialog-actions">
          <button type="button" disabled={busy || !(replies[t.ref] ?? '').trim() || !user.trim()}
            onClick={() => void apply('Replied to a comment.', (latest) => replyToComment(latest, t.ref, { text: replies[t.ref], author: user }), `Replied to ${t.author || 'a comment'} on page ${t.pageNumber}.`).then((ok) => { if (ok) setReplies({ ...replies, [t.ref]: '' }); })}>Reply</button>
          <select aria-label={`Status of the thread by ${t.author || 'unknown'} on page ${t.pageNumber}`} value={t.state} disabled={busy || !user.trim()}
            onChange={(e) => { const state = e.target.value as ReviewState; void apply('Changed a comment status.', (latest) => setCommentState(latest, t.ref, state, user), `Marked the thread on page ${t.pageNumber} ${REVIEW_STATES.find(([s]) => s === state)![1].toLowerCase()}.`); }}>
            {REVIEW_STATES.map(([s, label]) => <option key={s} value={s}>{label}</option>)}</select>
        </div>
      </article>)}
    </div>
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <small>Threads, replies and statuses are saved in the PDF as standard comment replies, so they travel with the file and other PDF readers show them. Notifications appear here, for the name above, when you open the PDF in MALENJO; nothing is sent over a network.</small>
  </section>;
}
