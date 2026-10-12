import type { PdfTaskCategory } from './taskToolbar';

/** Discovery-only capabilities. They are NEVER registered as executable actions. */
export interface PlannedPdfFeature {
  id: string;
  label: string;
  reason: string;
}

export const PDF_PLANNED_FEATURES: Partial<Record<PdfTaskCategory, readonly PlannedPdfFeature[]>> = {
  edit: [
    { id:'edit-existing-text', label:'Edit PDF text', reason:'Editing existing text in-place has not passed fidelity and export validation.' },
    { id:'redact-pdf', label:'Redact', reason:'Permanent redaction and content-removal verification are not release-ready.' },
  ],
  convert: [
    { id:'to-docx', label:'PDF to Word', reason:'PDF-to-DOCX conversion and automatic Word viewer handoff are not release-ready.' },
    { id:'to-xlsx', label:'PDF to Excel', reason:'PDF-to-XLSX conversion and automatic spreadsheet viewer handoff are not release-ready.' },
    { id:'to-pptx', label:'PDF to Slides', reason:'PDF-to-PPTX conversion and automatic presentation viewer handoff are not release-ready.' },
  ],
  review: [
    { id:'highlight-text', label:'Highlight text', reason:'Text-range highlight annotations require independent saved-PDF validation.' },
  ],
  protect: [
    { id:'digital-sign-pdf', label:'Digital sign', reason:'Certificate-backed digital signing and independent verification are not release-ready.' },
    { id:'encrypt-pdf', label:'Encrypt PDF', reason:'PDF password encryption and independent reader validation are not release-ready.' },
    { id:'redact-sensitive', label:'Remove sensitive data', reason:'Verified sanitization and metadata removal are not release-ready.' },
  ],
  forms: [
    { id:'form-designer', label:'Form designer', reason:'Full visual AcroForm designer and cross-reader compatibility are not release-ready.' },
  ],
  tools: [
    { id:'ai-summarize', label:'Summarize PDF', reason:'One-click AI PDF summaries require a verified local model, source grounding and acceptance. Use the top AI chat meanwhile.' },
    { id:'ai-translate', label:'Translate PDF', reason:'Layout-preserving multilingual translation is not release-ready.' },
  ],
  optimize: [
    { id:'searchable-ocr', label:'Searchable OCR', reason:'Full text alignment, Unicode coverage and searchable-output acceptance are not release-ready.' },
  ],
  automate: [
    { id:'batch-pdf', label:'Batch PDF jobs', reason:'End-to-end unattended batch PDF processing is not release-ready.' },
  ],
};

export function plannedPdfFeatures(category: PdfTaskCategory): readonly PlannedPdfFeature[] {
  return PDF_PLANNED_FEATURES[category] ?? [];
}
