import { useEffect, useMemo, useRef, useState } from 'react';
import { FileArchive, ListTree, Search, Thumbnails } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import PdfThumbnail from './PdfThumbnail';
import {
  buildPdfSearchIndex,
  readPdfAttachments,
  readPdfOutline,
  searchPdfIndex,
  type PdfAttachmentEntry,
  type PdfOutlineEntry,
  type PdfSearchPage,
} from './navigation';

type Mode='pages'|'outline'|'search'|'attachments';

interface Props{
  document:PDFDocumentProxy;
  pageCount:number;
  currentPage:number;
  selectedPages:Set<number>;
  onSelectPage(page:number,additive:boolean,range:boolean):void;
  onSelectAll():void;
  onSelectCurrent():void;
  onGoToPage(page:number):void;
  active:boolean;
}

function bytes(value:number):string{
  if(value<1024)return `${value} B`;
  if(value<1024*1024)return `${(value/1024).toFixed(1)} KB`;
  return `${(value/1024/1024).toFixed(1)} MB`;
}

function downloadAttachment(item:PdfAttachmentEntry){
  const owned=Uint8Array.from(item.content);
  const url=URL.createObjectURL(new Blob([owned.buffer],{type:'application/octet-stream'}));
  const anchor=window.document.createElement('a');
  anchor.href=url;
  anchor.download=item.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PdfNavigationPane({
  document,pageCount,currentPage,selectedPages,onSelectPage,onSelectAll,onSelectCurrent,onGoToPage,active,
}:Props){
  const searchInputRef=useRef<HTMLInputElement>(null);
  const [mode,setMode]=useState<Mode>('pages');
  const [outline,setOutline]=useState<PdfOutlineEntry[]>([]);
  const [attachments,setAttachments]=useState<PdfAttachmentEntry[]>([]);
  const [searchIndex,setSearchIndex]=useState<PdfSearchPage[]|null>(null);
  const [indexProgress,setIndexProgress]=useState('');
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');

  const results=useMemo(()=>searchIndex?searchPdfIndex(searchIndex,query):[],[searchIndex,query]);

  useEffect(()=>{
    let cancelled=false;
    setOutline([]);setAttachments([]);setSearchIndex(null);setQuery('');setError('');
    void Promise.all([
      readPdfOutline(document).catch(()=>[]),
      readPdfAttachments(document).catch(()=>[]),
    ]).then(([nextOutline,nextAttachments])=>{
      if(cancelled)return;
      setOutline(nextOutline);
      setAttachments(nextAttachments);
    });
    return()=>{cancelled=true;};
  },[document]);

  async function ensureSearchIndex(){
    if(searchIndex)return;
    setIndexProgress(`Indexing 0/${pageCount}`);
    setError('');
    try{
      const index=await buildPdfSearchIndex(document,(completed,total)=>setIndexProgress(`Indexing ${completed}/${total}`));
      setSearchIndex(index);
      setIndexProgress('');
    }catch(reason){
      setIndexProgress('');
      setError(reason instanceof Error?reason.message:String(reason));
    }
  }

  function selectMode(next:Mode){
    setMode(next);
    if(next==='search'){
      void ensureSearchIndex();
      window.setTimeout(()=>searchInputRef.current?.focus(),0);
    }
  }

  useEffect(()=>{
    if(!active)return;
    const handler=(event:KeyboardEvent)=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){
        event.preventDefault();
        selectMode('search');
      }
    };
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[active,searchIndex,document]);

  return <aside className="pdf-thumbnails pdf-navigation-pane" aria-label="PDF navigation">
    <div className="pdf-nav-tabs" role="tablist" aria-label="PDF navigation panels">
      <button className={mode==='pages'?'active':''} onClick={()=>selectMode('pages')} title="Pages"><Thumbnails size={15}/></button>
      <button className={mode==='outline'?'active':''} onClick={()=>selectMode('outline')} title="Outline / bookmarks"><ListTree size={15}/></button>
      <button className={mode==='search'?'active':''} onClick={()=>selectMode('search')} title="Find in document"><Search size={15}/></button>
      <button className={mode==='attachments'?'active':''} onClick={()=>selectMode('attachments')} title="Attachments"><FileArchive size={15}/>{attachments.length>0&&<b>{attachments.length}</b>}</button>
    </div>

    {mode==='pages'&&<>
      <div className="pdf-pane-title"><span>Pages</span><b>{pageCount}</b></div>
      <div className="pdf-selection-bar">
        <span>{selectedPages.size||1} selected</span>
        <button onClick={onSelectAll}>All</button>
        <button onClick={onSelectCurrent}>Current</button>
      </div>
      <div className="pdf-thumbnail-list">
        {Array.from({length:pageCount},(_,index)=>index+1).map(page=><PdfThumbnail
          key={page}
          document={document}
          pageNumber={page}
          active={page===currentPage}
          selected={selectedPages.has(page)}
          onSelect={onSelectPage}
        />)}
      </div>
    </>}

    {mode==='outline'&&<>
      <div className="pdf-pane-title"><span>Outline</span><b>{outline.length}</b></div>
      <div className="pdf-outline-list">
        {outline.map(item=><button
          key={item.id}
          disabled={!item.page}
          style={{paddingLeft:`${10+item.depth*14}px`,fontWeight:item.bold?700:500,fontStyle:item.italic?'italic':'normal'}}
          onClick={()=>item.page&&onGoToPage(item.page)}
        ><span>{item.title}</span>{item.page&&<small>{item.page}</small>}</button>)}
        {!outline.length&&<p>No embedded outline/bookmarks were found in this PDF.</p>}
      </div>
    </>}

    {mode==='search'&&<>
      <div className="pdf-pane-title"><span>Find</span><b>{results.length}</b></div>
      <div className="pdf-search-box"><Search size={14}/><input ref={searchInputRef} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search this PDF"/></div>
      {indexProgress&&<div className="pdf-index-progress">{indexProgress}</div>}
      {error&&<div className="pdf-nav-error">{error}</div>}
      <div className="pdf-search-results">
        {query&&results.map(result=><button key={result.id} onClick={()=>onGoToPage(result.page)}><b>Page {result.page}</b><span>{result.excerpt}</span></button>)}
        {query&&searchIndex&&!results.length&&<p>No matching text found.</p>}
        {!query&&<p>Search extracted PDF text locally. Press Ctrl/Cmd+F from the active PDF tab to return here.</p>}
      </div>
    </>}

    {mode==='attachments'&&<>
      <div className="pdf-pane-title"><span>Attachments</span><b>{attachments.length}</b></div>
      <div className="pdf-attachment-list">
        {attachments.map(item=><div key={item.id}><span><b>{item.name}</b><small>{bytes(item.sizeBytes)}</small></span><button onClick={()=>downloadAttachment(item)}>Download</button></div>)}
        {!attachments.length&&<p>No embedded file attachments were found.</p>}
      </div>
      <div className="pdf-attachment-warning">Attachments are never opened or executed automatically. Download only files you trust and scan them before opening.</div>
    </>}
  </aside>;
}
