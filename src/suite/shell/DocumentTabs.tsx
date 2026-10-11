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
  onReorder(draggedId: string, targetId: string): void;
}

export default function DocumentTabs({
  sessions,
  activeSessionId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseAll,
  onReorder,
}: Props) {
  const [menu, setMenu] = useState<{id:string;left:number;top:number} | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  if (!sessions.length) return null;

  return <div className="document-tabs" role="tablist" aria-label="Open documents">
    <div className="document-tabs-scroll">
      {sessions.map((session, index) => {
        const active = session.id === activeSessionId;
        const open = menu?.id === session.id;
        return <div
          className={[
            'document-tab',
            active ? 'active' : '',
            draggedId === session.id ? 'dragging' : '',
            dragOverId === session.id && draggedId !== session.id ? 'drag-over' : '',
          ].filter(Boolean).join(' ')}
          key={session.id}
          onDragOver={(event) => {
            if (!draggedId || draggedId === session.id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDragOverId(session.id);
          }}
          onDragLeave={() => {
            if (dragOverId === session.id) setDragOverId(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (draggedId && draggedId !== session.id) onReorder(draggedId, session.id);
            setDraggedId(null);
            setDragOverId(null);
          }}
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
            draggable
            onDragStart={(event) => {
              setMenu(null);
              setDraggedId(session.id);
              setDragOverId(null);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', session.id);
            }}
            onDragEnd={() => {
              setDraggedId(null);
              setDragOverId(null);
            }}
            aria-selected={active}
            title={session.document.name}
            onClick={() => onActivate(session.id)}
          >
            <FileText size={14}/>
            <span>{session.document.name}</span>
            <i className={session.saving ? 'saving' : session.dirty ? 'dirty' : session.document.browserFile ? 'temporary' : 'saved'} aria-label={session.saving ? 'Saving' : session.dirty ? 'Unsaved changes' : session.document.browserFile ? 'Temporary browser document — export before refresh' : 'Saved'}/>
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
          {open && menu && <div className="document-tab-menu" role="menu" aria-label={`Tab actions for ${session.document.name}`} style={{left:menu.left,top:menu.top}} onKeyDown={(event)=>{
            if(event.key==='Escape'){
              event.preventDefault();
              setMenu(null);
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.document-tab-menu-button')?.focus();
            }else if(event.key==='ArrowDown'||event.key==='ArrowUp'){
              event.preventDefault();
              const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
              if(!items.length)return;
              const index=items.indexOf(document.activeElement as HTMLButtonElement);
              const direction=event.key==='ArrowDown'?1:-1;
              items[(index+direction+items.length)%items.length]?.focus();
            }else if(event.key==='Tab'){
              setMenu(null);
            }
          }}>
            <button role="menuitem" autoFocus onClick={() => { setMenu(null); onClose(session.id); }}>Close</button>
            <button role="menuitem" disabled={sessions.length <= 1} onClick={() => { setMenu(null); onCloseOthers(session.id); }}>Close others</button>
            <button role="menuitem" disabled={index === sessions.length - 1} onClick={() => { setMenu(null); onCloseRight(session.id); }}>Close tabs to right</button>
            <button role="menuitem" onClick={() => { setMenu(null); onCloseAll(); }}>Close all</button>
          </div>}
        </div>;
      })}
    </div>
  </div>;
}
