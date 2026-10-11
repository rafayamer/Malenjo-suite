import type {PdfDocumentInfo} from './pdfInfo';

/**
 * Conservative offline Auto Rename: propose a Windows-safe output filename
 * derived from the PDF's standard Info title without rewriting the PDF.
 * Unlike Stirling content-based AutoRename, this cannot infer a title from OCR,
 * headings, or other document semantics and is only a partial fallback.
 */
export function proposePdfMetadataFilename(info:PdfDocumentInfo):string{
  const title=info.metadata.title;
  if(!title||!title.trim()){
    throw new Error('PDF has no document title. Add a metadata title before using offline auto-rename.');
  }
  const cleaned=title.normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g,' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,'')
    .replace(/\s+/g,' ').trim()
    .replace(/^[. ]+|[. ]+$/g,'')
    .slice(0,110).replace(/[. ]+$/,'');
  if(!cleaned||cleaned==='.'||cleaned==='..'){
    throw new Error('PDF document title cannot be used as a safe Windows filename.');
  }
  const reserved=/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
  const stem=reserved.test(cleaned)?'Document-'+cleaned:cleaned;
  return stem+'-renamed.pdf';
}
