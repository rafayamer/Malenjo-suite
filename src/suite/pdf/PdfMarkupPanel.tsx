import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  addPdfTextMarkup, deletePdfMarkupAnnotation, listPdfMarkupAnnotations, updatePdfMarkupAnnotation,
  type DrawingKind, type MarkupItem, type MarkupStyle, type ShownRect, type TextMarkupKind,
} from './pdfMarkup';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
export interface MarkupSettings { tool: DrawingKind | null; style: MarkupStyle; text: string }
interface Props {
  domIdPrefix: string;
  bytes: Uint8Array;
  viewRotation: number;
  busy: boolean;
  settings: MarkupSettings;
  onSettings(next: MarkupSettings): void;
  onApply(label: string, operation: Operation): Promise<boolean>;
  onClose(): void;
}

const TEXT_TOOLS: [TextMarkupKind, string][] = [['Highlight', 'Highlight'], ['Underline', 'Underline'], ['StrikeOut', 'Strike out'], ['Squiggly', 'Squiggly']];
const DRAW_TOOLS: [DrawingKind, string][] = [['Ink', 'Pen'], ['Line', 'Line'], ['Arrow', 'Arrow'], ['Square', 'Rectangle'], ['Circle', 'Ellipse'],
  ['FreeText', 'Text box'], ['Callout', 'Callout'], ['Note', 'Sticky note']];
export const MARKUP_AUTHOR = 'MALENJO User';

