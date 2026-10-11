import type {
  PdfProviderCapability,
  PdfProviderComponentStatus,
  PdfProviderOperation,
} from './backend';

export const PDF_PROVIDER_LEGAL_REFERENCE='docs/audits/PDF-PROVIDER-MATRIX-PASS2.md';

export const PASS2_PENDING_COMPONENTS:PdfProviderComponentStatus[]=[
  {id:'ghostscript',available:false,source:'unavailable',message:'Not bundled: AGPL/commercial licensing requires a MALENJO replacement for the default business-compatible pack.'},
  {id:'libreoffice',available:false,source:'unavailable',message:'Not bundle-approved until the exact Windows binary/transitive license pack is reviewed.'},
  {id:'tesseract',available:false,source:'unavailable',message:'Reviewed Tesseract 5.5.3 Windows pack with pinned eng/osd data is not installed; binary redistribution remains release-gated pending exact DLL license mapping.'},
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

function officeConvertCapability(
  statuses:Map<string,PdfProviderComponentStatus>,
):PdfProviderCapability{
  const component=statuses.get('stirling-office-convert');
  if(component?.available){
    return capability(true,'Stirling Office Convert / Java-PDFBox-POI','stirling-office-convert',{
      providerVersion:component.version??'0.2.2',
      componentPack:'stirling-core-embedded',
      fallback:'LibreOffice remains intentionally absent from the reviewed default provider pack',
    });
  }
  return capability(false,'Embedded Office conversion provider','stirling-office-convert',{
    disabledReason:component?.message??'The reviewed embedded Office Convert component was not verified in the selected Stirling pack.',
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

function compactOperationValue(value:string):string{
  return value.toLowerCase().replace(/[^a-z0-9]+/g,'');
}

function operationMatches(
  operation:Pick<PdfProviderOperation,'id'|'path'|'summary'>,
  ...aliases:string[]
):boolean{
  const values=[operation.id,operation.path,operation.summary].map(compactOperationValue);
  return aliases.some((alias)=>{
    const expected=compactOperationValue(alias);
    return values.some((value)=>value.includes(expected));
  });
}

export function resolvePdfProviderCapability(
  operation:Pick<PdfProviderOperation,'id'|'path'|'summary'>,
  components:PdfProviderComponentStatus[],
):PdfProviderCapability{
  const matches=(...aliases:string[])=>operationMatches(operation,...aliases);
  const statuses=new Map([
    ...PASS2_PENDING_COMPONENTS,
    ...components,
  ].map((item)=>[item.id,item] as const));

  // These controllers are present in the pinned source but are not
  // demonstrated as safe, offline-capable Windows operations in this pack.
  if(matches('timestamp-pdf','timestampPdf')){
    return capability(false,'RFC 3161 timestamp authority','tsa',{
      disabledReason:'An RFC 3161 trusted timestamp requires contacting an external TSA. Offline operation is not available or approved.',
    });
  }
  if(matches('verify-pdf','verifyPdf')){
    return capability(false,'veraPDF PDF/A and PDF/UA verification','verapdf',{
      disabledReason:'veraPDF runtime, rules and redistributable Windows pack have not been verified. Do not claim standards verification.',
    });
  }
  if(matches('handleData')){
    return capability(false,'Stirling automation pipeline','stirling-pipeline',{
      disabledReason:'Pinned Stirling PipelineController excludes STIRLING_PDF_TAURI_MODE; a reviewed local MALENJO implementation is required.',
    });
  }

  if(matches('repair')){
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

  if(matches('compress-pdf','compressPdf','optimize-pdf','optimizePdf')){
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

  if(matches('crop','crop-pdf','cropPdf')){
    return coreCapability('Ghostscript path intentionally not required');
  }

  if(matches('markdown-to-pdf','markdownToPdf','convertMarkdownToPdf')){
    return coreCapability('WeasyPrint remains optional and unapproved as a bundled pack');
  }

  if(matches('scanner-effect','scannerEffect')){
    return coreCapability('Pinned Stirling endpoint gating patched to its existing Java/PDFBox implementation');
  }
  if(matches('replace-invert-pdf','replaceInvertPdf')){
    return coreCapability('CMYK color-space conversion stays unavailable until a reviewed non-Ghostscript provider exists');
  }
  if(matches('pdf-to-vector','pdfToVector','vector-to-pdf','vectorToPdf')){
    return unavailable('ghostscript','Ghostscript-only Stirling operation');
  }

  if(matches('ocr-pdf','ocrPdf')){
    return externalCapability('Local OCR provider',['tesseract','ocrmypdf'],statuses);
  }
  if(matches('auto-rotate-pdf','autoRotatePdf')){
    return externalCapability('Tesseract orientation detection',['tesseract'],statuses);
  }

  if(matches('file-to-pdf','fileToPdf','processFileToPDF')){
    return officeConvertCapability(statuses);
  }
  if(matches(
    'pdf-to-word','pdfToWord','convertPdfToWord',
    'pdf-to-presentation','pdfToPresentation','convertPdfToPresentation',
    'pdf-to-rtf','pdfToRtf','convertPdfToRtf','processPdfToRTForTXT',
    'pdf-to-xlsx','pdfToXlsx','pdfToExcel',
  )){
    return officeConvertCapability(statuses);
  }
  if(matches(
    'pdf-to-xml','pdfToXml','convertPdfToXml',
    'pdf-to-pdfa','pdfToPdfa','convertPdfToPdfa',
  )){
    return externalCapability('LibreOffice/PDF conversion provider',['libreoffice'],statuses);
  }
  if(matches('pdf-to-html','pdfToHtml','convertPdfToHtml')){
    return externalCapability('PDF to HTML provider',['libreoffice','pdftohtml'],statuses);
  }
  if(matches('pdf-to-markdown','pdfToMarkdown','convertPdfToMarkdown')){
    return externalCapability('PDF to Markdown provider',['pdftohtml'],statuses);
  }

  if(matches(
    'html-to-pdf','htmlToPdf',
    'url-to-pdf','urlToPdf',
    'eml-to-pdf','emlToPdf',
  )){
    return externalCapability('HTML-family rendering provider',['weasyprint'],statuses);
  }
  if(matches('pdf-to-epub','pdfToEpub')){
    return externalCapability('EPUB conversion provider',['calibre'],statuses);
  }
  if(matches('extract-image-scans','extractImageScans')){
    return externalCapability('Python/OpenCV scan extraction provider',['opencv'],statuses);
  }
  if(matches('pdf-to-cbr','pdfToCbr')){
    return externalCapability('CBR archive provider',['rar'],statuses);
  }
  if(matches('form-detection','formDetection','autoFormDetection')){
    return externalCapability('MALENJO form-detection model pack',['form-detection'],statuses);
  }

  return coreCapability();
}

const OFFICE_TO_PDF_ACCEPT=[
  '.docx','.docm','.dotx','.dotm','.doc','.dot','.rtf','.odt','.ott','.fodt','.odm','.xml','.sxw','.stw','.pages',
  '.txt','.text','.log','.asc',
  '.pptx','.pptm','.ppsx','.ppsm','.potx','.potm','.odp','.otp','.fodp','.odg','.otg','.fodg','.sxi','.sti','.sxd','.std','.key',
  '.vsdx','.vsdm','.vssx','.vssm','.vstx','.vstm',
  '.xlsx','.xlsm','.xltx','.xltm','.xls','.xlt','.xlsb','.ods','.ots','.fods','.sxc','.stc','.slk','.sylk','.dif','.dbf','.numbers',
  '.wk1','.wks','.wk3','.wk4','.123','.csv','.tsv','.tab','.ppt','.pps','.pot',
].join(',');

function fieldsForResolvedCapability(
  operation:PdfProviderOperation,
  resolved:PdfProviderCapability,
):PdfProviderOperation['fields']{
  if(resolved.providerId==='stirling-office-convert'){
    const fileToPdf=operationMatches(operation,'file-to-pdf','fileToPdf','processFileToPDF');
    return operation.fields
      .filter((field)=>field.name!=='useStirlingOfficeConvert')
      .map((field)=>field.kind==='file'&&field.name==='fileInput'
        ? {
            ...field,
            accept:fileToPdf?OFFICE_TO_PDF_ACCEPT:'.pdf',
            description:fileToPdf
              ? 'Local in-process Office conversion. Only reviewed Stirling Office Convert 0.2.2 input formats are selectable.'
              : field.description,
          }
        : field);
  }
  if(
    resolved.providerId==='stirling-core'
    && operationMatches(operation,'replace-invert-pdf','replaceInvertPdf')
  ){
    return operation.fields.map((field)=>field.name==='replaceAndInvertOption'
      ? {
          ...field,
          kind:'string',
          enumValues:['HIGH_CONTRAST_COLOR','CUSTOM_COLOR','FULL_INVERSION'],
          defaultValue:'HIGH_CONTRAST_COLOR',
          description:'Java/PDFBox modes only. CMYK color-space conversion remains unavailable because the pinned implementation shells out to Ghostscript.',
        }
      : field);
  }
  if(
    resolved.providerId==='tesseract'
    && operationMatches(operation,'ocr-pdf','ocrPdf','processPdfWithOCR')
  ){
    const directTesseractFields=new Set(['fileInput','languages','ocrType']);
    return operation.fields
      .filter((field)=>directTesseractFields.has(field.name))
      .map((field)=>field.name==='languages'
        ? {
            ...field,
            kind:'string',
            enumValues:['eng'],
            defaultValue:'eng',
            description:'Reviewed local Tesseract language model. This pack currently includes English only.',
          }
        : field);
  }
  return operation.fields;
}

export function applyPdfProviderCapabilities(
  operations:PdfProviderOperation[],
  components:PdfProviderComponentStatus[],
):PdfProviderOperation[]{
  return operations.map((operation)=>{
    const resolved=resolvePdfProviderCapability(operation,components);
    return {
      ...operation,
      fields:fieldsForResolvedCapability(operation,resolved),
      capability:resolved,
    };
  });
}
