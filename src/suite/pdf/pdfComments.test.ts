import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addPdfDrawing } from './pdfMarkup';
import { commentNotifications, listCommentThreads, mentionsIn, mentionsUser, replyToComment, setCommentState } from './pdfComments';

const style = { color: '#e0b000', opacity: 1, width: 1 };
async function withNote(text: string, author: string) {
  const pdf = await PDFDocument.create(); pdf.addPage([400, 400]);
  return addPdfDrawing(await pdf.save(), { pageNumber: 1, viewRotation: 0, kind: 'Note', points: [{ x: 0.5, y: 0.5 }], text, author, style });
}

describe('Threaded comments and mentions (MAL-056)', () => {
  it('reads mentions', () => {
    expect(mentionsIn('Please check @Dana and @[Sam Lee], cc @omar.k. Email me@example.com')).toEqual(['Dana', 'Sam Lee', 'omar.k']);
    expect(mentionsUser('Dana', 'Dana Reviewer')).toBe(true); expect(mentionsUser('dana.reviewer', 'Dana Reviewer')).toBe(true); expect(mentionsUser('Dan', 'Dana Reviewer')).toBe(false);
  });

  it('keeps threads, replies, resolution and notifications in the PDF', async () => {
    let bytes = await withNote('Is this figure right, @Dana?', 'Sam Lee');
    const [first] = await listCommentThreads(bytes);
    expect(first).toMatchObject({ author: 'Sam Lee', text: 'Is this figure right, @Dana?', mentions: ['Dana'], state: 'None', replies: [] });
    // Dana is told about the mention; Sam is not told about his own comment.
    expect(commentNotifications([first], 'Dana Reviewer', new Set()).map((n) => n.kind)).toEqual(['mention']);
    expect(commentNotifications([first], 'Sam Lee', new Set())).toEqual([]);
    bytes = await replyToComment(bytes, first.ref, { text: 'Yes, it matches the ledger. @[Sam Lee] see page 3.', author: 'Dana Reviewer' });
    let [thread] = await listCommentThreads(bytes);
    const reply = thread.replies[0];
    bytes = await replyToComment(bytes, reply.ref, { text: 'Thanks!', author: 'Sam Lee' }); // a reply to the reply joins the same thread
    bytes = await setCommentState(bytes, first.ref, 'Completed', 'Sam Lee');
    [thread] = await listCommentThreads(bytes);
    expect(thread.replies.map((r) => `${r.author}: ${r.text}`)).toEqual(['Dana Reviewer: Yes, it matches the ledger. @[Sam Lee] see page 3.', 'Sam Lee: Thanks!']);
    expect(thread).toMatchObject({ state: 'Completed', stateBy: 'Sam Lee' });
    // Sam sees Dana's mention of him; once seen, it is no longer new. Dana sees Sam's reply in her thread.
    expect(commentNotifications([thread], 'Sam Lee', new Set()).map((n) => `${n.kind}:${n.author}`)).toEqual(['mention:Dana Reviewer']);
    expect(commentNotifications([thread], 'Sam Lee', new Set([reply.id]))).toEqual([]);
    expect(commentNotifications([thread], 'Dana Reviewer', new Set([first.id])).map((n) => `${n.kind}:${n.text}`)).toEqual(['reply:Thanks!']);
    // Reopening.
    bytes = await setCommentState(bytes, first.ref, 'None', 'Dana Reviewer');
    expect((await listCommentThreads(bytes))[0].state).toBe('None');
    // Other readers see the same thread: PDF.js reports the replies as replies (IRT) with the review state.
    const loading = getDocument({ data: bytes.slice() } as never);
    const annots = await (await (await loading.promise).getPage(1)).getAnnotations() as { inReplyTo?: string; contentsObj: { str: string } }[];
    await loading.destroy();
    expect(annots.filter((a) => a.inReplyTo).length).toBe(4);
  });
});
