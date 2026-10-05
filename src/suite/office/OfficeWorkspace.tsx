import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, FileText, FolderOpen, Printer, Table2, Presentation } from 'lucide-react';
import type { DocumentSession } from '../files/session';
import { isDesktopRuntime } from '../files/api';
import { exportOfficeCopy, readOfficeDocument } from './api';
import {
  detectOfficeKind,
  exactCopy,
  parseOffice,
  writeOffice,
  type DocxModel,
  type OfficeKind,
  type OfficeModel,
  type PptxModel,
  type XlsxModel,
} from './ooxml';

interface Props {
  kind: OfficeKind;
  session: DocumentSession | null;
  onBackToFiles(): void;
  onDirtyChange?(dirty: boolean): void;
}

const kindMeta: Record<OfficeKind, { title: string; extension: string; icon: typeof FileText }> = {
  docx: { title: 'Document Workspace', extension: 'docx', icon: FileText },
  xlsx: { title: 'Spreadsheet', extension: 'xlsx', icon: Table2 },
  pptx: { title: 'Presentation', extension: 'pptx', icon: Presentation },
};

export default function OfficeWorkspace({ kind, session, onBackToFiles, onDirtyChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [original, setOriginal] = useState<Uint8Array | null>(null);
  const [model, setModel] = useState<OfficeModel | null>(null);
  const [sourceName, setSourceName] = useState(kindMeta[kind].title);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const expectedExtension = kindMeta[kind].extension;

  useEffect(() => {
    setOriginal(null);
    setModel(null);
    setDirty(false);
    setNotice('');
    setError('');
    onDirtyChange?.(false);

    const document = session?.document;
    if (!document || document.kind !== kind) return;

    let cancelled = false;
    setLoading(true);
    const load = document.browserFile
      ? document.browserFile.arrayBuffer()
      : isDesktopRuntime()
        ? readOfficeDocument(document.id)
        : Promise.reject(new Error('This document has no browser source or native library source.'));

    void load
      .then((buffer) => {
        if (cancelled) return;
        const bytes = new Uint8Array(buffer);
        const detected = detectOfficeKind(bytes);
        if (detected !== kind) throw new Error(`The package content is ${detected.toUpperCase()}, not ${kind.toUpperCase()}.`);
        setOriginal(bytes);
        setModel(parseOffice(bytes));
        setSourceName(document.name);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [kind, session?.id]);

  function markDirty(next: OfficeModel) {
    setModel(next);
    if (!dirty) {
      setDirty(true);
      onDirtyChange?.(true);
    }
  }

  async function openBrowserFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setLoading(true);
    setError('');
    setNotice('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const detected = detectOfficeKind(bytes);
      if (detected !== kind) {
        throw new Error(`Choose a .${expectedExtension} document for this workspace. The selected package is ${detected.toUpperCase()}.`);
      }
      setOriginal(bytes);
      setModel(parseOffice(bytes));
      setSourceName(file.name);
      setDirty(false);
      onDirtyChange?.(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function exportDocument() {
    if (!original || !model) return;
    try {
      const bytes = dirty ? writeOffice(original, model) : exactCopy(original);
      const base = sourceName.replace(/\.[^.]+$/, '') || 'MALENJO-document';
      const name = dirty ? `${base}-edited.${expectedExtension}` : `${base}-copy.${expectedExtension}`;
      const saved = await exportOfficeCopy(name, bytes);
      if (saved) setNotice(dirty
        ? 'Exported an edited OOXML copy. Review the fidelity warning before replacing an original file.'
        : 'Exported an exact byte-preserving copy.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const fidelity = dirty ? 'Edited · compatibility review required' : 'Untouched · exact-copy export available';
  const MetaIcon = kindMeta[kind].icon;

  return <div className="office-workspace">
    <input
      ref={inputRef}
      className="visually-hidden"
      type="file"
      accept={`.${expectedExtension}`}
      onChange={(event) => void openBrowserFile(event)}
    />

    <div className="office-toolbar">
      <div className="office-toolbar-group">
        <button onClick={onBackToFiles}><FolderOpen size={16}/> Files</button>
        <button disabled={!!session} onClick={() => inputRef.current?.click()} title={session ? "Use Files / Library to open another document in a new tab" : undefined}><MetaIcon size={16}/> Open {expectedExtension.toUpperCase()}</button>
        <button disabled={!model} onClick={() => void exportDocument()}><Download size={16}/> Export copy</button>
        <button disabled={!model} onClick={() => window.print()}><Printer size={16}/> Print</button>
      </div>
      <div className={dirty ? 'fidelity-pill warning' : 'fidelity-pill'}>
        {dirty && <AlertTriangle size={14}/>}
        {fidelity}
      </div>
    </div>

    {(notice || error) && <div className={error ? 'office-message error' : 'office-message'}>{error || notice}</div>}

    {!model && <div className="office-empty">
      <div className="empty-icon">M</div>
      <h1>{kindMeta[kind].title}</h1>
      <p>{loading
        ? `Loading ${expectedExtension.toUpperCase()} package…`
        : `Open a ${expectedExtension.toUpperCase()} document from MALENJO Files or choose one for a temporary Codespaces/browser editing session.`}</p>
      <button className="primary-action" disabled={loading} onClick={() => inputRef.current?.click()}>
        <MetaIcon size={17}/> {loading ? 'Loading…' : `Choose ${expectedExtension.toUpperCase()}`}
      </button>
    </div>}

    {model?.kind === 'docx' && <DocxEditor model={model} onChange={markDirty}/>}
    {model?.kind === 'xlsx' && <XlsxEditor model={model} onChange={markDirty}/>}
    {model?.kind === 'pptx' && <PptxEditor model={model} onChange={markDirty}/>}
  </div>;
}

function DocxEditor({ model, onChange }: { model: DocxModel; onChange(model: DocxModel): void }) {
  const text = model.paragraphs.join('\n\n');
  return <div className="word-editor-shell">
    <aside className="office-inspector">
      <h3>Document</h3>
      <dl>
        <div><dt>Paragraphs</dt><dd>{model.paragraphs.length}</dd></div>
        <div><dt>Edit mode</dt><dd>Text reflow</dd></div>
      </dl>
      <div className="fidelity-warning">
        Complex styles, headers, footnotes, fields, tracked changes, equations and anchored objects may not round-trip after text editing.
      </div>
    </aside>
    <main className="word-canvas">
      <div className="word-page">
        <textarea
          aria-label="DOCX text editor"
          value={text}
          onChange={(event) => onChange({
            ...model,
            paragraphs: event.target.value.split(/\n\s*\n/),
            fidelity: 'reflow-warning',
          })}
          spellCheck
        />
      </div>
    </main>
  </div>;
}

function ensureGrid(cells: string[][], rows = 30, columns = 12): string[][] {
  return Array.from({ length: Math.max(rows, cells.length) }, (_, r) =>
    Array.from({ length: Math.max(columns, cells[r]?.length ?? 0) }, (_, c) => cells[r]?.[c] ?? ''),
  );
}

function columnName(index: number): string {
  let value = index + 1;
  let out = '';
  while (value > 0) {
    out = String.fromCharCode(65 + ((value - 1) % 26)) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

function XlsxEditor({ model, onChange }: { model: XlsxModel; onChange(model: XlsxModel): void }) {
  const grid = useMemo(() => ensureGrid(model.cells), [model.cells]);

  function setCell(row: number, column: number, value: string) {
    const next = grid.map((item) => [...item]);
    next[row][column] = value;
    onChange({ ...model, cells: next, fidelity: 'reflow-warning' });
  }

  return <div className="sheet-editor-shell">
    <div className="sheet-titlebar">
      <span className="sheet-tab active">{model.sheetName}</span>
      <span className="sheet-warning">Phase 3 edits preserve the OOXML package but may simplify formulas/styles in edited cells.</span>
    </div>
    <div className="sheet-grid-wrap">
      <table className="sheet-grid">
        <thead><tr><th className="sheet-corner"/>{grid[0].map((_, c) => <th key={c}>{columnName(c)}</th>)}</tr></thead>
        <tbody>
          {grid.map((row, r) => <tr key={r}>
            <th>{r + 1}</th>
            {row.map((value, c) => <td key={c}>
              <input
                aria-label={`Cell ${columnName(c)}${r + 1}`}
                value={value}
                onChange={(event) => setCell(r, c, event.target.value)}
              />
            </td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}

function PptxEditor({ model, onChange }: { model: PptxModel; onChange(model: PptxModel): void }) {
  const [active, setActive] = useState(0);
  const slide = model.slides[Math.min(active, model.slides.length - 1)];

  function setText(index: number, value: string) {
    const slides = model.slides.map((item, slideIndex) => slideIndex !== active
      ? item
      : { ...item, texts: item.texts.map((text, textIndex) => textIndex === index ? value : text) });
    onChange({ ...model, slides, fidelity: 'reflow-warning' });
  }

  return <div className="slides-editor-shell">
    <aside className="slide-list">
      {model.slides.map((item, index) => <button className={index === active ? 'active' : ''} key={item.path} onClick={() => setActive(index)}>
        <div className="slide-mini">
          <strong>{item.texts[0] || `Slide ${index + 1}`}</strong>
          <span>{item.texts.slice(1).join(' ').slice(0, 65)}</span>
        </div>
        <small>{index + 1}</small>
      </button>)}
    </aside>
    <main className="slide-canvas">
      <div className="slide-page">
        {slide.texts.length
          ? slide.texts.map((text, index) => index === 0
            ? <input key={index} className="slide-title-input" value={text} onChange={(event) => setText(index, event.target.value)}/>
            : <textarea key={index} value={text} onChange={(event) => setText(index, event.target.value)}/>)
          : <div className="slide-no-text">This slide contains no editable text runs in the Phase 3 adapter.</div>}
      </div>
      <div className="slide-fidelity"><AlertTriangle size={15}/> Existing shapes/media remain in the OOXML package, but edited text may reflow inside complex layouts.</div>
    </main>
  </div>;
}
