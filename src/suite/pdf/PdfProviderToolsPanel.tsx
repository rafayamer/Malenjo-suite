import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, ChevronDown, FileOutput, Play, RefreshCw, Search,
  ServerCog, Square, TriangleAlert,
} from 'lucide-react';
import type {
  PdfProviderComponentStatus,
  PdfProviderInputFile,
  PdfProviderOperation,
  PdfProviderOperationField,
  PdfProviderStatus,
  PdfProviderToolCategory,
  PdfToolProvider,
} from './backend';
import { fieldAcceptsActivePdf } from './providerFileInputs';
import { computePdfParityCoverage } from './parityCoverage';
import { inspectPdfDocumentInfo } from './pdfInfo';
import { loadPdfBytes,disposePdf } from './engine';
import { extractPdfDocumentText } from './textExport';

interface Props{
  provider:PdfToolProvider;
  sourceBytes:Uint8Array|null;
  sourceName:string;
  category:PdfProviderToolCategory;
  onApplyPdf(label:string,bytes:Uint8Array):void|Promise<void>;
}

function defaultFieldValue(field:PdfProviderOperationField):string{
  if(field.defaultValue===undefined)return field.kind==='boolean'?'false':'';
  if(typeof field.defaultValue==='boolean')return field.defaultValue?'true':'false';
  return String(field.defaultValue);
}

function operationHaystack(operation:PdfProviderOperation):string{
  return [
    operation.summary,operation.description,operation.id,operation.path,...operation.tags,
    operation.capability.implementation,operation.capability.providerId,
    operation.capability.disabledReason??'',operation.capability.fallback??'',
    ...operation.fields.flatMap((field)=>[field.name,field.label,field.description??'']),
  ].join(' ').toLowerCase();
}

function localExportStem(name:string):string{
  const stem=name.replace(/\.pdf$/i,'').replace(/[^A-Za-z0-9._-]/g,'_').replace(/^\.+/,'').slice(0,100);
  return stem||'MALENJO-document';
}

function providerFilename(name:string):string{
  const trimmed=name.trim()||'document.pdf';
  return trimmed.toLowerCase().endsWith('.pdf')?trimmed:trimmed+'.pdf';
}

