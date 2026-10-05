import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, FilePlus2, FolderOpen, RefreshCw, Search, Trash2 } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
  chooseAndAddDocuments,
  isDesktopRuntime,
  listLibraryDocuments,
  openLibraryDocument,
  refreshLibraryDocument,
  removeLibraryDocument,
  saveAsLibraryDocument,
} from './api';
import type { LibraryDocument } from './types';

interface Props {
  onOpen(document: LibraryDocument): void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

export default function FileLibrary({ onOpen }: Props) {
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>('');

  const load = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setNotice('The local document library is available in the MALENJO desktop app.');
      return;
    }
    try {
      setDocuments(await listLibraryDocuments());
      setNotice('');
    } catch (error) {
      setNotice(String(error));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return documents;
    return documents.filter((document) =>
      [document.name, document.extension, document.kind, document.locationLabel]
        .some((field) => field.toLowerCase().includes(value)),
    );
  }, [documents, query]);

  async function addFiles() {
    setBusy(true);
    try {
      const result = await chooseAndAddDocuments();
      if (!result) return;
      await load();
      setNotice(result.errors.length
        ? `Added ${result.documents.length} document(s); ${result.errors.length} could not be added.`
        : `Added ${result.documents.length} document(s).`);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(document: LibraryDocument) {
    setBusy(true);
    try {
      const refreshed = await openLibraryDocument(document.id);
      await load();
      onOpen(refreshed);
    } catch (error) {
      setNotice(String(error));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function refreshDocument(document: LibraryDocument) {
    try {
      const refreshed = await refreshLibraryDocument(document.id);
      setDocuments((current) => current.map((item) => item.id === refreshed.id ? refreshed : item));
    } catch (error) {
      setNotice(String(error));
    }
  }

  async function saveCopy(document: LibraryDocument) {
    setBusy(true);
    try {
      const copy = await saveAsLibraryDocument(document);
      if (!copy) return;
      await load();
      setNotice(`Saved and added ${copy.name} to the library.`);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(document: LibraryDocument) {
    const approved = await confirm(
      `Remove "${document.name}" from the MALENJO library? The original file will not be deleted.`,
      { title: 'MALENJO Suite', kind: 'warning' },
    );
    if (!approved) return;
    try {
      await removeLibraryDocument(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setNotice('Removed from MALENJO library. The original file was not deleted.');
    } catch (error) {
      setNotice(String(error));
    }
  }

  return <div className="content library-view">
    <div className="library-head">
      <div>
        <p className="eyebrow">FILES / DOCUMENT LIBRARY</p>
        <h1>One library for every workspace.</h1>
        <p>MALENJO indexes references to your local files. Adding or removing a library entry never moves or deletes the original document.</p>
      </div>
      <button className="primary-action" disabled={busy || !isDesktopRuntime()} onClick={() => void addFiles()}>
        <FilePlus2 size={17}/> Add files
      </button>
    </div>

    <div className="library-toolbar">
      <div className="library-search"><Search size={16}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Filter this library"/></div>
      <button onClick={() => void load()} disabled={busy}><RefreshCw size={15}/> Refresh</button>
      <span>{documents.length} document{documents.length === 1 ? '' : 's'}</span>
    </div>

    {notice && <div className="library-notice">{notice}</div>}

    <div className="library-table" role="table" aria-label="MALENJO document library">
      <div className="library-row header" role="row">
        <span>Name</span><span>Type</span><span>Location</span><span>Size</span><span>Modified</span><span>Actions</span>
      </div>
      {filtered.map((document) => <div className={document.available ? 'library-row' : 'library-row unavailable'} role="row" key={document.id}>
        <button className="file-name" disabled={!document.available || busy} onClick={() => void openDocument(document)}>
          <FolderOpen size={17}/><span><b>{document.name}</b><small>{document.available ? 'Available' : 'File moved or unavailable'}</small></span>
        </button>
        <span className="type-chip">{document.kind.toUpperCase()}</span>
        <span>{document.locationLabel}</span>
        <span>{document.available ? formatBytes(document.sizeBytes) : '—'}</span>
        <span>{document.available ? formatDate(document.modifiedMs) : '—'}</span>
        <div className="library-actions">
          <button title="Open in MALENJO" disabled={!document.available || busy} onClick={() => void openDocument(document)}><FolderOpen size={15}/></button>
          <button title="Save a copy" disabled={!document.available || busy} onClick={() => void saveCopy(document)}><Copy size={15}/></button>
          <button title="Refresh metadata" disabled={busy} onClick={() => void refreshDocument(document)}><RefreshCw size={15}/></button>
          <button title="Remove from library" disabled={busy} onClick={() => void remove(document)}><Trash2 size={15}/></button>
        </div>
      </div>)}
      {!filtered.length && <div className="library-empty">
        <FolderOpen size={30}/><h3>{documents.length ? 'No matching documents' : 'Your library is empty'}</h3>
        <p>{documents.length ? 'Change the filter to see other files.' : 'Add PDFs, Office files, images, CAD or DICOM documents to begin.'}</p>
      </div>}
    </div>
  </div>
}
