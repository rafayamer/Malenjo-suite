import type { DocumentSession } from './session';
import type { LibraryDocument } from './types';

/**
 * Persisted open-tab state. Only references are stored: desktop library
 * document ids and the last viewed PDF page. Document bytes are never stored.
 * Browser/Codespaces files are session-only, so only their count is kept to
 * explain on the next start that they were not restored.
 */
export interface SavedWorkspace {
  version: 1;
  tabs: { documentId: string; page?: number }[];
  activeDocumentId: string | null;
  temporaryCount: number;
}

export const WORKSPACE_STORAGE_KEY = 'malenjo.workspace.v1';
const MAX_TABS = 50;
const MAX_ID_LENGTH = 512;

type PdfViews = Record<string, { page: number } | undefined>;
type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function snapshotWorkspace(
  sessions: DocumentSession[],
  activeSessionId: string | null,
  pdfViews: PdfViews,
): SavedWorkspace {
  const persistent = sessions.filter((session) => !session.document.browserFile && !session.document.ephemeral);
  const active = persistent.find((session) => session.id === activeSessionId);
  return {
    version: 1,
    tabs: persistent.slice(0, MAX_TABS).map((session) => {
      const page = pdfViews[session.id]?.page;
      return validPage(page) && page > 1
        ? { documentId: session.document.id, page }
        : { documentId: session.document.id };
    }),
    activeDocumentId: active ? active.document.id : null,
    temporaryCount: sessions.length - persistent.length,
  };
}

function validPage(page: unknown): page is number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= 1_000_000;
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH;
}

/** Parses untrusted stored JSON; anything malformed is treated as no saved state. */
export function parseSavedWorkspace(raw: string | null): SavedWorkspace | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.tabs)) return null;
  const seen = new Set<string>();
  const tabs: SavedWorkspace['tabs'] = [];
  for (const tab of record.tabs.slice(0, MAX_TABS)) {
    if (!tab || typeof tab !== 'object') continue;
    const { documentId, page } = tab as Record<string, unknown>;
    if (!validId(documentId) || seen.has(documentId)) continue;
    seen.add(documentId);
    tabs.push(validPage(page) && page > 1 ? { documentId, page } : { documentId });
  }
  const activeDocumentId = validId(record.activeDocumentId) && seen.has(record.activeDocumentId)
    ? record.activeDocumentId : null;
  const temporaryCount = typeof record.temporaryCount === 'number' && Number.isInteger(record.temporaryCount)
    ? Math.min(Math.max(record.temporaryCount, 0), 10_000) : 0;
  return { version: 1, tabs, activeDocumentId, temporaryCount };
}

export function readSavedWorkspace(storage: KeyValueStore): SavedWorkspace | null {
  try { return parseSavedWorkspace(storage.getItem(WORKSPACE_STORAGE_KEY)); } catch { return null; }
}

export function writeSavedWorkspace(storage: KeyValueStore, workspace: SavedWorkspace): void {
  try {
    if (!workspace.tabs.length && !workspace.temporaryCount) storage.removeItem(WORKSPACE_STORAGE_KEY);
    else storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
  } catch { /* storage unavailable (private mode, quota): restore is best effort */ }
}

export interface RestorePlan {
  documents: { document: LibraryDocument; page?: number }[];
  activeDocumentId: string | null;
  /** Saved tabs whose library entry is gone or whose file is unavailable. */
  unavailableCount: number;
  temporaryCount: number;
}

/** Matches saved tabs to the current library, in the saved order. */
export function planWorkspaceRestore(saved: SavedWorkspace, library: LibraryDocument[]): RestorePlan {
  const byId = new Map(library.map((document) => [document.id, document]));
  const documents: RestorePlan['documents'] = [];
  let unavailableCount = 0;
  for (const tab of saved.tabs) {
    const document = byId.get(tab.documentId);
    if (!document || !document.available) { unavailableCount++; continue; }
    documents.push(tab.page ? { document, page: tab.page } : { document });
  }
  const activeDocumentId = documents.some((item) => item.document.id === saved.activeDocumentId)
    ? saved.activeDocumentId : documents.at(-1)?.document.id ?? null;
  return { documents, activeDocumentId, unavailableCount, temporaryCount: saved.temporaryCount };
}

/** Plain-language notice for anything that could not come back, or ''. */
export function restoreNotice(plan: Pick<RestorePlan, 'unavailableCount' | 'temporaryCount'>): string {
  const parts: string[] = [];
  if (plan.unavailableCount) {
    parts.push(`${plan.unavailableCount} document${plan.unavailableCount === 1 ? '' : 's'} from your last session ${plan.unavailableCount === 1 ? 'is' : 'are'} no longer available at ${plan.unavailableCount === 1 ? 'its' : 'their'} saved location.`);
  }
  if (plan.temporaryCount) {
    parts.push(`${plan.temporaryCount} temporary browser file${plan.temporaryCount === 1 ? ' was' : 's were'} not kept from your last session. Browser files are session-only; open ${plan.temporaryCount === 1 ? 'it' : 'them'} again to continue.`);
  }
  return parts.join(' ');
}
