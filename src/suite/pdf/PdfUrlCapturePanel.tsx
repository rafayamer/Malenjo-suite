import {useState} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import type {PdfToolProvider} from './backend';
import {convertHtmlToPdf} from './htmlToPdf';

interface PublicHtmlResponse{url:string;bytes:number[];contentType:string}
export default function PdfUrlCapturePanel({provider}:{provider:PdfToolProvider}){
  const [url,setUrl]=useState('');
  const [agreed,setAgreed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  async function run(){
    if(busy||!agreed)return;
    if(!isTauri()){setError('Isolated URL capture requires the native desktop runtime.');return;}
    if(!window.confirm(
      'Make one HTTPS request to the explicitly entered public website? The PDF source is NOT uploaded. Only the received HTML is parsed, with NO scripts, CSS, images, fonts, redirects or subresources fetched. Restricted HTML markup will be refused. Continue?'
    ))return;
    setBusy(true);setError('');setNotice('');
    try{
      const response=await invoke<PublicHtmlResponse>('capture_public_https_html',{url});
      if(response.contentType!=='text/html')throw new Error('Unexpected URL capture content type.');
      const source=Uint8Array.from(response.bytes);
      const pdf=await convertHtmlToPdf(source);
      const saved=await provider.saveResponse({
        status:200,contentType:'application/pdf',bytes:Array.from(pdf),
      },'public-https-html-text');
      setNotice(saved?'Saved text-only HTML capture PDF: '+saved:'PDF capture save cancelled.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));setNotice('');}
    finally{setBusy(false);}
  }
  return <details className="stirling-component-details" aria-label="Opt in to capture public HTTPS HTML text as PDF">
    <summary>Capture public HTTPS text to PDF (opt-in restricted mode)</summary>
    <p>Requires your explicit network consent. Only HTTPS port 443 with vetted, DNS-pinned public IPv4 addresses is allowed. Proxies, redirects, images, scripts and other subresources are blocked. The inert offline HTML converter supports only plain headings, paragraphs and lists with no attributes/CSS, so most complex websites will be refused. No browser screenshot, CSS layout or page fidelity is claimed.</p>
    <label className="stirling-field">Public HTTPS URL
      <input type="url" maxLength={2048} placeholder="https://public.example.com/page" value={url}
        onChange={e=>setUrl(e.target.value)} disabled={busy}/>
    </label>
    <label className="stirling-field">
      <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} disabled={busy}/>
      I authorize one external HTTPS request to this specific URL.
    </label>
    <button disabled={busy||!agreed||!url.trim()||!isTauri()} onClick={()=>void run()} type="button">
      Capture only permitted HTML text as PDF
    </button>
    {error&&<p role="alert">{error}</p>}
    {notice&&<p>{notice}</p>}
  </details>;
}