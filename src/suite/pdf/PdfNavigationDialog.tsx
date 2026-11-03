import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { addPdfLinkAnnotation, deletePdfLinkAnnotation, listPdfLinkAnnotations, updatePdfLinkAnnotation, type PdfLinkAnnotation, type PdfLinkTarget } from './links';
import {
  addPdfOutlineTreeEntry, deletePdfOutlineTreeEntry, listPdfOutlineTree, movePdfOutlineTreeEntry, nestPdfOutlineTreeEntry,
  renamePdfOutlineTreeEntry, setPdfOutlineTreeEntryPage, type PdfOutlineTreeEntry,
} from './pdfOutlineTree';
import { generatePdfTableOfContents } from './pdfToc';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
type Section = 'bookmarks' | 'links' | 'contents';
interface Props {
  domIdPrefix: string;
  bytes: Uint8Array;
  pageCount: number;
  currentPage: number;
  busy: boolean;
  onApply(label: string, operation: Operation): Promise<boolean>;
  onClose(): void;
}

const plain = (summary: string, edit: (latest: Uint8Array) => Promise<Uint8Array>): Operation => async (latest) => ({ bytes: await edit(latest), summary });

/** MAL-022: bookmarks, hyperlinks and their destinations, and a generated table of contents. */
export default function PdfNavigationDialog({ domIdPrefix, bytes, pageCount, currentPage, busy, onApply, onClose }: Props) {
  const [section, setSection] = useState<Section>('bookmarks');
  const [tree, setTree] = useState<PdfOutlineTreeEntry[]>([]);
  const [links, setLinks] = useState<PdfLinkAnnotation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [page, setPage] = useState(currentPage);
  const [link, setLink] = useState({ kind: 'https' as 'https' | 'page', url: 'https://', page: 1, linkPage: currentPage, x: 10, y: 80, width: 30, height: 5 });
  const [toc, setToc] = useState({ title: 'Contents', maxDepth: 2, fontSize: 11 });
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listPdfOutlineTree(bytes), listPdfLinkAnnotations(bytes)]).then(([outline, found]) => {
      if (!live) return;
      setTree(outline); setLinks(found);
      setSelected((current) => outline.some((entry) => entry.ref === current) ? current : null);
      setSelectedLink((current) => current !== null && current < found.length ? current : null);
    }).catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [bytes]);
  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(); }, []);

  async function run(label: string, operation: Operation) {
    setWorking(true); setError('');
    try { await onApply(label, operation); } catch (reason) { setError(describePdfError(reason)); } finally { setWorking(false); }
  }
  const entry = tree.find((item) => item.ref === selected) ?? null;
  const chosenLink = selectedLink === null ? null : links[selectedLink] ?? null;
  const target = (): PdfLinkTarget => link.kind === 'https' ? { kind: 'https', url: link.url.trim() } : { kind: 'page', pageNumber: link.page };
  const disabled = busy || working;
  const titleId = `${domIdPrefix}-navigation-title`;
  const tabs: [Section, string][] = [['bookmarks', 'Bookmarks'], ['links', 'Links'], ['contents', 'Table of contents']];

  return <section ref={dialogRef} className="pdf-tool-dialog" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={titleId}>Navigation</h2>
      <button type="button" aria-label="Close navigation" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <div role="tablist" aria-label="Navigation sections" className="pdf-tool-dialog-tabs">
      {tabs.map(([id, name]) => <button key={id} type="button" role="tab" aria-selected={section === id} tabIndex={section === id ? 0 : -1}
        onClick={() => setSection(id)}
        onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const i = tabs.findIndex(([t]) => t === section); const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0]; setSection(next); (e.currentTarget.parentElement?.children[tabs.findIndex(([t]) => t === next)] as HTMLElement | undefined)?.focus(); } }}>{name}</button>)}
    </div>

    {section === 'bookmarks' && <div role="tabpanel" aria-label="Bookmarks">
      {tree.length ? <ul className="pdf-merge-list static" aria-label="Bookmarks in this PDF">
        {tree.map((item) => <li key={item.ref} style={{ paddingLeft: 8 + item.depth * 16 }}>
          <label className="pdf-tool-dialog-choice pdf-merge-name"><input type="radio" name={`${domIdPrefix}-bookmark`} checked={selected === item.ref}
            onChange={() => { setSelected(item.ref); setTitle(item.title); setPage(item.pageNumber ?? 1); }}/>{item.title} — {item.pageNumber ? `page ${item.pageNumber}` : 'no page'}</label>
        </li>)}
      </ul> : <p>This PDF has no bookmarks yet.</p>}
      <label>Bookmark title<input aria-label="Bookmark title" value={title} onChange={(e) => setTitle(e.target.value)}/></label>
      <label>Page<input aria-label="Bookmark page" type="number" min={1} max={pageCount} value={page} onChange={(e) => setPage(Math.floor(Number(e.target.value)))}/></label>
      <div className="pdf-tool-dialog-actions">
        <button type="button" disabled={disabled} onClick={() => void run('Added a bookmark.', plain(`Added bookmark “${title}”.`, (b) => addPdfOutlineTreeEntry(b, title, page)))}>Add bookmark</button>
        <button type="button" disabled={disabled || !entry} onClick={() => entry && void run('Added a bookmark.', plain(`Added “${title}” under “${entry.title}”.`, (b) => addPdfOutlineTreeEntry(b, title, page, entry.ref)))}>Add inside selected</button>
        <button type="button" disabled={disabled || !entry} onClick={() => entry && void run('Renamed a bookmark.', plain(`Renamed to “${title}”.`, (b) => renamePdfOutlineTreeEntry(b, entry.ref, title)))}>Rename</button>
        <button type="button" disabled={disabled || !entry} onClick={() => entry && void run('Changed a bookmark page.', plain(`“${entry.title}” now opens page ${page}.`, (b) => setPdfOutlineTreeEntryPage(b, entry.ref, page)))}>Set page</button>
        <button type="button" disabled={disabled || !entry} onClick={() => entry && void run('Moved a bookmark.', plain(`Moved “${entry.title}” up.`, (b) => movePdfOutlineTreeEntry(b, entry.ref, -1)))}>Move up</button>
        <button type="button" disabled={disabled || !entry} onClick={() => entry && void run('Moved a bookmark.', plain(`Moved “${entry.title}” down.`, (b) => movePdfOutlineTreeEntry(b, entry.ref, 1)))}>Move down</button>
        <button type="button" disabled={disabled || !entry} onClick={() => entry && void run('Nested a bookmark.', plain(`Nested “${entry.title}”.`, (b) => nestPdfOutlineTreeEntry(b, entry.ref, 'in')))}>Indent</button>
        <button type="button" disabled={disabled || !entry} onClick={() => entry && void run('Un-nested a bookmark.', plain(`Moved “${entry.title}” out one level.`, (b) => nestPdfOutlineTreeEntry(b, entry.ref, 'out')))}>Outdent</button>
        <button type="button" disabled={disabled || !entry} onClick={() => entry && window.confirm(`Delete “${entry.title}”${entry.hasChildren ? ' and the bookmarks inside it' : ''}?`) && void run('Deleted a bookmark.', plain(`Deleted “${entry.title}”.`, (b) => deletePdfOutlineTreeEntry(b, entry.ref, true)))}>Delete</button>
      </div>
    </div>}

    {section === 'links' && <div role="tabpanel" aria-label="Links">
      {links.length ? <ul className="pdf-merge-list static" aria-label="Links in this PDF">
        {links.map((item, index) => <li key={`${item.pageNumber}-${item.index}`}>
          <label className="pdf-tool-dialog-choice pdf-merge-name"><input type="radio" name={`${domIdPrefix}-link`} checked={selectedLink === index}
            onChange={() => setSelectedLink(index)}/>Page {item.pageNumber}: {item.kind === 'unsupported' ? 'other action' : item.destination}</label>
        </li>)}
      </ul> : <p>This PDF has no links yet.</p>}
      <fieldset>
        <legend>Destination</legend>
        <label>Opens<select aria-label="Link destination type" value={link.kind} onChange={(e) => setLink({ ...link, kind: e.target.value as 'https' | 'page' })}>
          <option value="https">A web address</option><option value="page">A page in this PDF</option></select></label>
        {link.kind === 'https'
          ? <label>Web address<input aria-label="Link web address" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })}/></label>
          : <label>Target page<input aria-label="Link target page" type="number" min={1} max={pageCount} value={link.page} onChange={(e) => setLink({ ...link, page: Math.floor(Number(e.target.value)) })}/></label>}
      </fieldset>
      <fieldset>
        <legend>New link area (percent of the page)</legend>
        <label>On page<input aria-label="Link on page" type="number" min={1} max={pageCount} value={link.linkPage} onChange={(e) => setLink({ ...link, linkPage: Math.floor(Number(e.target.value)) })}/></label>
        {(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{key === 'x' ? 'From left' : key === 'y' ? 'From bottom' : key[0].toUpperCase() + key.slice(1)}
          <input aria-label={`Link area ${key}`} type="number" min={0} max={100} value={link[key]} onChange={(e) => setLink({ ...link, [key]: Number(e.target.value) })}/></label>)}
      </fieldset>
      <div className="pdf-tool-dialog-actions">
        <button type="button" disabled={disabled} onClick={() => void run('Added a link.', plain(`Added a link on page ${link.linkPage}.`, (b) => addPdfLinkAnnotation(b,
          { pageNumber: link.linkPage, x: link.x / 100, y: link.y / 100, width: link.width / 100, height: link.height / 100 }, target())))}>Add link</button>
        <button type="button" disabled={disabled || !chosenLink || chosenLink.kind === 'unsupported'} onClick={() => chosenLink && void run('Changed a link.', plain('Changed the link destination.', (b) => updatePdfLinkAnnotation(b, chosenLink, target())))}>Change destination</button>
        <button type="button" disabled={disabled || !chosenLink} onClick={() => chosenLink && void run('Removed a link.', plain(`Removed a link on page ${chosenLink.pageNumber}.`, (b) => deletePdfLinkAnnotation(b, chosenLink)))}>Remove link</button>
      </div>
    </div>}

    {section === 'contents' && <div role="tabpanel" aria-label="Table of contents">
      <p>Builds contents pages from this PDF's bookmarks and inserts them at the front. Each entry links to its page.</p>
      <label>Heading<input aria-label="Contents heading" value={toc.title} onChange={(e) => setToc({ ...toc, title: e.target.value })}/></label>
      <label>Bookmark levels<input aria-label="Bookmark levels to include" type="number" min={1} max={16} value={toc.maxDepth} onChange={(e) => setToc({ ...toc, maxDepth: Math.floor(Number(e.target.value)) })}/></label>
      <label>Entry size (pt)<input aria-label="Contents entry size" type="number" min={6} max={24} value={toc.fontSize} onChange={(e) => setToc({ ...toc, fontSize: Number(e.target.value) })}/></label>
      <button type="button" className="primary-action" disabled={disabled || !tree.length} onClick={() => void run('Generated a table of contents.', async (latest) => {
        const r = await generatePdfTableOfContents(latest, toc);
        const notes = [r.skipped ? `${r.skipped} bookmark(s) without a page were left out` : '', r.substituted ? `${r.substituted} title(s) had characters shown as ?` : ''].filter(Boolean).join('; ');
        return { bytes: r.bytes, summary: `Inserted ${r.tocPages} contents page(s) with ${r.entries} linked entries.${notes ? ` ${notes}.` : ''}` };
      })}>Generate table of contents</button>
    </div>}

    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <small>Each change applies to the working copy and can be undone.</small>
  </section>;
}
