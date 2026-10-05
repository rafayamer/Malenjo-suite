import { FileText, X } from 'lucide-react';
import type { DocumentSession } from '../files/session';

interface Props {
  sessions: DocumentSession[];
  activeSessionId: string | null;
  onActivate(sessionId: string): void;
  onClose(sessionId: string): void;
}

export default function DocumentTabs({ sessions, activeSessionId, onActivate, onClose }: Props) {
  if (!sessions.length) return null;

  return <div className="document-tabs" role="tablist" aria-label="Open documents">
    <div className="document-tabs-scroll">
      {sessions.map((session) => {
        const active = session.id === activeSessionId;
        return <div
          className={active ? 'document-tab active' : 'document-tab'}
          key={session.id}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              onClose(session.id);
            }
          }}
        >
          <button
            className="document-tab-main"
            role="tab"
            aria-selected={active}
            title={session.document.name}
            onClick={() => onActivate(session.id)}
          >
            <FileText size={14}/>
            <span>{session.document.name}</span>
            <i className={session.saving ? 'saving' : session.dirty ? 'dirty' : 'saved'} aria-label={session.saving ? 'Saving' : session.dirty ? 'Unsaved changes' : 'Saved'}/>
          </button>
          <button
            className="document-tab-close"
            aria-label={`Close ${session.document.name}`}
            title="Close"
            onClick={() => onClose(session.id)}
          ><X size={13}/></button>
        </div>;
      })}
    </div>
  </div>;
}
