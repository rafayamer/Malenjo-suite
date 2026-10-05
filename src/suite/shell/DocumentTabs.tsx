import { useState } from 'react';
import { FileText, MoreHorizontal, X } from 'lucide-react';
import type { DocumentSession } from '../files/session';

interface Props {
  sessions: DocumentSession[];
  activeSessionId: string | null;
  onActivate(sessionId: string): void;
  onClose(sessionId: string): void;
  onCloseOthers(sessionId: string): void;
  onCloseRight(sessionId: string): void;
  onCloseAll(): void;
}

export default function DocumentTabs({
  sessions,
  activeSessionId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseAll,
}: Props) {
  const [menu, setMenu] = useState<{id:string;left:number;top:number} | null>(null);
  if (!sessions.length) return null;

  return <div className="document-tabs" role="tablist" aria-label="Open documents">
    <div className="document-tabs-scroll">
      {sessions.map((session, index) => {
        const active = session.id === activeSessionId;
        const open = menu?.id === session.id;
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
            className="document-tab-menu-button"
            aria-label={`Tab actions for ${session.document.name}`}
            title="Tab actions"
            aria-expanded={open}
            onClick={(event) => {
              if (open) {
                setMenu(null);
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({
                id: session.id,
                left: Math.max(8, Math.min(window.innerWidth - 168, rect.right - 154)),
                top: Math.min(window.innerHeight - 150, rect.bottom + 4),
              });
            }}
          ><MoreHorizontal size={13}/></button>
          <button
            className="document-tab-close"
            aria-label={`Close ${session.document.name}`}
            title="Close"
            onClick={() => onClose(session.id)}
          ><X size={13}/></button>
          {open && menu && <div className="document-tab-menu" role="menu" style={{left:menu.left,top:menu.top}}>
            <button onClick={() => { setMenu(null); onClose(session.id); }}>Close</button>
            <button disabled={sessions.length <= 1} onClick={() => { setMenu(null); onCloseOthers(session.id); }}>Close others</button>
            <button disabled={index === sessions.length - 1} onClick={() => { setMenu(null); onCloseRight(session.id); }}>Close tabs to right</button>
            <button onClick={() => { setMenu(null); onCloseAll(); }}>Close all</button>
          </div>}
        </div>;
      })}
    </div>
  </div>;
}
