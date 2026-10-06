import type { LibraryDocument } from './types';

export interface DocumentSession {
  id: string;
  document: LibraryDocument;
  dirty: boolean;
  saving: boolean;
  openedAt: number;
  lastSavedAt: number | null;
}

export function createDocumentSession(document: LibraryDocument, openedAt = Date.now()): DocumentSession {
  return {
    id: `session-${document.id}-${openedAt.toString(36)}`,
    document,
    dirty: false,
    saving: false,
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


export function reorderDocumentSessions(
  sessions: DocumentSession[],
  draggedId: string,
  targetId: string,
): DocumentSession[] {
  if (!draggedId || !targetId || draggedId === targetId) return sessions;
  const from = sessions.findIndex((session) => session.id === draggedId);
  const to = sessions.findIndex((session) => session.id === targetId);
  if (from < 0 || to < 0) return sessions;

  const next = [...sessions];
  const [dragged] = next.splice(from, 1);
  next.splice(to, 0, dragged);
  return next;
}

export function cycleDocumentSessionId(
  sessions: DocumentSession[],
  activeSessionId: string | null,
  direction: 1 | -1,
): string | null {
  if (!sessions.length) return null;
  const current = activeSessionId
    ? sessions.findIndex((session) => session.id === activeSessionId)
    : -1;
  const index = current < 0
    ? (direction === 1 ? 0 : sessions.length - 1)
    : (current + direction + sessions.length) % sessions.length;
  return sessions[index]?.id ?? null;
}
