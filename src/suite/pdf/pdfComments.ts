/**
 * Threaded comments and mentions (MAL-056), kept in the PDF itself so they travel with the file:
 * - a thread is a comment (any markup annotation with text) and its replies (annotations with /IRT pointing at it);
 * - resolution is a standard review-state reply (/StateModel /Review, /State Completed, Accepted, Rejected, ...);
 * - a mention is @name, or @[First Last] for a name with spaces;
 * - notifications are the mentions of you, and the replies to your comments, that you have not seen yet: MALENJO
 *   shows them when you open the PDF. Nothing is sent over a network.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib';
import { refuseSignedPdf } from './pdfSignatureGuard';

export type ReviewState = 'None' | 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed';
export const REVIEW_STATES: [ReviewState, string][] = [['None', 'Open'], ['Accepted', 'Accepted'], ['Rejected', 'Rejected'], ['Cancelled', 'Cancelled'], ['Completed', 'Resolved']];
export interface ThreadComment { id: string; ref: string; author: string; text: string; date: Date | null; mentions: string[] }
export interface CommentThread extends ThreadComment { pageNumber: number; kind: string; replies: ThreadComment[]; state: ReviewState; stateBy: string; stateDate: Date | null }
export interface CommentNotification { threadId: string; commentId: string; pageNumber: number; kind: 'mention' | 'reply'; author: string; text: string }

const N = PDFName.of;
const THREAD_KINDS = new Set(['Text', 'FreeText', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Square', 'Circle', 'Line', 'Polygon', 'PolyLine', 'Ink', 'Stamp', 'Caret', 'FileAttachment']);
const text = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '');
function date(o: unknown): Date | null {
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(text(o));
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  const offset = m[7] === '+' || m[7] === '-' ? (m[7] === '+' ? 1 : -1) * (Number(m[8] ?? 0) * 60 + Number(m[9] ?? 0)) : 0;
  return new Date(utc - offset * 60000);
}

/** The people a comment mentions: @name or @[First Last]. */
export function mentionsIn(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/(?<![\w@])@(?:\[([^\]\n]{1,80})\]|([\p{L}\p{N}][\p{L}\p{N}._-]{0,79}))/gu)) {
    const name = (m[1] ?? m[2]).trim().replace(/[.]+$/, '');
    if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}
/** Whether a mention refers to `user`: the full name, or the first name when written as one word. */
export function mentionsUser(mention: string, user: string): boolean {
  const a = mention.toLowerCase().replace(/[._-]+/g, ' ').trim(); const b = user.toLowerCase().trim();
  return !!b && (a === b || a === b.split(/\s+/)[0] || a.replace(/\s+/g, '') === b.replace(/\s+/g, ''));
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); } catch { throw new Error('This PDF could not be read because it is encrypted, invalid or damaged.'); }
}
const idOf = (dict: PDFDict, ref: PDFRef) => text(dict.lookup(N('NM'))) || ref.toString();

export async function listCommentThreads(bytes: Uint8Array): Promise<CommentThread[]> {
  const pdf = await load(bytes);
  const threads = new Map<string, CommentThread>();
  const replies: { parent: string; dict: PDFDict; ref: PDFRef }[] = [];
  pdf.getPages().forEach((page, i) => {
    for (const entry of page.node.lookupMaybe(N('Annots'), PDFArray)?.asArray() ?? []) {
      if (!(entry instanceof PDFRef)) continue;
      const dict = pdf.context.lookup(entry);
      if (!(dict instanceof PDFDict)) continue;
      const kind = dict.get(N('Subtype'))?.toString().slice(1) ?? '';
      const parent = dict.get(N('IRT'));
      if (parent instanceof PDFRef) { replies.push({ parent: parent.toString(), dict, ref: entry }); continue; }
      if (!THREAD_KINDS.has(kind)) continue;
      const body = text(dict.lookup(N('Contents')));
      threads.set(entry.toString(), { id: idOf(dict, entry), ref: entry.toString(), pageNumber: i + 1, kind, author: text(dict.lookup(N('T'))), text: body, date: date(dict.lookup(N('M'))),
        mentions: mentionsIn(body), replies: [], state: 'None', stateBy: '', stateDate: null });
    }
  });
  // Replies can answer replies; follow each one up to its thread.
  const parentOf = new Map(replies.map((r) => [r.ref.toString(), r.parent]));
  const rootOf = (ref: string) => { let at = ref; for (let i = 0; i < 64 && parentOf.has(at); i++) at = parentOf.get(at)!; return at; };
  for (const r of replies) {
    const thread = threads.get(rootOf(r.parent));
    if (!thread) continue;
    const when = date(r.dict.lookup(N('M')));
    const author = text(r.dict.lookup(N('T')));
    if (r.dict.has(N('State')) && text(r.dict.lookup(N('StateModel'))) !== 'Marked' && r.dict.get(N('StateModel'))?.toString() !== '/Marked') {
      const state = (text(r.dict.lookup(N('State'))) || r.dict.get(N('State'))?.toString().slice(1) || 'None') as ReviewState;
      if (!thread.stateDate || (when && when >= thread.stateDate)) { thread.state = state; thread.stateBy = author; thread.stateDate = when; }
      continue;
    }
    const body = text(r.dict.lookup(N('Contents')));
    thread.replies.push({ id: idOf(r.dict, r.ref), ref: r.ref.toString(), author, text: body, date: when, mentions: mentionsIn(body) });
  }
  for (const t of threads.values()) t.replies.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  return [...threads.values()];
}

