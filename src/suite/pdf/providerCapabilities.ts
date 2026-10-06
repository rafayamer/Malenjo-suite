import type {
  PdfProviderCapability,
  PdfProviderComponentStatus,
  PdfProviderOperation,
} from './backend';

export const PDF_PROVIDER_LEGAL_REFERENCE='docs/audits/PDF-PROVIDER-MATRIX-PASS2.md';

export const PASS2_PENDING_COMPONENTS:PdfProviderComponentStatus[]=[
  {id:'ghostscript',available:false,source:'unavailable',message:'Not bundled: AGPL/commercial licensing requires a MALENJO replacement for the default business-compatible pack.'},
  {id:'libreoffice',available:false,source:'unavailable',message:'Not bundle-approved until the exact Windows binary/transitive license pack is reviewed.'},
  {id:'tesseract',available:false,source:'unavailable',message:'Apache-2.0 candidate; Windows component pack and language-data review are still pending.'},
  {id:'ocrmypdf',available:false,source:'unavailable',message:'Not selected as the business redistribution path while its runtime stack requires Ghostscript.'},
  {id:'pdftohtml',available:false,source:'unavailable',message:'Poppler/pdftohtml is not approved for the default business-compatible pack; replacement required.'},
  {id:'unoconvert',available:false,source:'unavailable',message:'Legacy copyleft conversion bridge is not approved for bundling; replacement required.'},
  {id:'weasyprint',available:false,source:'unavailable',message:'Candidate only; exact Windows native/transitive component pack is not yet approved.'},
  {id:'calibre',available:false,source:'unavailable',message:'GPLv3 calibre is not bundled in the default business-compatible component pack.'},
  {id:'opencv',available:false,source:'unavailable',message:'Python/OpenCV component pack is not yet approved and packaged.'},
  {id:'rar',available:false,source:'unavailable',message:'Proprietary RAR executable is not bundled; a redistributable CBR replacement is required.'},
  {id:'form-detection',available:false,source:'unavailable',message:'Pinned Stirling core disables proprietary form detection; a MALENJO-owned detector/model pack is required.'},
];

const pendingById=new Map(PASS2_PENDING_COMPONENTS.map((component)=>[component.id,component]));

function capability(
  available:boolean,
  implementation:string,
  providerId:string,
  options:Partial<PdfProviderCapability>={},
):PdfProviderCapability{
  return {
    available,
    implementation,
    providerId,
    providerVersion:options.providerVersion??null,
    componentPack:options.componentPack??null,
    disabledReason:options.disabledReason??null,
    fallback:options.fallback??null,
    legalReference:PDF_PROVIDER_LEGAL_REFERENCE,
  };
}

function coreCapability(fallback?:string):PdfProviderCapability{
  return capability(true,'Stirling open core / Java-PDFBox','stirling-core',{
    fallback:fallback??null,
    legalReference:PDF_PROVIDER_LEGAL_REFERENCE,
  });
}

function unavailable(id:string,operation:string):PdfProviderCapability{
  const component=pendingById.get(id);
  return capability(false,operation,id,{
    disabledReason:component?.message??'Required reviewed local provider is unavailable.',
  });
}

function firstAvailable(
  ids:string[],
  statuses:Map<string,PdfProviderComponentStatus>,
):PdfProviderComponentStatus|undefined{
  return ids.map((id)=>statuses.get(id)).find((item)=>item?.available);
}

function externalCapability(
  operation:string,
  ids:string[],
  statuses:Map<string,PdfProviderComponentStatus>,
):PdfProviderCapability{
  const found=firstAvailable(ids,statuses);
  if(found){
    return capability(true,operation,found.id,{
      providerVersion:found.version,
      componentPack:found.source==='bundled'?found.id+'-windows-x64':null,
    });
  }
  const reasons=ids.map((id)=>pendingById.get(id)?.message).filter(Boolean).join(' ');
  return capability(false,operation,ids.join('|'),{
    disabledReason:reasons||'No reviewed provider is available for this operation.',
  });
}

