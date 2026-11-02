import { describe, expect, it } from 'vitest';
import { createDocumentSession } from './session';
import {
  parseSavedWorkspace, planWorkspaceRestore, readSavedWorkspace, restoreNotice,
  snapshotWorkspace, WORKSPACE_STORAGE_KEY, writeSavedWorkspace, type SavedWorkspace,
} from './sessionRestore';
import type { LibraryDocument } from './types';

function doc(id: string, extra: Partial<LibraryDocument> = {}): LibraryDocument {
  return {
    id, name: `${id}.pdf`, extension: 'pdf', kind: 'pdf', sizeBytes: 10, modifiedMs: 1, addedMs: 1,
    lastOpenedMs: 1, available: true, locationLabel: 'C:/docs', ...extra,
  };
}

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe('workspace snapshot', () => {
  it('keeps library tabs in order with their PDF page, never browser or ephemeral files', () => {
    const a = createDocumentSession(doc('a'), 1);
    const b = createDocumentSession(doc('b'), 2);
    const temp = createDocumentSession(doc('t', { browserFile: new File([new Uint8Array([1])], 't.pdf') }), 3);
    const eph = createDocumentSession(doc('e', { ephemeral: true }), 4);
    const snapshot = snapshotWorkspace([a, temp, b, eph], b.id, { [a.id]: { page: 7 }, [b.id]: { page: 1 } });
    expect(snapshot).toEqual({
      version: 1,
      tabs: [{ documentId: 'a', page: 7 }, { documentId: 'b' }],
      activeDocumentId: 'b',
      temporaryCount: 2,
    });
    expect(JSON.stringify(snapshot)).not.toContain('C:/docs');
  });

  it('records no active document when a temporary tab is active', () => {
    const a = createDocumentSession(doc('a'), 1);
    const temp = createDocumentSession(doc('t', { browserFile: new File([], 't.pdf') }), 2);
    expect(snapshotWorkspace([a, temp], temp.id, {}).activeDocumentId).toBeNull();
  });
});

describe('stored workspace parsing', () => {
  it('rejects malformed or foreign data', () => {
    for (const raw of [null, '', 'not json', '[]', '{"version":2,"tabs":[]}', '{"version":1}', '42']) {
      expect(parseSavedWorkspace(raw)).toBeNull();
    }
  });

  it('drops invalid, duplicate and oversized entries and clamps counts', () => {
    const raw = JSON.stringify({
      version: 1,
      tabs: [{ documentId: 'a', page: 3 }, { documentId: 'a' }, { documentId: '' }, { documentId: 5 },
        { documentId: 'b', page: -2 }, { documentId: 'c', page: 2.5 }, null, { documentId: 'x'.repeat(600) }],
      activeDocumentId: 'zzz',
      temporaryCount: -4,
    });
    expect(parseSavedWorkspace(raw)).toEqual({
      version: 1, tabs: [{ documentId: 'a', page: 3 }, { documentId: 'b' }, { documentId: 'c' }],
      activeDocumentId: null, temporaryCount: 0,
    });
  });

  it('round-trips through storage and clears it when nothing is open', () => {
    const store = memoryStore();
    const saved: SavedWorkspace = { version: 1, tabs: [{ documentId: 'a', page: 2 }], activeDocumentId: 'a', temporaryCount: 1 };
    writeSavedWorkspace(store, saved);
    expect(readSavedWorkspace(store)).toEqual(saved);
    writeSavedWorkspace(store, { version: 1, tabs: [], activeDocumentId: null, temporaryCount: 0 });
    expect(store.data.has(WORKSPACE_STORAGE_KEY)).toBe(false);
  });

  it('never throws when storage is unavailable', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(readSavedWorkspace(broken)).toBeNull();
    expect(() => writeSavedWorkspace(broken, { version: 1, tabs: [{ documentId: 'a' }], activeDocumentId: null, temporaryCount: 0 })).not.toThrow();
  });
});

describe('restore plan', () => {
  const saved: SavedWorkspace = {
    version: 1,
    tabs: [{ documentId: 'a', page: 4 }, { documentId: 'gone' }, { documentId: 'moved' }, { documentId: 'b' }],
    activeDocumentId: 'a',
    temporaryCount: 0,
  };

  it('reopens available documents in saved order with pages and reports what is missing', () => {
    const plan = planWorkspaceRestore(saved, [doc('b'), doc('moved', { available: false }), doc('a')]);
    expect(plan.documents.map((item) => [item.document.id, item.page])).toEqual([['a', 4], ['b', undefined]]);
    expect(plan.activeDocumentId).toBe('a');
    expect(plan.unavailableCount).toBe(2);
  });

  it('falls back to the last restored tab when the active one is unavailable', () => {
    const plan = planWorkspaceRestore({ ...saved, activeDocumentId: 'gone' }, [doc('a'), doc('b')]);
    expect(plan.activeDocumentId).toBe('b');
    expect(planWorkspaceRestore(saved, []).activeDocumentId).toBeNull();
  });

  it('explains unavailable and temporary files in plain language', () => {
    expect(restoreNotice({ unavailableCount: 0, temporaryCount: 0 })).toBe('');
    expect(restoreNotice({ unavailableCount: 1, temporaryCount: 0 })).toBe(
      '1 document from your last session is no longer available at its saved location.');
    expect(restoreNotice({ unavailableCount: 0, temporaryCount: 2 })).toBe(
      '2 temporary browser files were not kept from your last session. Browser files are session-only; open them again to continue.');
  });
});