function findAnnotation(pdf: PDFDocument, ref: string): { dict: PDFDict; ref: PDFRef; pageIndex: number } {
  for (let i = 0; i < pdf.getPageCount(); i++) {
    for (const entry of pdf.getPage(i).node.lookupMaybe(N('Annots'), PDFArray)?.asArray() ?? []) {
      if (entry instanceof PDFRef && entry.toString() === ref) { const dict = pdf.context.lookup(entry); if (dict instanceof PDFDict) return { dict, ref: entry, pageIndex: i }; }
    }
  }
  throw new Error('That comment changed or was removed. Choose it again.');
}
function addReplyAnnotation(pdf: PDFDocument, target: { dict: PDFDict; ref: PDFRef; pageIndex: number }, fields: Record<string, unknown>): PDFRef {
  const rect = target.dict.lookupMaybe(N('Rect'), PDFArray)?.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)) ?? [0, 0, 20, 20];
  const page = pdf.getPage(target.pageIndex);
  // Replies (RT /R) are shown inside their thread by readers, not as separate notes on the page.
  const dict = pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [rect[0], rect[1], rect[0] + 20, rect[1] + 20], F: 4, IRT: target.ref, RT: 'R', P: page.ref,
    M: PDFString.fromDate(new Date()), CreationDate: PDFString.fromDate(new Date()), NM: PDFString.of(`malenjo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`), ...fields } as never);
  const ref = pdf.context.register(dict);
  const annots = page.node.lookupMaybe(N('Annots'), PDFArray);
  if (annots) annots.push(ref); else page.node.set(N('Annots'), pdf.context.obj([ref]));
  return ref;
}
const checkText = (value: string, label: string, max = 4000) => {
  if (!value.trim()) throw new Error(`Enter the ${label}.`);
  if (value.length > max) throw new Error(`The ${label} must be at most ${max.toLocaleString()} characters.`);
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
};

/** Adds a reply to a comment (or to a reply). */
export async function replyToComment(bytes: Uint8Array, ref: string, reply: { text: string; author: string }): Promise<Uint8Array> {
  const pdf = await load(bytes);
  refuseSignedPdf(pdf, 'adding comments');
  const target = findAnnotation(pdf, ref);
  addReplyAnnotation(pdf, target, { Contents: PDFHexString.fromText(checkText(reply.text, 'reply')), T: PDFHexString.fromText(checkText(reply.author, 'your name', 160)), Name: N('Comment') });
  return pdf.save({ useObjectStreams: false });
}
/** Records a review state on a thread (Completed = resolved; None reopens it). */
export async function setCommentState(bytes: Uint8Array, ref: string, state: ReviewState, author: string): Promise<Uint8Array> {
  if (!REVIEW_STATES.some(([s]) => s === state)) throw new Error('Choose one of the listed states.');
  const pdf = await load(bytes);
  refuseSignedPdf(pdf, 'changing comments');
  const target = findAnnotation(pdf, ref);
  const label = REVIEW_STATES.find(([s]) => s === state)![1];
  addReplyAnnotation(pdf, target, { StateModel: PDFString.of('Review'), State: PDFString.of(state), T: PDFHexString.fromText(checkText(author, 'your name', 160)),
    Contents: PDFHexString.fromText(`${label} by ${author}`) });
  return pdf.save({ useObjectStreams: false });
}

/** What is new for `user`: mentions of them and replies to their comments, by others, not in `seen`. */
export function commentNotifications(threads: CommentThread[], user: string, seen: Set<string>): CommentNotification[] {
  const me = (name: string) => !!user.trim() && name.trim().toLowerCase() === user.trim().toLowerCase();
  const out: CommentNotification[] = [];
  for (const t of threads) {
    const comments: ThreadComment[] = [t, ...t.replies];
    const iParticipate = comments.some((c) => me(c.author));
    comments.forEach((c, i) => {
      if (me(c.author) || seen.has(c.id)) return;
      if (c.mentions.some((m) => mentionsUser(m, user))) out.push({ threadId: t.id, commentId: c.id, pageNumber: t.pageNumber, kind: 'mention', author: c.author, text: c.text });
      else if (i > 0 && iParticipate) out.push({ threadId: t.id, commentId: c.id, pageNumber: t.pageNumber, kind: 'reply', author: c.author, text: c.text });
    });
  }
  return out;
}
