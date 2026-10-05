import type { DocumentSession } from '../files/session';

export interface PersistedWorkspaceState {
  version: 1;
  nativeDocumentIds: string[];
  activeDocumentId: string | null;
}

export const WORKSPACE_STATE_KEY = 'malenjo.workspace.v1';

function isPersistable(session: DocumentSession): boolean {
  return !session.document.ephemeral && !session.document.browserFile;
}

export function buildWorkspaceState(
  sessions: DocumentSession[],
  activeSessionId: string | null,
): PersistedWorkspaceState {
  const persistable = sessions.filter(isPersistable);
  const nativeDocumentIds = Array.from(new Set(persistable.map((session) => session.document.id)));
  const active = persistable.find((session) => session.id === activeSessionId);

  return {
    version: 1,
    nativeDocumentIds,
    activeDocumentId: active?.document.id ?? null,
  };
}

export function parseWorkspaceState(raw: string | null): PersistedWorkspaceState {
  if (!raw) return { version:1, nativeDocumentIds:[], activeDocumentId:null };

  try {
    const value = JSON.parse(raw) as Partial<PersistedWorkspaceState>;
    if (value.version !== 1 || !Array.isArray(value.nativeDocumentIds)) {
      return { version:1, nativeDocumentIds:[], activeDocumentId:null };
    }

    const ids = Array.from(new Set(
      value.nativeDocumentIds
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 256),
    )).slice(0, 50);

    const activeDocumentId = typeof value.activeDocumentId === 'string' && ids.includes(value.activeDocumentId)
      ? value.activeDocumentId
      : null;

    return { version:1, nativeDocumentIds:ids, activeDocumentId };
  } catch {
    return { version:1, nativeDocumentIds:[], activeDocumentId:null };
  }
}

export function readWorkspaceState(storage: Pick<Storage,'getItem'>): PersistedWorkspaceState {
  try {
    return parseWorkspaceState(storage.getItem(WORKSPACE_STATE_KEY));
  } catch {
    return { version:1, nativeDocumentIds:[], activeDocumentId:null };
  }
}

export function writeWorkspaceState(
  storage: Pick<Storage,'setItem'|'removeItem'>,
  state: PersistedWorkspaceState,
): void {
  try {
    if (!state.nativeDocumentIds.length) {
      storage.removeItem(WORKSPACE_STATE_KEY);
      return;
    }
    storage.setItem(WORKSPACE_STATE_KEY, JSON.stringify(state));
  } catch {
    // Workspace persistence is best-effort and must never block the editor.
  }
}
