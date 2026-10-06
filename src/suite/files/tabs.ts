import { createDocumentSession, type DocumentSession } from './session';
import type { LibraryDocument } from './types';

export interface DocumentTabState {
  sessions: DocumentSession[];
  activeSessionId: string | null;
}

export const emptyDocumentTabs: DocumentTabState = {
  sessions: [],
  activeSessionId: null,
};

export function openDocumentTab(
  state: DocumentTabState,
  document: LibraryDocument,
  browserFile: File | null = null,
): DocumentTabState {
  const existing = state.sessions.find((session) => session.document.id === document.id);
  if (existing) return { ...state, activeSessionId: existing.id };

  const session = createDocumentSession(document, browserFile);
  return {
    sessions: [...state.sessions, session],
    activeSessionId: session.id,
  };
}

export function activateDocumentTab(state: DocumentTabState, sessionId: string): DocumentTabState {
  if (!state.sessions.some((session) => session.id === sessionId)) return state;
  return { ...state, activeSessionId: sessionId };
}

export function leaveDocumentTabs(state: DocumentTabState): DocumentTabState {
  if (state.activeSessionId === null) return state;
  return { ...state, activeSessionId: null };
}

export function updateDocumentTab(
  state: DocumentTabState,
  sessionId: string,
  updater: (session: DocumentSession) => DocumentSession,
): DocumentTabState {
  return {
    ...state,
    sessions: state.sessions.map((session) => session.id === sessionId ? updater(session) : session),
  };
}

export function closeDocumentTab(state: DocumentTabState, sessionId: string): DocumentTabState {
  const index = state.sessions.findIndex((session) => session.id === sessionId);
  if (index < 0) return state;

  const sessions = state.sessions.filter((session) => session.id !== sessionId);
  if (state.activeSessionId !== sessionId) return { ...state, sessions };

  const next = sessions[Math.min(index, sessions.length - 1)] ?? null;
  return {
    sessions,
    activeSessionId: next?.id ?? null,
  };
}

export function cycleDocumentTab(state: DocumentTabState, direction: 1 | -1): DocumentTabState {
  if (state.sessions.length < 2) return state;
  const current = state.sessions.findIndex((session) => session.id === state.activeSessionId);
  const start = current >= 0 ? current : 0;
  const next = (start + direction + state.sessions.length) % state.sessions.length;
  return { ...state, activeSessionId: state.sessions[next].id };
}
