import type { LibraryDocument } from './types';

export interface DocumentSession {
  id: string;
  document: LibraryDocument;
  dirty: boolean;
  saving: boolean;
  pinned: boolean;
  openedAt: number;
  lastSavedAt: number | null;
}

export function createDocumentSession(document: LibraryDocument, openedAt = Date.now()): DocumentSession {
  return {
    id: `session-${document.id}-${openedAt.toString(36)}`,
    document,
    dirty: false,
    saving: false,
    pinned: false,
    openedAt,
    lastSavedAt: null,
  };
}

export function setDocumentDirty(session: DocumentSession, dirty: boolean): DocumentSession {
  if (session.dirty === dirty) return session;
  return { ...session, dirty };
}

export function markDocumentDirty(session: DocumentSession): DocumentSession {
  return setDocumentDirty(session, true);
}

export function setDocumentPinned(session: DocumentSession, pinned: boolean): DocumentSession {
  if (session.pinned === pinned) return session;
  return { ...session, pinned };
}

export function markDocumentSaving(session: DocumentSession, saving = true): DocumentSession {
  if (session.saving === saving) return session;
  return { ...session, saving };
}

export function markDocumentSaved(
  session: DocumentSession,
  document: LibraryDocument = session.document,
  savedAt = Date.now(),
): DocumentSession {
  return { ...session, document, dirty: false, saving: false, lastSavedAt: savedAt };
}


export function duplicateDocumentSession(session: DocumentSession, openedAt = Date.now()): DocumentSession {
  return {
    ...session,
    id: `session-${session.document.id}-${openedAt.toString(36)}-${Math.random().toString(36).slice(2,7)}`,
    dirty: false,
    saving: false,
    pinned: false,
    openedAt,
    lastSavedAt: null,
  };
}
