import type { LibraryDocument } from './types';

export interface DocumentSession {
  document: LibraryDocument;
  dirty: boolean;
  openedAt: number;
  lastSavedAt: number | null;
}

export function createDocumentSession(document: LibraryDocument, openedAt = Date.now()): DocumentSession {
  return { document, dirty: false, openedAt, lastSavedAt: null };
}

export function markDocumentDirty(session: DocumentSession): DocumentSession {
  if (session.dirty) return session;
  return { ...session, dirty: true };
}

export function markDocumentSaved(
  session: DocumentSession,
  document: LibraryDocument = session.document,
  savedAt = Date.now(),
): DocumentSession {
  return { ...session, document, dirty: false, lastSavedAt: savedAt };
}
