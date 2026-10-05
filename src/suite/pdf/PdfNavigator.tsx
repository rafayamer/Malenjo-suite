import { useEffect, useState } from 'react';
import { Download, FileText, ListTree, Paperclip } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import PdfThumbnail from './PdfThumbnail';
import {
  flattenPdfOutline,
  normalizePdfAttachments,
  resolvePdfOutlinePage,
  type PdfAttachmentEntry,
  type PdfOutlineEntry,
} from './navigation';

type NavigatorMode = 'pages' | 'bookmarks' | 'attachments';

interface Props {
  document: PDFDocumentProxy;
  pageCount: number;
  currentPage: number;
  selectedPages: Set<number>;
  onSelectPage(page:number, additive:boolean, range:boolean): void;
  onNavigatePage(page:number): void;
}

function formatBytes(bytes:number):string {
  if(bytes < 1024) return `${bytes} B`;
  if(bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export default function PdfNavigator({
  document,
  pageCount,
  currentPage,
  selectedPages,
  onSelectPage,
  onNavigatePage,
}:Props) {
  const [mode,setMode]=useState<NavigatorMode>('pages');
  const [outline,setOutline]=useState<PdfOutlineEntry[]>([]);
  const [outlineTruncated,setOutlineTruncated]=useState(false);
  const [attachments,setAttachments]=useState<PdfAttachmentEntry[]>([]);
  const [attachmentsTruncated,setAttachmentsTruncated]=useState(false);
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState('');

  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    setNotice('');

    void Promise.allSettled([
      document.getOutline(),
      document.getAttachments(),
    ]).then(([outlineResult,attachmentResult])=>{
      if(cancelled)return;

      if(outlineResult.status==='fulfilled'){
        const model=flattenPdfOutline(outlineResult.value);
        setOutline(model.entries);
        setOutlineTruncated(model.truncated);
      }else{
        setOutline([]);
        setNotice('Bookmarks could not be read from this PDF.');
      }

      if(attachmentResult.status==='fulfilled'){
        const model=normalizePdfAttachments(attachmentResult.value);
        setAttachments(model.entries);
        setAttachmentsTruncated(model.truncated);
      }else{
        setAttachments([]);
        setNotice((current)=>current || 'Embedded attachments could not be read from this PDF.');
      }
    }).finally(()=>{
      if(!cancelled)setLoading(false);
    });

    return()=>{cancelled=true;};
  },[document]);

  async function openBookmark(entry:PdfOutlineEntry){
    setNotice('');
    if(entry.dest){
      const page=await resolvePdfOutlinePage(document,entry.dest);
      if(page){
        onNavigatePage(page);
        return;
      }
    }

    if(entry.url){
      setNotice('This bookmark targets an external URL. MALENJO does not open document-supplied external links automatically.');
      return;
    }

    setNotice('This bookmark does not contain a resolvable internal page destination.');
  }

  function downloadAttachment(entry:PdfAttachmentEntry){
    setNotice('');
    if(!entry.downloadable){
      setNotice(entry.reason || 'This attachment cannot be extracted safely.');
      return;
    }

    const bytes=Uint8Array.from(entry.content);
    const url=URL.createObjectURL(new Blob([bytes.buffer],{type:'application/octet-stream'}));
    const anchor=documentGlobal().createElement('a');
    anchor.href=url;
    anchor.download=entry.name;
    anchor.rel='noopener';
    anchor.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),0);
    setNotice(`Extracted ${entry.name}. MALENJO did not execute or preview the embedded file.`);
  }

  return <aside className="pdf-thumbnails pdf-navigator" aria-label="PDF document navigator">
    <div className="pdf-navigator-tabs" role="tablist" aria-label="PDF navigation">
      <button className={mode==='pages'?'active':''} onClick={()=>setMode('pages')} title="Pages">
        <FileText size={14}/><span>Pages</span><b>{pageCount}</b>
      </button>
      <button className={mode==='bookmarks'?'active':''} onClick={()=>setMode('bookmarks')} title="Bookmarks">
        <ListTree size={14}/><span>Marks</span><b>{outline.length}</b>
      </button>
      <button className={mode==='attachments'?'active':''} onClick={()=>setMode('attachments')} title="Attachments">
        <Paperclip size={14}/><span>Files</span><b>{attachments.length}</b>
      </button>
    </div>

    {notice&&<div className="pdf-navigator-notice">{notice}</div>}

    {mode==='pages'&&<>
      <div className="pdf-selection-bar">
        <span>{selectedPages.size || 1} selected</span>
        <button onClick={()=>Array.from({length:pageCount},(_,index)=>index+1).forEach((page,index)=>onSelectPage(page,index>0,false))}>All</button>
        <button onClick={()=>onSelectPage(currentPage,false,false)}>Current</button>
      </div>
      <div className="pdf-thumbnail-list">
        {Array.from({length:pageCount},(_,index)=>index+1).map((page)=>
          <PdfThumbnail
            key={page}
            document={document}
            pageNumber={page}
            active={page===currentPage}
            selected={selectedPages.has(page)}
            onSelect={onSelectPage}
          />
        )}
      </div>
    </>}

    {mode==='bookmarks'&&<div className="pdf-outline-list">
      {loading&&<p>Reading bookmarks…</p>}
      {!loading&&!outline.length&&<div className="pdf-navigator-empty"><ListTree size={22}/><b>No bookmarks</b><span>This PDF does not expose an outline/bookmark tree.</span></div>}
      {outline.map((entry)=><button
        key={entry.id}
        style={{paddingLeft:`${10 + entry.depth * 12}px`}}
        title={entry.url ? `${entry.title} · external link is not auto-opened` : entry.title}
        onClick={()=>void openBookmark(entry)}
      >
        <span>{entry.title}</span>
        {entry.url&&<small>external</small>}
      </button>)}
      {outlineTruncated&&<div className="pdf-navigator-limit">Bookmark display capped at 1,000 entries.</div>}
    </div>}

    {mode==='attachments'&&<div className="pdf-attachment-list">
      {loading&&<p>Reading attachments…</p>}
      {!loading&&!attachments.length&&<div className="pdf-navigator-empty"><Paperclip size={22}/><b>No embedded files</b><span>This PDF does not expose embedded attachments.</span></div>}
      {attachments.map((entry)=><article key={entry.id}>
        <div><b title={entry.name}>{entry.name}</b><span>{formatBytes(entry.sizeBytes)}</span></div>
        <button
          disabled={!entry.downloadable}
          title={entry.reason || 'Extract attachment without executing it'}
          onClick={()=>downloadAttachment(entry)}
        ><Download size={13}/> Extract</button>
        {entry.reason&&<small>{entry.reason}</small>}
      </article>)}
      {attachmentsTruncated&&<div className="pdf-navigator-limit">Attachment display capped at 200 entries.</div>}
      {!!attachments.length&&<div className="pdf-attachment-warning">Embedded files are untrusted document content. MALENJO only extracts them after an explicit click and never executes them automatically.</div>}
    </div>}
  </aside>;
}

function documentGlobal(): Document {
  return window.document;
}
