import { describe, expect, it } from 'vitest';
import {
  addBrowserDocuments,
  getBrowserDocumentFile,
  listBrowserDocuments,
  openBrowserDocument,
  readBrowserDocumentBytes,
  removeBrowserDocument,
} from './browserStore';

describe('browser-session document store', () => {
  it('registers several document kinds for normal MALENJO tab sessions', async () => {
    const pdf = new File([new Uint8Array([37,80,68,70])], 'alpha.pdf', { type:'application/pdf', lastModified:10 });
    const docx = new File([new Uint8Array([80,75,3,4])], 'notes.docx', { lastModified:20 });
    const added = addBrowserDocuments([pdf, docx]);

    expect(added).toHaveLength(2);
    expect(added.map((item)=>item.kind)).toEqual(['pdf','docx']);
    expect(added.every((item)=>item.runtimeSource === 'browser-session')).toBe(true);
    expect(listBrowserDocuments().length).toBeGreaterThanOrEqual(2);

    const opened = openBrowserDocument(added[0].id);
    expect(opened.lastOpenedMs).not.toBeNull();
    expect(getBrowserDocumentFile(added[0].id).name).toBe('alpha.pdf');

    const bytes = new Uint8Array(await readBrowserDocumentBytes(added[0].id));
    expect([...bytes]).toEqual([37,80,68,70]);

    for (const document of added) removeBrowserDocument(document.id);
  });

  it('removes the in-memory file together with its library entry', () => {
    const [document] = addBrowserDocuments([new File(['x'], 'temp.xlsx')]);
    expect(removeBrowserDocument(document.id)).toBe(true);
    expect(() => getBrowserDocumentFile(document.id)).toThrow(/no longer available/i);
  });
});