export default function PdfProviderToolsPanel({provider,sourceBytes,sourceName,category,onApplyPdf}:Props){
  const [status,setStatus]=useState<PdfProviderStatus|null>(null);
  const [components,setComponents]=useState<PdfProviderComponentStatus[]>([]);
  const [operations,setOperations]=useState<PdfProviderOperation[]>([]);
  const [catalogLoaded,setCatalogLoaded]=useState(false);
  const [search,setSearch]=useState('');
  const [selectedId,setSelectedId]=useState('');
  const [values,setValues]=useState<Record<string,string>>({});
  const [extraFiles,setExtraFiles]=useState<Record<string,File[]>>({});
  const [useActive,setUseActive]=useState<Record<string,boolean>>({});
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [allCategories,setAllCategories]=useState(false);

  const refresh=async(loadCatalog=false)=>{
    setError('');
    try{
      const [next,nextComponents]=await Promise.all([provider.status(),provider.componentStatus()]);
      setStatus(next);setComponents(nextComponents);
      if(next.running&&loadCatalog){
        const catalog=await provider.listOperations();
        setOperations(catalog);setCatalogLoaded(true);
      }else if(!next.running){
        // A sidecar may stop outside this panel. Never display stale
        // catalog entries as live provider availability or runnable tools.
        setOperations([]);setCatalogLoaded(false);setSelectedId('');
      }
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  };

  useEffect(()=>{void refresh(true);},[]);

  const filtered=useMemo(()=>{
    const terms=search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return operations.filter((operation)=>{
      if(!allCategories&&operation.category!==category)return false;
      if(!terms.length)return true;
      const haystack=operationHaystack(operation);
      return terms.every((term)=>haystack.includes(term));
    });
  },[allCategories,category,operations,search]);

  const selected=useMemo(()=>operations.find((operation)=>operation.id===selectedId)??null,[operations,selectedId]);
  const parity=useMemo(()=>computePdfParityCoverage(operations,catalogLoaded),[operations,catalogLoaded]);

  useEffect(()=>{
    if(selectedId&&filtered.some((operation)=>operation.id===selectedId))return;
    setSelectedId(filtered.find((operation)=>operation.capability.available)?.id??filtered[0]?.id??'');
  },[filtered,selectedId]);

  useEffect(()=>{
    if(!selected){setValues({});setExtraFiles({});setUseActive({});return;}
    const nextValues:Record<string,string>={};
    const nextUseActive:Record<string,boolean>={};
    let activeAssigned=false;
    for(const field of selected.fields){
      if(field.kind==='file'||field.kind==='files'){
        const canUseActive=fieldAcceptsActivePdf(field);
        nextUseActive[field.name]=canUseActive&&!activeAssigned;
        if(canUseActive&&!activeAssigned)activeAssigned=true;
      }else nextValues[field.name]=defaultFieldValue(field);
    }
    setValues(nextValues);setExtraFiles({});setUseActive(nextUseActive);setNotice('');setError('');
  },[selected?.id]);

  async function saveLocalPdfInfo(){
    if(!sourceBytes||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const info=await inspectPdfDocumentInfo(sourceBytes);
      const output=new TextEncoder().encode(JSON.stringify(info,null,2)+'\n');
      const saved=await provider.saveResponse({
        status:200,contentType:'application/json',bytes:Array.from(output),
      },localExportStem(sourceName)+'-info');
      setNotice(saved?`Saved local PDF information: ${saved}`:'PDF information save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
    }finally{
      setBusy(false);
    }
  }

  async function saveLocalSelectableText(){
    if(!sourceBytes||busy)return;
    setBusy(true);setError('');setNotice('');
    let loaded:Awaited<ReturnType<typeof loadPdfBytes>>|null=null;
    try{
      if(!sourceBytes.byteLength||sourceBytes.byteLength>512*1024*1024){
        throw new Error('Selectable-text export requires a PDF of at most 512 MB.');
      }
      loaded=await loadPdfBytes(sourceBytes);
      const result=await extractPdfDocumentText(loaded.document,{
        onProgress:(done,total)=>setNotice(`Reading selectable text: ${done}/${total} pages…`),
      });
      const output=new TextEncoder().encode(result);
      const saved=await provider.saveResponse({
        status:200,contentType:'text/plain; charset=utf-8',bytes:Array.from(output),
      },localExportStem(sourceName)+'-selectable-text');
      setNotice(saved?`Saved selectable PDF text: ${saved}`:'Text export save cancelled.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:String(reason));
      setNotice('');
    }finally{
      try{
        await disposePdf(loaded);
      }finally{
        setBusy(false);
      }
    }
  }

  async function startProvider(){
    setBusy(true);setError('');
    try{
      const next=await provider.start();setStatus(next);
      const [catalog,nextComponents]=await Promise.all([provider.listOperations(),provider.componentStatus()]);
      setOperations(catalog);setComponents(nextComponents);setCatalogLoaded(true);
      const available=catalog.filter((operation)=>operation.capability.available).length;
      setNotice(`Loaded ${catalog.length} local PDF API operations; ${available} are available through reviewed providers/fallbacks.`);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));await refresh(false);}
    finally{setBusy(false);}
  }

  async function stopProvider(){
    setBusy(true);setError('');
    try{
      await provider.stop();setOperations([]);setSelectedId('');setCatalogLoaded(false);await refresh(false);
      setNotice('Local PDF provider stopped.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }

  async function runSelected(){
    if(!selected||busy)return;
    if(!selected.capability.available){
      setError(selected.capability.disabledReason??'This PDF operation has no reviewed local provider.');
      return;
    }
    setBusy(true);setError('');setNotice('');
    try{
      const fields:Array<{name:string;value:string}>=[];
      const files:PdfProviderInputFile[]=[];
      for(const field of selected.fields){
        if(field.kind==='file'||field.kind==='files'){
          const picked=extraFiles[field.name]??[];
          const active=useActive[field.name]&&fieldAcceptsActivePdf(field)&&sourceBytes?[{
            field:field.name,filename:providerFilename(sourceName),contentType:'application/pdf',bytes:Array.from(sourceBytes),
          }]:[];
          const extras=await Promise.all(picked.map(async(file)=>({
            field:field.name,filename:file.name,contentType:file.type||undefined,bytes:Array.from(new Uint8Array(await file.arrayBuffer())),
          })));
          const combined=[...active,...extras];
          if(field.kind==='file'&&combined.length>1)combined.splice(1);
          if(field.required&&!combined.length)throw new Error(`${field.label} is required.`);
          files.push(...combined);continue;
        }
        const value=values[field.name]??'';
        if(field.required&&!value.trim())throw new Error(`${field.label} is required.`);
        if(value.trim()||field.kind==='boolean')fields.push({name:field.name,value});
      }
      const response=await provider.run(selected,fields,files);
      if(provider.responseIsPdf(response)){
        await onApplyPdf(`Local PDF core: ${selected.summary}`,Uint8Array.from(response.bytes));
        setNotice(`${selected.summary} completed and was applied to the current MALENJO working copy.`);
      }else{
        const saved=await provider.saveResponse(response,sourceName.replace(/\.pdf$/i,'')||'malenjo-output');
        setNotice(saved?`${selected.summary} completed. Output saved.`:`${selected.summary} completed; output save was cancelled.`);
      }
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  }

  function renderField(field:PdfProviderOperationField){
    if(field.kind==='file'||field.kind==='files'){
      const selectedFiles=extraFiles[field.name]??[];
      return <div className="stirling-field" key={field.name}>
        <label><span>{field.label}{field.required?' *':''}</span>
          <input type="file" accept={field.accept} multiple={field.kind==='files'} onChange={(event)=>setExtraFiles((current)=>({...current,[field.name]:Array.from(event.target.files??[])}))}/>
        </label>
        <label className="stirling-active-file">
          <input type="checkbox" checked={Boolean(useActive[field.name])} disabled={!sourceBytes||!fieldAcceptsActivePdf(field)} onChange={(event)=>setUseActive((current)=>({...current,[field.name]:event.target.checked}))}/>
          {fieldAcceptsActivePdf(field)?<>Use current PDF{sourceBytes?` (${sourceName})`:' — no PDF loaded'}</>:'Select a compatible local file'}
        </label>
        <small>{selectedFiles.length?`${selectedFiles.length} additional file(s) selected.`:(field.description??'')}</small>
      </div>;
    }
    if(field.kind==='boolean'){
      return <label className="stirling-field stirling-checkbox" key={field.name}>
        <input type="checkbox" checked={(values[field.name]??'false')==='true'} onChange={(event)=>setValues((current)=>({...current,[field.name]:event.target.checked?'true':'false'}))}/>
        <span>{field.label}{field.required?' *':''}</span>
        {field.description&&<small>{field.description}</small>}
      </label>;
    }
    if(field.enumValues?.length){
      return <label className="stirling-field" key={field.name}>
        <span>{field.label}{field.required?' *':''}</span>
        <select value={values[field.name]??''} onChange={(event)=>setValues((current)=>({...current,[field.name]:event.target.value}))}>
          {!field.required&&<option value="">Default</option>}
          {field.enumValues.map((value)=><option key={value} value={value}>{value}</option>)}
        </select>
        {field.description&&<small>{field.description}</small>}
      </label>;
    }
    if(field.kind==='json'){
      return <label className="stirling-field" key={field.name}>
        <span>{field.label}{field.required?' *':''}</span>
        <textarea rows={4} value={values[field.name]??''} placeholder="JSON" onChange={(event)=>setValues((current)=>({...current,[field.name]:event.target.value}))}/>
        {field.description&&<small>{field.description}</small>}
      </label>;
    }
    return <label className="stirling-field" key={field.name}>
      <span>{field.label}{field.required?' *':''}</span>
      <input type={field.kind==='number'||field.kind==='integer'?'number':'text'} step={field.kind==='integer'?'1':'any'} value={values[field.name]??''} onChange={(event)=>setValues((current)=>({...current,[field.name]:event.target.value}))}/>
      {field.description&&<small>{field.description}</small>}
    </label>;
  }

  return <section className="stirling-tools-panel" aria-label="Local PDF provider tools">
    <header className="stirling-tools-head">
      <div><p className="eyebrow">LOCAL PDF CORE</p><h3>Provider-backed PDF tools</h3><span>{provider.reviewedToolCount} reviewed open-core tool surfaces · runtime API catalog loads from the local provider.</span></div>
      <div className={status?.running?'stirling-provider-state ready':'stirling-provider-state'}>
        {status?.running?<CheckCircle2 size={15}/>:status?.installed?<ServerCog size={15}/>:<TriangleAlert size={15}/>}<span>{status?.running?'Ready':status?.installed?'Installed / stopped':'Provider pack missing'}</span>
      </div>
    </header>
    <div className="stirling-provider-actions">
      <button disabled={busy||Boolean(status?.running)} onClick={()=>void startProvider()}><Play size={14}/>Start local provider</button>
      <button disabled={busy||!status?.running} onClick={()=>void stopProvider()}><Square size={14}/>Stop</button>
      <button disabled={busy} onClick={()=>void refresh(Boolean(status?.running))}><RefreshCw size={14}/>Refresh</button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveLocalPdfInfo()}>
        <FileOutput size={14}/>Export PDF information (offline)
      </button>
      <button disabled={busy||!sourceBytes} onClick={()=>void saveLocalSelectableText()}>
        <FileOutput size={14}/>Export selectable text (offline)
      </button>
    </div>
    <p className="stirling-provider-message">{status?.message??'Checking local provider…'}</p>
    {!!components.length&&<details className="stirling-component-details">
      <summary>{components.filter((component)=>component.available).length}/{components.length} reviewed provider components available</summary>
      <div className="stirling-components" aria-label="Local PDF component status">
        {components.map((component)=><div key={component.id} className={component.available?'stirling-component ready':'stirling-component'}>
          {component.available?<CheckCircle2 size={13}/>:<TriangleAlert size={13}/>}
          <span><b>{component.id}</b><small>{component.version??component.message}</small></span>
        </div>)}
      </div>
    </details>}
    <details className="stirling-component-details" aria-label="Stirling PDF parity inventory">
      <summary>
        Stirling 90-tool parity register: {parity.upstreamFixtureMatched} tested API matches, {parity.pinnedControllerOnlyRouteMatches} additional Java controller matches, {parity.frontendOnlyRouteMatches} frontend-only matches, {parity.configurationOnlyMatches} configuration-only entries; {parity.sourceClassificationPending} unclassified;
        {catalogLoaded?` ${parity.liveRoutes} live routes / ${parity.providerEnabled} provider-enabled (unverified)`:' load local provider to check runtime'}
      </summary>
      <p className="stirling-provider-message">
        {parity.locallySourceAuditedPartial} local MALENJO operations have partial source/test evidence; {parity.total-parity.locallySourceAuditedPartial} still need a full implementation-source audit. A provider reporting an available endpoint is
        NOT proof of functional correctness, offline Windows operation, safe licensing,
        or export/reopen fidelity. None has passed the complete parity acceptance gate.
      </p>
      <div style={{maxHeight:340,overflowY:'auto'}}>
        <table aria-label="Stirling PDF tool parity by requirement">
          <thead><tr><th scope="col"># / Tool</th><th scope="col">Pinned API</th><th scope="col">Local provider</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {parity.rows.map((row)=><tr key={row.id}>
              <th scope="row">{row.order}. {row.id}</th>
              <td>{row.expectedEndpoint?`${row.expectedEndpoint}${row.controllerOnly?' (controller only)':''}`:(row.frontendRoute?`${row.frontendRoute} (frontend only)`:'No pinned route identified')}</td>
              <td>{row.locallySourceAuditedPartial?'Local foundation partial; ':''}{row.state==='provider-reports-available'?'Reported enabled; unverified'
                :row.state==='provider-disabled'?'Provider disabled'
                :row.state==='not-in-live-openapi'?'Missing from loaded OpenAPI'
                :row.state==='provider-not-loaded'?'Start local provider'
                :row.frontendCoreToolId?`Frontend ${row.frontendCoreToolId}; provider route unverified`:row.configurationOnly?'Configured upstream, no verified handler':'Needs upstream source investigation'}</td>
              <td><button type="button"
                disabled={!row.operation?.capability.available}
                onClick={()=>{if(row.operation){setAllCategories(true);setSearch('');setSelectedId(row.operation.id);}}}>
                Open
              </button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </details>
    {!status?.installed&&<p className="stirling-provider-help">Windows development pack: <code>powershell -ExecutionPolicy Bypass -File scripts/build-stirling-core.ps1</code>. The provider runs on 127.0.0.1 only and never starts at MALENJO launch.</p>}
    {status?.running&&<div className="stirling-catalog">
      <div className="stirling-catalog-filter">
        <label><Search size={14}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search local PDF API tools"/></label>
        <label className="stirling-all-categories"><input type="checkbox" checked={allCategories} onChange={(event)=>setAllCategories(event.target.checked)}/>All categories</label>
        <span>{filtered.length} operation{filtered.length===1?'':'s'}</span>
      </div>
      <label className="stirling-operation-select"><span>Tool</span><span className="select-wrap"><select value={selectedId} onChange={(event)=>setSelectedId(event.target.value)}>{filtered.map((operation)=><option key={operation.id} value={operation.id} disabled={!operation.capability.available}>{operation.summary}{operation.capability.available?'':' — unavailable'}</option>)}</select><ChevronDown size={13}/></span></label>
      {selected&&<div className="stirling-operation">
        <div className="stirling-operation-title"><div><b>{selected.summary}</b><small>{selected.method} {selected.path}</small></div><span>{selected.category}</span></div>
        {selected.description&&<p>{selected.description}</p>}
        <p className={selected.capability.available?'stirling-provider-message':'stirling-error'}>
          <b>{selected.capability.available?'Implementation':'Unavailable'}:</b> {selected.capability.implementation}
          {selected.capability.providerVersion?` · ${selected.capability.providerVersion}`:''}
          {selected.capability.componentPack?` · ${selected.capability.componentPack}`:''}
          {!selected.capability.available&&selected.capability.disabledReason?` — ${selected.capability.disabledReason}`:''}
          {selected.capability.fallback?` · Fallback: ${selected.capability.fallback}`:''}
        </p>
        <div className="stirling-fields">{selected.fields.map(renderField)}</div>
        <button className="stirling-run" disabled={busy||!selected.capability.available} onClick={()=>void runSelected()}><FileOutput size={15}/>{busy?'Running locally…':selected.capability.available?`Run ${selected.summary}`:'Provider unavailable'}</button>
      </div>}
      {!filtered.length&&<div className="stirling-empty">No local provider operation matches this task category/search.</div>}
    </div>}
    {notice&&<div className="stirling-notice" role="status">{notice}</div>}
    {error&&<div className="stirling-error" role="alert">{error}</div>}
  </section>;
}