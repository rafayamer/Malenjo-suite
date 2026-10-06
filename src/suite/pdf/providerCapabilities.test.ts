import { describe,expect,it } from 'vitest';
import type { PdfProviderComponentStatus, PdfProviderOperation } from './backend';
import { applyPdfProviderCapabilities, resolvePdfProviderCapability } from './providerCapabilities';

function operation(path:string,id=path.split('/').at(-1)??'tool'):Pick<PdfProviderOperation,'id'|'path'|'summary'>{
  return {id,path,summary:id};
}

const qpdf:PdfProviderComponentStatus={
  id:'qpdf',
  available:true,
  version:'12.4.2',
  executable:'C:\\MALENJO\\providers\\qpdf\\qpdf.exe',
  source:'bundled',
  message:'ready',
};

const tesseract:PdfProviderComponentStatus={
  id:'tesseract',
  available:true,
  version:'5.5.3',
  executable:'C:\\MALENJO\\providers\\tesseract\\tesseract.exe',
  source:'bundled',
  message:'ready',
};

describe('PDF provider capability resolver',()=>{
  it('uses approved qpdf for repair and records the Java/PDFBox fallback',()=>{
    const result=resolvePdfProviderCapability(operation('/api/v1/misc/repair','repairPdf'),[qpdf]);
    expect(result).toEqual(expect.objectContaining({
      available:true,
      providerId:'qpdf',
      providerVersion:'12.4.2',
      componentPack:'qpdf-windows-x64',
    }));
    expect(result.fallback).toMatch(/PDFBox/i);
  });

  it('keeps repair and compression operational through real core fallbacks when qpdf is absent',()=>{
    const repair=resolvePdfProviderCapability(operation('/api/v1/misc/repair','repairPdf'),[]);
    const compress=resolvePdfProviderCapability(operation('/api/v1/misc/compress-pdf','optimizePdf'),[]);
    expect(repair.available).toBe(true);
    expect(repair.providerId).toBe('stirling-core');
    expect(compress.available).toBe(true);
    expect(compress.providerId).toBe('stirling-core');
  });

  it('keeps genuinely Ghostscript-only vector operations unavailable',()=>{
    for(const path of [
      '/api/v1/convert/pdf-to-vector',
      '/api/v1/convert/vector-to-pdf',
    ]){
      const result=resolvePdfProviderCapability(operation(path),[]);
      expect(result.available).toBe(false);
      expect(result.providerId).toBe('ghostscript');
      expect(result.disabledReason).toMatch(/not bundled/i);
    }
  });

  it('recovers scanner effect through the pinned Java/PDFBox-AWT implementation',()=>{
    const result=resolvePdfProviderCapability(operation('/api/v1/misc/scanner-effect','scannerEffect'),[]);
    expect(result).toEqual(expect.objectContaining({
      available:true,
      providerId:'stirling-core',
    }));
    expect(result.implementation).toMatch(/PDFBox-AWT/i);
  });

  it('recovers non-CMYK replace/invert through pinned open core and filters Ghostscript-only CMYK',()=>{
    const fields:PdfProviderOperation['fields']=[
      {
        name:'fileInput',label:'PDF',kind:'file',required:true,location:'form',
      },
      {
        name:'replaceAndInvertOption',
        label:'Mode',
        kind:'string',
        required:true,
        location:'form',
        enumValues:['HIGH_CONTRAST_COLOR','CUSTOM_COLOR','FULL_INVERSION','COLOR_SPACE_CONVERSION'],
        defaultValue:'HIGH_CONTRAST_COLOR',
      },
      {
        name:'highContrastColorCombination',
        label:'High contrast',
        kind:'string',
        required:false,
        location:'form',
        enumValues:['WHITE_TEXT_ON_BLACK','BLACK_TEXT_ON_WHITE','YELLOW_TEXT_ON_BLACK','GREEN_TEXT_ON_BLACK'],
      },
    ];
    const [resolved]=applyPdfProviderCapabilities([{
      id:'replaceInvertPdf',
      path:'/api/v1/misc/replace-invert-pdf',
      method:'POST',
      summary:'Replace-Invert Color PDF',
      description:'',
      tags:[],
      fields,
      category:'edit',
      capability:resolvePdfProviderCapability(operation('/api/v1/misc/replace-invert-pdf'),[]),
    }],[]);
    expect(resolved.capability).toEqual(expect.objectContaining({
      available:true,
      providerId:'stirling-core',
    }));
    expect(resolved.fields.find((field)=>field.name==='replaceAndInvertOption')).toEqual(expect.objectContaining({
      enumValues:['HIGH_CONTRAST_COLOR','CUSTOM_COLOR','FULL_INVERSION'],
      defaultValue:'HIGH_CONTRAST_COLOR',
    }));
  });

  it('normalizes Stirling slash paths, camelCase ids and spaced summaries before provider gating',()=>{
    const variants=[
      {path:'/api/v1/convert/pdf/word',id:'convertPDFToWord',summary:'Convert PDF to Word'},
      {path:'/api/v1/convert/pdf/presentation',id:'convertPDFToPresentation',summary:'Convert PDF to Presentation'},
      {path:'/api/v1/convert/pdf/html',id:'convertPDFToHTML',summary:'Convert PDF to HTML'},
    ];
    for(const variant of variants){
      const result=resolvePdfProviderCapability(variant,[]);
      expect(result.available).toBe(false);
      expect(result.providerId).toMatch(/libreoffice|pdftohtml/);
    }
  });

  it('enables OCR and OSD only when the reviewed Tesseract component is available',()=>{
    const ocr=resolvePdfProviderCapability(operation('/api/v1/misc/ocr-pdf','processPdfWithOCR'),[tesseract]);
    const rotate=resolvePdfProviderCapability(operation('/api/v1/misc/auto-rotate-pdf','autoRotatePdf'),[tesseract]);
    expect(ocr).toEqual(expect.objectContaining({
      available:true,
      providerId:'tesseract',
      providerVersion:'5.5.3',
      componentPack:'tesseract-windows-x64',
    }));
    expect(rotate).toEqual(expect.objectContaining({
      available:true,
      providerId:'tesseract',
      providerVersion:'5.5.3',
      componentPack:'tesseract-windows-x64',
    }));
  });

  it('exposes only controls implemented by the direct Tesseract OCR fallback',()=>{
    const fields:PdfProviderOperation['fields']=[
      'fileInput','languages','sidecar','deskew','rotatePages','clean','cleanFinal','ocrType','ocrRenderType','removeImagesAfter',
    ].map((name)=>({
      name,
      label:name,
      kind:name==='fileInput'?'file':'string',
      required:false,
      location:'form',
    }));
    const [resolved]=applyPdfProviderCapabilities([{
      id:'processPdfWithOCR',
      path:'/api/v1/misc/ocr-pdf',
      method:'POST',
      summary:'Process a PDF file with OCR',
      description:'',
      tags:[],
      fields,
      category:'scan',
      capability:resolvePdfProviderCapability(operation('/api/v1/misc/ocr-pdf'),[]),
    }],[tesseract]);
    expect(resolved.fields.map((field)=>field.name)).toEqual(['fileInput','languages','ocrType']);
    expect(resolved.fields.find((field)=>field.name==='languages')).toEqual(expect.objectContaining({
      kind:'string',
      enumValues:['eng'],
      defaultValue:'eng',
    }));
    expect(resolved.capability.providerId).toBe('tesseract');
  });

  it('does not turn absent OCR/Office/proprietary providers into operational tools',()=>{
    expect(resolvePdfProviderCapability(operation('/api/v1/misc/ocr-pdf'),[]).available).toBe(false);
    expect(resolvePdfProviderCapability(operation('/api/v1/convert/pdf-to-word'),[]).available).toBe(false);
    expect(resolvePdfProviderCapability(operation('/api/v1/misc/form-detection'),[]).available).toBe(false);
  });

  it('keeps Java alternatives operational for crop and Markdown conversion',()=>{
    expect(resolvePdfProviderCapability(operation('/api/v1/general/crop'),[]).providerId).toBe('stirling-core');
    expect(resolvePdfProviderCapability(operation('/api/v1/convert/markdown-to-pdf'),[]).available).toBe(true);
  });
});
