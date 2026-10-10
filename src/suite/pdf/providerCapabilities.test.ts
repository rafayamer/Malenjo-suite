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

const officeConvert:PdfProviderComponentStatus={
  id:'stirling-office-convert',
  available:true,
  version:'0.2.2',
  executable:'C:\\MALENJO\\providers\\stirling-core\\stirling-pdf.jar',
  source:'core',
  message:'source-verified',
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

  it('does not advertise genuinely Ghostscript-only vector operations without an approved provider',()=>{
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

  it('keeps Scanner Effect and non-CMYK Replace/Invert modes on open-core Java/PDFBox',()=>{
    const scanner=resolvePdfProviderCapability(operation('/api/v1/misc/scanner-effect','scannerEffect'),[]);
    const replace=resolvePdfProviderCapability(operation('/api/v1/misc/replace-invert-pdf','replaceInvertPdf'),[]);
    expect(scanner).toEqual(expect.objectContaining({available:true,providerId:'stirling-core'}));
    expect(replace).toEqual(expect.objectContaining({available:true,providerId:'stirling-core'}));

    const [resolved]=applyPdfProviderCapabilities([{
      id:'replaceInvertPdf',
      path:'/api/v1/misc/replace-invert-pdf',
      method:'POST',
      summary:'Replace-Invert Color PDF',
      description:'',
      tags:[],
      fields:[{
        name:'replaceAndInvertOption',
        label:'Replace And Invert Option',
        kind:'string',
        required:true,
        location:'form',
        enumValues:['HIGH_CONTRAST_COLOR','CUSTOM_COLOR','FULL_INVERSION','COLOR_SPACE_CONVERSION'],
        defaultValue:'HIGH_CONTRAST_COLOR',
      }],
      category:'edit',
      capability:replace,
    }],[]);
    expect(resolved.fields[0].enumValues).toEqual([
      'HIGH_CONTRAST_COLOR','CUSTOM_COLOR','FULL_INVERSION',
    ]);
    expect(resolved.fields[0].defaultValue).toBe('HIGH_CONTRAST_COLOR');
    expect(resolved.fields[0].description).toMatch(/Ghostscript/i);
  });

  it('routes reviewed Office conversions to embedded Stirling Office Convert 0.2.2',()=>{
    for(const variant of [
      {path:'/api/v1/convert/file/pdf',id:'processFileToPDF',summary:'Convert a file to a PDF'},
      {path:'/api/v1/convert/pdf/word',id:'convertPDFToWord',summary:'Convert PDF to Word'},
      {path:'/api/v1/convert/pdf/presentation',id:'convertPDFToPresentation',summary:'Convert PDF to Presentation'},
      {path:'/api/v1/convert/pdf/text',id:'processPdfToRTForTXT',summary:'Convert PDF to RTF/TXT'},
      {path:'/api/v1/convert/pdf/xlsx',id:'pdfToExcel',summary:'Convert PDF to XLSX'},
    ]){
      const result=resolvePdfProviderCapability(variant,[officeConvert]);
      expect(result).toEqual(expect.objectContaining({
        available:true,
        providerId:'stirling-office-convert',
        providerVersion:'0.2.2',
        componentPack:'stirling-core-embedded',
      }));
    }
    const html=resolvePdfProviderCapability(
      {path:'/api/v1/convert/pdf/html',id:'convertPDFToHTML',summary:'Convert PDF to HTML'},[officeConvert],
    );
    expect(html.available).toBe(false);
    expect(html.providerId).toMatch(/libreoffice|pdftohtml/);
  });

  it('keeps embedded Office routes unavailable when the selected Stirling pack is not source-verified',()=>{
    const result=resolvePdfProviderCapability(
      {path:'/api/v1/convert/pdf/word',id:'convertPDFToWord',summary:'Convert PDF to Word'},
      [{...officeConvert,available:false,source:'configured',message:'manifest mismatch'}],
    );
    expect(result).toEqual(expect.objectContaining({
      available:false,
      providerId:'stirling-office-convert',
      disabledReason:'manifest mismatch',
    }));
  });

  it('removes the Office implementation toggle and constrains reviewed input formats',()=>{
    const fields:PdfProviderOperation['fields']=[
      {name:'fileInput',label:'File Input',kind:'file',required:true,location:'form'},
      {name:'useStirlingOfficeConvert',label:'Use Stirling Office Convert',kind:'boolean',required:false,location:'query'},
    ];
    const [fileToPdf]=applyPdfProviderCapabilities([{
      id:'processFileToPDF',
      path:'/api/v1/convert/file/pdf',
      method:'POST',
      summary:'Convert a file to a PDF',
      description:'',
      tags:[],
      fields,
      category:'convert',
      capability:resolvePdfProviderCapability(
        {path:'/api/v1/convert/file/pdf',id:'processFileToPDF',summary:'Convert a file to a PDF'},[officeConvert],
      ),
    }],[officeConvert]);
    expect(fileToPdf.fields.map((field)=>field.name)).toEqual(['fileInput']);
    expect(fileToPdf.fields[0].accept).toContain('.docx');
    expect(fileToPdf.fields[0].accept).toContain('.txt');
    expect(fileToPdf.fields[0].accept).toContain('.pptx');
    expect(fileToPdf.fields[0].accept).toContain('.xlsx');

    const [pdfToWord]=applyPdfProviderCapabilities([{
      id:'convertPDFToWord',
      path:'/api/v1/convert/pdf/word',
      method:'POST',
      summary:'Convert PDF to Word',
      description:'',
      tags:[],
      fields,
      category:'convert',
      capability:resolvePdfProviderCapability(
        {path:'/api/v1/convert/pdf/word',id:'convertPDFToWord',summary:'Convert PDF to Word'},[officeConvert],
      ),
    }],[officeConvert]);
    expect(pdfToWord.fields[0].accept).toBe('.pdf');
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

  it('does not turn absent OCR, LibreOffice-only or proprietary providers into operational tools',()=>{
    expect(resolvePdfProviderCapability(operation('/api/v1/misc/ocr-pdf'),[]).available).toBe(false);
    expect(resolvePdfProviderCapability(operation('/api/v1/convert/pdf-to-xml','convertPDFToXML'),[]).available).toBe(false);
    expect(resolvePdfProviderCapability(operation('/api/v1/misc/form-detection'),[]).available).toBe(false);
  });

  it('keeps Java alternatives operational for crop and Markdown conversion',()=>{
    expect(resolvePdfProviderCapability(operation('/api/v1/general/crop'),[]).providerId).toBe('stirling-core');
    expect(resolvePdfProviderCapability(operation('/api/v1/convert/markdown-to-pdf'),[]).available).toBe(true);
  });

  it('does not claim offline functionality for unreviewed TSA, veraPDF or Tauri-disabled pipeline endpoints',()=>{
    const timestamp=resolvePdfProviderCapability(
      operation('/api/v1/security/timestamp-pdf','timestampPdf'),[],
    );
    expect(timestamp.available).toBe(false);
    expect(timestamp.providerId).toBe('tsa');
    expect(timestamp.disabledReason).toMatch(/external TSA/i);

    const standards=resolvePdfProviderCapability(
      operation('/api/v1/security/verify-pdf','verifyPdf'),[],
    );
    expect(standards.available).toBe(false);
    expect(standards.providerId).toBe('verapdf');
    expect(standards.disabledReason).toMatch(/not been verified/i);

    const pipeline=resolvePdfProviderCapability(
      operation('/api/v1/pipeline/handleData','handleData'),[],
    );
    expect(pipeline.available).toBe(false);
    expect(pipeline.providerId).toBe('stirling-pipeline');
    expect(pipeline.disabledReason).toMatch(/TAURI_MODE/i);
  });
});
