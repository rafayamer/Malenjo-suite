import type { LibraryDocument, LibraryDocumentKind } from './types';

const SESSION_KEY = 'malenjo:shell:sessions:v1';
const DB_NAME = 'malenjo-recovery-v1';
const DB_VERSION = 1;
const FILE_STORE = 'browser-files';
const WORKING_STORE = 'working-copies';

export interface PersistedSessionDescriptor {
  documentId: string;
  openedAt: number;
  runtime: 'native-library' | 'browser-session';
}

export interface ShellSessionManifest {
  version: 1;
  activeDocumentId: string | null;
  documents: PersistedSessionDescriptor[];
}

export interface WorkingCopy {
  version: 1;
  documentId: string;
  name: string;
  kind: LibraryDocumentKind;
  updatedAt: number;
  bytes: Uint8Array;
}

interface BrowserFileRecord {
  version: 1;
  document: Omit<LibraryDocument, 'browserFile'>;
  file: File;
}

interface WorkingCopyRecord {
  version: 1;
  documentId: string;
  name: string;
  kind: LibraryDocumentKind;
  updatedAt: number;
  bytes: ArrayBuffer;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function encodeSessionManifest(manifest: ShellSessionManifest): string {
  return JSON.stringify(manifest);
}

export function decodeSessionManifest(value: string | null): ShellSessionManifest {
  if (!value) return { version: 1, activeDocumentId: null, documents: [] };
  try {
    const parsed = JSON.parse(value) as Partial<ShellSessionManifest>;
    if (parsed.version !== 1 || !Array.isArray(parsed.documents)) {
      return { version: 1, activeDocumentId: null, documents: [] };
    }
    const documents = parsed.documents
      .filter((item): item is PersistedSessionDescriptor =>
        !!item
        && typeof item.documentId === 'string'
        && Number.isFinite(item.openedAt)
        && (item.runtime === 'native-library' || item.runtime === 'browser-session'),
      )
      .map((item) => ({
        documentId: item.documentId.slice(0, 300),
        openedAt: Math.max(0, item.openedAt),
        runtime: item.runtime,
      }))
      .slice(0, 50);

    return {
      version: 1,
      activeDocumentId: typeof parsed.activeDocumentId === 'string'
        ? parsed.activeDocumentId.slice(0, 300)
        : null,
      documents,
    };
  } catch {
    return { version: 1, activeDocumentId: null, documents: [] };
  }
}

export function loadSessionManifest(): ShellSessionManifest {
  return decodeSessionManifest(safeStorage()?.getItem(SESSION_KEY) ?? null);
}

export function saveSessionManifest(manifest: ShellSessionManifest): void {
  safeStorage()?.setItem(SESSION_KEY, encodeSessionManifest(manifest));
}

export function clearSessionManifest(): void {
  safeStorage()?.removeItem(SESSION_KEY);
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: 'document.id' });
      if (!db.objectStoreNames.contains(WORKING_STORE)) db.createObjectStore(WORKING_STORE, { keyPath: 'documentId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open MALENJO recovery database.'));
  });
}

async function transact<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    action(store, resolve, reject);
    tx.onerror = () => reject(tx.error ?? new Error('MALENJO recovery transaction failed.'));
    tx.oncomplete = () => db.close();
  }).catch(() => {
    db.close();
    return null as T;
  });
}

export async function persistBrowserDocument(document: LibraryDocument): Promise<void> {
  if (!document.browserFile) return;
  const copy: Omit<LibraryDocument, 'browserFile'> = { ...document };
  delete (copy as Partial<LibraryDocument>).browserFile;
  const record: BrowserFileRecord = { version: 1, document: copy, file: document.browserFile };
  await transact<void>(FILE_STORE, 'readwrite', (store, resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function loadPersistedBrowserDocuments(): Promise<LibraryDocument[]> {
  const records = await transact<BrowserFileRecord[]>(FILE_STORE, 'readonly', (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result ?? []) as BrowserFileRecord[]);
    request.onerror = () => reject(request.error);
  });
  return (records ?? [])
    .filter((record) => record?.version === 1 && record.file instanceof File && record.document?.id)
    .map((record) => ({ ...record.document, browserFile: record.file, ephemeral: true }));
}

export async function deletePersistedBrowserDocument(documentId: string): Promise<void> {
  await transact<void>(FILE_STORE, 'readwrite', (store, resolve, reject) => {
    const request = store.delete(documentId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export async function saveWorkingCopy(
  document: Pick<LibraryDocument, 'id' | 'name' | 'kind'>,
  bytes: Uint8Array,
): Promise<void> {
  if (!bytes.byteLength) return;
  const record: WorkingCopyRecord = {
    version: 1,
    documentId: document.id,
    name: document.name,
    kind: document.kind,
    updatedAt: Date.now(),
    bytes: ownedBuffer(bytes),
  };
  await transact<void>(WORKING_STORE, 'readwrite', (store, resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function loadWorkingCopy(documentId: string): Promise<WorkingCopy | null> {
  const record = await transact<WorkingCopyRecord | undefined>(WORKING_STORE, 'readonly', (store, resolve, reject) => {
    const request = store.get(documentId);
    request.onsuccess = () => resolve(request.result as WorkingCopyRecord | undefined);
    request.onerror = () => reject(request.error);
  });
  if (!record || record.version !== 1 || !(record.bytes instanceof ArrayBuffer)) return null;
  return {
    version: 1,
    documentId: record.documentId,
    name: record.name,
    kind: record.kind,
    updatedAt: record.updatedAt,
    bytes: new Uint8Array(record.bytes.slice(0)),
  };
}

export async function deleteWorkingCopy(documentId: string): Promise<void> {
  await transact<void>(WORKING_STORE, 'readwrite', (store, resolve, reject) => {
    const request = store.delete(documentId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
