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
});


describe('multi-document session ordering', () => {
  const docs = ['a.pdf','b.pdf','c.pdf'].map((name,index) => ({
    id:`doc-${index}`,
    name,
    extension:'pdf',
    kind:'pdf' as const,
    sizeBytes:100,
    modifiedMs:1,
    addedMs:1,
    lastOpenedMs:null,
    available:true,
    locationLabel:'test',
  }));
  const sessions = docs.map((document,index)=>createDocumentSession(document,index+1));

  it('reorders tabs without changing session identity', () => {
    const next = reorderDocumentSessions(sessions, sessions[0].id, sessions[2].id);
    expect(next.map((session)=>session.document.name)).toEqual(['b.pdf','c.pdf','a.pdf']);
    expect(next[2]).toBe(sessions[0]);
  });

  it('cycles forward and backward across document tabs', () => {
    expect(cycleDocumentSessionId(sessions, sessions[0].id, 1)).toBe(sessions[1].id);
    expect(cycleDocumentSessionId(sessions, sessions[0].id, -1)).toBe(sessions[2].id);
    expect(cycleDocumentSessionId(sessions, null, 1)).toBe(sessions[0].id);
  });
});
