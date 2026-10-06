import type { LibraryDocument } from './types';

export interface DocumentSession {
  id: string;
  document: LibraryDocument;
  dirty: boolean;
  saving: boolean;
  sourceFile?: File;
  openedAt: number;
  lastSavedAt: number | null;
}

export function createDocumentSession(
  document: LibraryDocument,
  openedAt = Date.now(),
  sourceFile?: File,
): DocumentSession {
  return {
    id: `session-${document.id}-${openedAt.toString(36)}`,
    document,
    dirty: false,
    saving: false,
    sourceFile,
    openedAt,
    lastSavedAt: null,
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
