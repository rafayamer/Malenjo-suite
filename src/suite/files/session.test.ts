import { describe, expect, it } from 'vitest';
import { createDocumentSession, markDocumentDirty, markDocumentSaved } from './session';
import type { LibraryDocument } from './types';

const document: LibraryDocument = {
  id: 'doc-1',
  name: 'Example.pdf',
  extension: 'pdf',
  kind: 'pdf',
  sizeBytes: 12,
  modifiedMs: 1,
  addedMs: 1,
  lastOpenedMs: null,
  available: true,
  locationLabel: 'Documents',
};

describe('document session dirty state', () => {
  it('starts clean, becomes dirty and returns clean after save', () => {
    const opened = createDocumentSession(document, 100);
    expect(opened.dirty).toBe(false);

    const dirty = markDocumentDirty(opened);
    expect(dirty.dirty).toBe(true);

    const saved = markDocumentSaved(dirty, document, 200);
    expect(saved.dirty).toBe(false);
    expect(saved.lastSavedAt).toBe(200);
  });
});
