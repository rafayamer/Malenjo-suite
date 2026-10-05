import { describe, expect, it } from 'vitest';
import {
  createDocumentSession,
  markDocumentDirty,
  markDocumentSaved,
  markDocumentSaving,
  setDocumentDirty,
} from './session';
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

describe('document session state', () => {
  it('creates a stable tab identity independent from later document replacement', () => {
    const opened = createDocumentSession(document, 100);
    expect(opened.id).toBe('session-doc-1-2s');
    expect(opened.dirty).toBe(false);
    expect(opened.saving).toBe(false);

    const copy = { ...document, id:'doc-copy', name:'Copy.pdf' };
    const saved = markDocumentSaved(opened, copy, 200);
    expect(saved.id).toBe(opened.id);
    expect(saved.document.id).toBe('doc-copy');
  });

  it('can return a tab to a clean state without pretending to save', () => {
    const opened = createDocumentSession(document, 100);
    const dirty = setDocumentDirty(opened, true);
    const clean = setDocumentDirty(dirty, false);
    expect(clean.dirty).toBe(false);
    expect(clean.lastSavedAt).toBeNull();
  });

  it('tracks dirty, saving and saved states independently', () => {
    const opened = createDocumentSession(document, 100);
    const dirty = markDocumentDirty(opened);
    expect(dirty.dirty).toBe(true);

    const saving = markDocumentSaving(dirty);
    expect(saving.saving).toBe(true);
    expect(saving.dirty).toBe(true);

    const saved = markDocumentSaved(saving, document, 200);
    expect(saved.dirty).toBe(false);
    expect(saved.saving).toBe(false);
    expect(saved.lastSavedAt).toBe(200);
  });
  it('pins sessions without changing dirty/save state', () => {
    const session = markDocumentDirty(createDocumentSession(document, 10));
    const pinned = setDocumentPinned(session, true);
    expect(pinned.pinned).toBe(true);
    expect(pinned.dirty).toBe(true);
    expect(pinned.lastSavedAt).toBeNull();
  });

  it('duplicates a document into an independent clean unpinned session', () => {
    const original = setDocumentPinned(markDocumentDirty(createDocumentSession(document, 10)), true);
    const duplicate = duplicateDocumentSession(original, 20);
    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.document.id).toBe(original.document.id);
    expect(duplicate.dirty).toBe(false);
    expect(duplicate.pinned).toBe(false);
  });
});