/** The current text selection on this workspace's pages, as fractions of each page as shown. */
interface PageSelection { pageNumber: number; rects: ShownRect[]; text: string }
/** The current selection grouped by page (a selection can cross pages), with each page's own selected text. */
function selectionByPage(domIdPrefix: string): PageSelection[] | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const pages = Array.from(document.querySelectorAll<HTMLElement>(`[id^="${domIdPrefix}-page-"]`)).map((shell) => ({
    pageNumber: Number(shell.id.slice(`${domIdPrefix}-page-`.length)), box: (shell.querySelector('canvas') ?? shell).getBoundingClientRect(),
  })).filter((page) => Number.isInteger(page.pageNumber));
  const byPage = new Map<number, ShownRect[]>();
  const range = selection.getRangeAt(0);
  // Rectangles come only from selected text in the pages' text layers: a range's own client rects
  // also include the boxes of whole elements it spans (canvases, page shells) when it crosses pages.
  const textRects: DOMRect[] = [];
  for (const layer of Array.from(document.querySelectorAll<HTMLElement>(`[id^="${domIdPrefix}-page-"] .textLayer`))) {
    if (!selection.containsNode(layer, true)) continue;
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim() || !selection.containsNode(node, true)) continue;
      const part = document.createRange(); part.selectNodeContents(node);
      if (node === range.startContainer) part.setStart(node, range.startOffset);
      if (node === range.endContainer) part.setEnd(node, range.endOffset);
      if (!part.collapsed) textRects.push(...Array.from(part.getClientRects()));
    }
  }
  for (const rect of textRects) {
    if (rect.width < 0.5 || rect.height < 0.5) continue;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    // The page containing the rectangle's centre, or failing that the nearest page within a few pixels
    // (text-layer boxes can extend slightly past the canvas edge).
    const distance = ({ box }: { box: DOMRect }) => Math.hypot(Math.max(box.left - cx, 0, cx - box.right), Math.max(box.top - cy, 0, cy - box.bottom));
    const page = [...pages].sort((a, b) => distance(a) - distance(b))[0];
    if (!page || distance(page) > 8) continue;
    const { box } = page;
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const x = clamp((rect.left - box.left) / box.width), y = clamp((rect.top - box.top) / box.height);
    const list = byPage.get(page.pageNumber) ?? [];
    list.push({ x, y, width: clamp((rect.right - box.left) / box.width) - x, height: clamp((rect.bottom - box.top) / box.height) - y });
    byPage.set(page.pageNumber, list);
  }
  if (!byPage.size) return null;
  return [...byPage.keys()].sort((a, b) => a - b).map((pageNumber) => {
    // The page's own share of the selected text: the selected part of its text-layer spans.
    const spans = Array.from(document.querySelectorAll<HTMLElement>(`#${CSS.escape(`${domIdPrefix}-page-${pageNumber}`)} .textLayer span`))
      .filter((span) => selection.containsNode(span, true));
    const text = spans.map((span) => {
      const part = document.createRange(); part.selectNodeContents(span);
      if (span.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
      if (span.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
      return part.toString();
    }).join(' ').replace(/\s+/g, ' ').trim();
    return { pageNumber, rects: byPage.get(pageNumber)!, text: byPage.size === 1 ? selection.toString().trim() : text };
  });
}

/** MAL-054 / MAL-055 markup tools: text markup on the selection, drawing tools, and editing. */
export default function PdfMarkupPanel({ domIdPrefix, bytes, viewRotation, busy, settings, onSettings, onApply, onClose }: Props) {
  const [items, setItems] = useState<MarkupItem[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  // The selection is read when the pointer goes down on a markup button, before a click can clear it.
  const pending = useRef<ReturnType<typeof selectionByPage>>(null);
  useEffect(() => {
    let live = true;
    listPdfMarkupAnnotations(bytes).then((list) => { if (live) { setItems(list); setSelected((s) => s !== null && s < list.length ? s : null); } })
      .catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [bytes]);
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>('button[data-autofocus]')?.focus(); }, []);

  const run = async (label: string, operation: Operation) => {
    setError('');
    try { await onApply(label, operation); } catch (reason) { setError(describePdfError(reason)); }
  };
  function markText(kind: TextMarkupKind, name: string) {
    const found = pending.current ?? selectionByPage(domIdPrefix);
    pending.current = null;
    if (!found) { setError('Select text on a page first, then choose the markup.'); return; }
    const pages = found.map((group) => group.pageNumber);
    // Every page of the selection is marked in one undoable edit.
    void run(`Added ${name.toLowerCase()}.`, async (latest) => {
      let bytes = latest;
      for (const group of found) bytes = await addPdfTextMarkup(bytes, { pageNumber: group.pageNumber, viewRotation, kind, rects: group.rects, text: group.text, note: '', author: MARKUP_AUTHOR, style: settings.style });
      return { bytes, summary: `Added ${name.toLowerCase()} on page${pages.length > 1 ? 's' : ''} ${pages.join(', ')}.` };
    });
    window.getSelection()?.removeAllRanges();
  }
  const item = selected === null ? null : items[selected] ?? null;
  const style = settings.style;
  const set = (next: Partial<MarkupSettings>) => onSettings({ ...settings, ...next });

  return <section ref={panelRef} className="pdf-markup-panel" role="dialog" aria-modal="false" aria-labelledby={`${domIdPrefix}-markup-title`}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (settings.tool) set({ tool: null }); else onClose(); } }}>
    <header>
      <h2 id={`${domIdPrefix}-markup-title`}>Markup tools</h2>
      <button type="button" aria-label="Close markup tools" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <fieldset>
      <legend>Text markup (select text on the page first)</legend>
      {TEXT_TOOLS.map(([kind, name], index) => <button key={kind} type="button" disabled={busy} data-autofocus={index === 0 ? true : undefined}
        onPointerDownCapture={() => { pending.current = selectionByPage(domIdPrefix); }}
        onMouseDown={(event) => event.preventDefault()} onClick={() => markText(kind, name)}>{name}</button>)}
    </fieldset>
    <fieldset>
      <legend>Draw on the page</legend>
      {DRAW_TOOLS.map(([kind, name]) => <button key={kind} type="button" aria-pressed={settings.tool === kind}
        onClick={() => set({ tool: settings.tool === kind ? null : kind })}>{name}</button>)}
      {settings.tool && <p role="status">{DRAW_TOOLS.find(([kind]) => kind === settings.tool)![1]} is on. Draw on a page; press Escape to stop.</p>}
    </fieldset>
    <fieldset>
      <legend>Style</legend>
      <label><span>Colour</span><input aria-label="Markup colour" type="color" value={style.color} onChange={(e) => set({ style: { ...style, color: e.target.value } })}/></label>
      <label>Opacity (%)<input aria-label="Markup opacity percent" type="number" min={10} max={100} value={Math.round(style.opacity * 100)} onChange={(e) => set({ style: { ...style, opacity: Number(e.target.value) / 100 } })}/></label>
      <label>Line width (pt)<input aria-label="Markup line width" type="number" min={0.5} max={24} step={0.5} value={style.width} onChange={(e) => set({ style: { ...style, width: Number(e.target.value) } })}/></label>
      <label>Text for text box, callout or note<textarea aria-label="Markup text" rows={2} value={settings.text} onChange={(e) => set({ text: e.target.value })}/></label>
    </fieldset>
    <fieldset>
      <legend>Markup in this PDF</legend>
      {items.length ? <ul className="pdf-merge-list static" aria-label="Markup in this PDF">
        {items.map((entry, index) => <li key={`${entry.pageNumber}-${entry.index}-${entry.ref}`}>
          <label className="pdf-tool-dialog-choice pdf-merge-name"><input type="radio" name={`${domIdPrefix}-markup-item`} checked={selected === index} onChange={() => setSelected(index)}/>
            <span aria-hidden="true" className="pdf-markup-swatch" style={{ background: entry.color }}/>Page {entry.pageNumber}: {entry.label}{entry.contents ? ` — ${entry.contents.slice(0, 40)}` : ''}</label>
        </li>)}
      </ul> : <p>No markup yet.</p>}
      <div className="pdf-tool-dialog-actions">
        <button type="button" disabled={busy || !item} onClick={() => item && void run('Changed markup.', async (latest) => ({
          bytes: await updatePdfMarkupAnnotation(latest, item, { color: style.color, opacity: style.opacity, width: style.width, ...(settings.text.trim() ? { contents: settings.text } : {}) }),
          summary: `Updated the ${item.label.toLowerCase()} on page ${item.pageNumber}.`,
        }))}>Apply style and text to selected</button>
        <button type="button" disabled={busy || !item} onClick={() => item && void run('Deleted markup.', async (latest) => ({
          bytes: await deletePdfMarkupAnnotation(latest, item), summary: `Deleted the ${item.label.toLowerCase()} on page ${item.pageNumber}.`,
        }))}>Delete selected</button>
      </div>
    </fieldset>
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
  </section>;
}