function operationKey(operation:Pick<PdfProviderOperation,'id'|'path'|'summary'>):string{
  return [operation.id,operation.path,operation.summary].join(' ').toLowerCase();
}

export function resolvePdfProviderCapability(
  operation:Pick<PdfProviderOperation,'id'|'path'|'summary'>,
  components:PdfProviderComponentStatus[],
):PdfProviderCapability{
  const text=operationKey(operation);
  const statuses=new Map([
    ...PASS2_PENDING_COMPONENTS,
    ...components,
  ].map((item)=>[item.id,item] as const));

  if(/repair/.test(text)){
    const qpdf=statuses.get('qpdf');
    if(qpdf?.available){
      return capability(true,'qpdf structural repair','qpdf',{
        providerVersion:qpdf.version,
        componentPack:qpdf.source==='bundled'?'qpdf-windows-x64':null,
        fallback:'Stirling Java/PDFBox repair',
      });
    }
    return coreCapability('qpdf 12.4.2 when the approved component pack is installed');
  }

  if(/compress-pdf|compresspdf|optimi[sz]e pdf/.test(text)){
    const qpdf=statuses.get('qpdf');
    if(qpdf?.available){
      return capability(true,'qpdf + Stirling Java/PDFBox optimization','qpdf',{
        providerVersion:qpdf.version,
        componentPack:qpdf.source==='bundled'?'qpdf-windows-x64':null,
        fallback:'Stirling Java/PDFBox compression',
      });
    }
    return coreCapability('qpdf structural optimization when the approved component pack is installed');
  }

  if(/(^|[\s/])crop([\s/]|$)|crop-pdf/.test(text)){
    return coreCapability('Ghostscript path intentionally not required');
  }

  if(/markdown-to-pdf|markdowntopdf/.test(text)){
    return coreCapability('WeasyPrint remains optional and unapproved as a bundled pack');
  }

  if(/replace-invert|scanner-effect|pdf-to-vector|vector-to-pdf/.test(text)){
    return unavailable('ghostscript','Ghostscript-only Stirling operation');
  }

  if(/ocr-pdf/.test(text)){
    return externalCapability('Local OCR provider',['tesseract','ocrmypdf'],statuses);
  }
  if(/auto-rotate-pdf/.test(text)){
    return externalCapability('Tesseract orientation detection',['tesseract'],statuses);
  }

  if(/file-to-pdf/.test(text)){
    return externalCapability('Office conversion provider',['libreoffice','unoconvert'],statuses);
  }
  if(/pdf-to-(word|presentation|rtf|xml|pdfa)/.test(text)){
    return externalCapability('Office/PDF conversion provider',['libreoffice'],statuses);
  }
  if(/pdf-to-html/.test(text)){
    return externalCapability('PDF to HTML provider',['libreoffice','pdftohtml'],statuses);
  }
  if(/pdf-to-markdown/.test(text)){
    return externalCapability('PDF to Markdown provider',['pdftohtml'],statuses);
  }

  if(/(html|url|eml)-to-pdf/.test(text)){
    return externalCapability('HTML-family rendering provider',['weasyprint'],statuses);
  }
  if(/pdf-to-epub/.test(text)){
    return externalCapability('EPUB conversion provider',['calibre'],statuses);
  }
  if(/extract-image-scans/.test(text)){
    return externalCapability('Python/OpenCV scan extraction provider',['opencv'],statuses);
  }
  if(/pdf-to-cbr/.test(text)){
    return externalCapability('CBR archive provider',['rar'],statuses);
  }
  if(/form-detection|autoformdetection/.test(text)){
    return externalCapability('MALENJO form-detection model pack',['form-detection'],statuses);
  }

  return coreCapability();
}

export function applyPdfProviderCapabilities(
  operations:PdfProviderOperation[],
  components:PdfProviderComponentStatus[],
):PdfProviderOperation[]{
  return operations.map((operation)=>({
    ...operation,
    capability:resolvePdfProviderCapability(operation,components),
  }));
}
