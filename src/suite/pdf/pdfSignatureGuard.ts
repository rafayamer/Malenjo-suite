import { PDFDict, PDFName, type PDFDocument } from 'pdf-lib';

/**
 * Refuses certified or signed documents before an operation rewrites them, since rewriting
 * would invalidate the signature. Unsigned signature placeholders are allowed.
 * `action` completes the message, for example "stamping it".
 */
export function refuseSignedPdf(pdf: PDFDocument, action: string): void {
  if (pdf.catalog.has(PDFName.of('Perms'))) throw new Error(`This PDF is certified; ${action} would invalidate the certification.`);
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const signedField = object.get(PDFName.of('FT'))?.toString() === '/Sig' && object.has(PDFName.of('V'));
    if (object.has(PDFName.of('ByteRange')) || signedField) throw new Error(`This PDF is signed; ${action} would invalidate the signature.`);
  }
}
