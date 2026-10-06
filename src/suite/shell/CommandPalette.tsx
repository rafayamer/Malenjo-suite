import { useEffect, useMemo, useState } from 'react';
import { Command, FileText, Search, X } from 'lucide-react';

export interface CommandPaletteItem {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  detail?: string;
  disabled?: boolean;
  disabledReason?: string;
  run(): void;
}

interface Props {
  open: boolean;
  query: string;
  items: CommandPaletteItem[];
  onQueryChange(value: string): void;
  onClose(): void;
}

export default function CommandPalette({ open, query, items, onQueryChange, onClose }: Props) {
  const [selected, setSelected] = useState(0);
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return items.slice(0, 30);
    return items.filter((item) =>
      [item.label, item.group, item.keywords ?? '', item.detail ?? '']
        .some((field) => field.toLowerCase().includes(value)),
    ).slice(0, 40);
  }, [items, query]);

  useEffect(() => { setSelected(0); }, [query, open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((value) => Math.min(value + 1, Math.max(0, filtered.length - 1)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((value) => Math.max(0, value - 1));
      } else if (event.key === 'Enter' && filtered[selected]) {
        event.preventDefault();
        const item = filtered[selected];
        if (item.disabled) return;
        item.run();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filtered, onClose, open, selected]);

  if (!open) return null;

  return <div className="command-palette-backdrop" onMouseDown={onClose}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="MALENJO command palette" onMouseDown={(event)=>event.stopPropagation()}>
      <div className="command-palette-search">
        <Search size={17}/>
        <input
          autoFocus
          value={query}
          onChange={(event)=>onQueryChange(event.target.value)}
          placeholder="Search actions, workspaces and open documents"
          aria-label="Search MALENJO commands"
        />
        <kbd>Esc</kbd>
        <button aria-label="Close command palette" onClick={onClose}><X size={15}/></button>
      </div>
      <div className="command-palette-results">
        {filtered.map((item,index)=><button
          key={item.id}
          className={index===selected?'selected':''}
          disabled={item.disabled}
          title={item.disabled ? item.disabledReason : undefined}
          onMouseEnter={()=>setSelected(index)}
          onClick={()=>{if(item.disabled)return;item.run();onClose();}}
        >
          <span className="command-palette-icon">{item.group==='Open documents'?<FileText size={15}/>:<Command size={15}/>}</span>
          <span><b>{item.label}</b><small>{item.disabled ? (item.disabledReason || 'Unavailable in the current document state') : (item.detail || item.group)}</small></span>
          <em>{item.group}</em>
        </button>)}
        {!filtered.length && <div className="command-palette-empty">No implemented command matches “{query}”. Missing master-guide features are intentionally not shown as operational commands.</div>}
      </div>
      <footer>Ctrl+K · ↑/↓ select · Enter run · only implemented actions are executable</footer>
    </section>
  </div>;
}
