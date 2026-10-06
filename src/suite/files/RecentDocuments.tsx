import { useEffect, useState } from 'react';
import { Clock3, FileText } from 'lucide-react';
import { isDesktopRuntime, listLibraryDocuments, openLibraryDocument } from './api';
import { listBrowserDocuments, openBrowserDocument } from './browserStore';
import { listBrowserDocuments, markBrowserDocumentOpened } from './browserStore';
import type { LibraryDocument } from './types';

interface Props {
  onOpen(document: LibraryDocument): void;
  onViewAll(): void;
}

export default function RecentDocuments({ onOpen, onViewAll }: Props) {
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);

  useEffect(() => {
    if (!isDesktopRuntime()) {
      setDocuments(listBrowserDocuments().filter((item) => item.available).slice(0, 5));
      return;
    }
    void listLibraryDocuments()
      .then((items) => setDocuments(items.filter((item) => item.available).slice(0, 5)))
      .catch(() => setDocuments([]));
  }, []);

  async function openDocument(document: LibraryDocument) {
    if (!isDesktopRuntime()) {
      onOpen(markBrowserDocumentOpened(document));
      return;
    }
    try {
      onOpen(await openLibraryDocument(document.id));
    } catch {
      onViewAll();
    }
  }

  return <section className="recent-section">
    <div className="section-head">
      <div><h2>Recent documents</h2><p>Your latest local files, across every MALENJO workspace.</p></div>
      <button className="text-action" onClick={onViewAll}>View library</button>
    </div>
    {documents.length
      ? <div className="recent-list">{documents.map((document) => <button key={document.id} onClick={() => void openDocument(document)}>
          <div className="recent-icon"><FileText size={18}/></div>
          <span className="recent-name">{document.name}</span>
          <span className="recent-kind">{document.kind.toUpperCase()}</span>
          <span className="recent-location">{document.locationLabel}</span>
          <span className="recent-time"><Clock3 size={13}/>{document.lastOpenedMs ? new Date(document.lastOpenedMs).toLocaleDateString() : 'Added'}</span>
        </button>)}</div>
      : <div className="recent-empty"><Clock3 size={20}/><span>No recent documents yet. Add a file to the MALENJO library to begin.</span></div>}
  </section>
}
