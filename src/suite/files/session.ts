import type { LibraryDocument } from './types';

export interface DocumentSession {
  id: string;
  document: LibraryDocument;
  dirty: boolean;
  saving: boolean;
  openedAt: number;
  lastSavedAt: number | null;
  browserFile: File | null;
}

export function createDocumentSession(
  document: LibraryDocument,
  browserFile: File | null = null,
  openedAt = Date.now(),
): DocumentSession {
  return {
    id: `session:${document.id}`,
    document,
    dirty: false,
    saving: false,
    openedAt,
    lastSavedAt: null,
    browserFile,
  };
}

export function markDocumentDirty(session: DocumentSession): DocumentSession {
  if (session.dirty) return session;
  return { ...session, dirty: true };
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
