import type { DocumentSession } from './session';
import type { LibraryDocument } from './types';

export const SESSION_STORAGE_KEY = 'malenjo.openSessions.v1';

export interface PersistedSessionEntry {
  documentId: string;
  pinned: boolean;
}

export interface PersistedSessionState {
  version: 1;
  sessions: PersistedSessionEntry[];
  activeDocumentId: string | null;
}

export function serializeSessionState(
  sessions: DocumentSession[],
  activeSessionId: string | null,
): PersistedSessionState {
  const desktopSessions = sessions.filter((session) => !session.document.ephemeral && !session.document.browserFile);
  const active = desktopSessions.find((session) => session.id === activeSessionId) ?? null;
  return {
    version: 1,
    sessions: desktopSessions.map((session) => ({
      documentId: session.document.id,
      pinned: session.pinned,
    })),
    activeDocumentId: active?.document.id ?? null,
  };
}

export function parseSessionState(value: string | null): PersistedSessionState {
  if (!value) return { version:1, sessions:[], activeDocumentId:null };
  try {
    const parsed = JSON.parse(value) as Partial<PersistedSessionState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
      return { version:1, sessions:[], activeDocumentId:null };
    }
    const seen = new Set<string>();
    const sessions = parsed.sessions
      .filter((entry): entry is PersistedSessionEntry =>
        !!entry
        && typeof entry.documentId === 'string'
        && entry.documentId.length > 0
        && typeof entry.pinned === 'boolean',
      )
      .filter((entry) => {
        if (seen.has(entry.documentId)) return false;
        seen.add(entry.documentId);
        return true;
      })
      .slice(0, 40);
    return {
      version:1,
      sessions,
      activeDocumentId: typeof parsed.activeDocumentId === 'string' ? parsed.activeDocumentId : null,
    };
  } catch {
    return { version:1, sessions:[], activeDocumentId:null };
  }
}

export function resolveRestorableDocuments(
  state: PersistedSessionState,
  documents: LibraryDocument[],
): Array<{document:LibraryDocument;pinned:boolean}> {
  const available = new Map(
    documents.filter((document) => document.available).map((document) => [document.id, document] as const),
  );
  return state.sessions.flatMap((entry) => {
    const document = available.get(entry.documentId);
    return document ? [{ document, pinned:entry.pinned }] : [];
  });
}
