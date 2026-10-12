import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, FileText, Search, SlidersHorizontal, X } from 'lucide-react';
import { filterCommandPaletteItems, type CommandPaletteSearchItem } from './commandPaletteModel';
import { firstAvailableCommand, moveAvailableCommand } from './commandPaletteNavigation';

export interface CommandPaletteItem extends CommandPaletteSearchItem {
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
  const dialogRef = useRef<HTMLElement>(null);
  const filtered = useMemo(() => filterCommandPaletteItems(items, query), [items, query]);
  // Rendering must not transiently point at an unavailable/stale selection
  // between query changes and the normal selection-reset effect.
  const activeIndex = selected >= 0 && filtered[selected] && !filtered[selected].disabled
    ? selected : firstAvailableCommand(filtered);

  useEffect(() => { setSelected(firstAvailableCommand(filtered)); }, [query, open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'input:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])'
        ) ?? []);
        if (focusable.length) {
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((value) => moveAvailableCommand(filtered, value, 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((value) => moveAvailableCommand(filtered, value, -1));
      } else if (event.key === 'Enter' && filtered[activeIndex]) {
        event.preventDefault();
        const item = filtered[activeIndex];
        if (item.disabled) return;
        item.run();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filtered, onClose, open, activeIndex]);

  if (!open) return null;

  return <div className="command-palette-backdrop" onMouseDown={onClose}>
    <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label="MALENJO command palette" onMouseDown={(event)=>event.stopPropagation()}>
      <div className="command-palette-search">
        <Search size={17}/>
        <input
          autoFocus
          value={query}
          onChange={(event)=>onQueryChange(event.target.value)}
          placeholder="Search actions, documents and settings"
          aria-label="Search MALENJO actions, documents and settings"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="malenjo-command-results"
          aria-activedescendant={activeIndex >= 0 ? 'malenjo-command-option-' + activeIndex : undefined}
        />
        <kbd>Esc</kbd>
        <button aria-label="Close command palette" onClick={onClose}><X size={15}/></button>
      </div>
      <div className="command-palette-results" id="malenjo-command-results"
        role="listbox" aria-label="Available MALENJO commands">
        {filtered.map((item,index)=><button
          key={item.id}
          id={'malenjo-command-option-' + index}
          role="option"
          aria-selected={index===activeIndex}
          className={index===activeIndex?'selected':''}
          disabled={item.disabled}
          title={item.disabled ? item.disabledReason : undefined}
          onMouseEnter={()=>{if(!item.disabled)setSelected(index);}}
          onClick={()=>{if(item.disabled)return;item.run();onClose();}}
        >
          <span className="command-palette-icon">
            {item.kind==='document'
              ? <FileText size={15}/>
              : item.kind==='setting'
                ? <SlidersHorizontal size={15}/>
                : <Command size={15}/>}
          </span>
          <span><b>{item.label}</b><small>{item.disabled ? (item.disabledReason || 'Unavailable in the current document state') : (item.detail || item.group)}</small></span>
          <em>{item.group}</em>
        </button>)}
        {!filtered.length && <div className="command-palette-empty" role="status">No action, document or setting matches “{query}”. Unsupported source-truth actions appear only when their canonical phrase or keywords are searched.</div>}
      </div>
      <footer>Ctrl+K · ↑/↓ select · Enter run · Escape close · actions, documents and settings</footer>
    </section>
  </div>;
}
