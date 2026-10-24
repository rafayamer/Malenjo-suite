// Turn library failures into messages a person can act on. Raw pdf-lib and
// PDF.js messages (for example "use PDFDocument.load(..., { ignoreEncryption:
// true })") are developer hints and must never reach the PDF workspace UI.

export const ENCRYPTED_EDIT_MESSAGE =
  'This PDF is encrypted, so MALENJO can show it but cannot edit it. ' +
  'Remove its password or restrictions first, then edit the unlocked copy. Your file was not changed.';

const INVALID_PDF_MESSAGE =
  'This file is not a valid PDF, or it is too damaged to repair. Try exporting it again from the app that created it.';

function errorName(reason: unknown): string {
  return typeof reason === 'object' && reason !== null && typeof (reason as { name?: unknown }).name === 'string'
    ? (reason as { name: string }).name
    : '';
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'object' && reason !== null && typeof (reason as { message?: unknown }).message === 'string') {
    return (reason as { message: string }).message;
  }
  return String(reason);
}

export function isEncryptedPdfError(reason: unknown): boolean {
  return errorName(reason) === 'EncryptedPDFError' || /PDFDocument\.load.*is encrypted|is encrypted\. You can use/i.test(errorMessage(reason));
}

export function describePdfError(reason: unknown): string {
  if (isEncryptedPdfError(reason)) return ENCRYPTED_EDIT_MESSAGE;
  const name = errorName(reason);
  const message = errorMessage(reason);
  if (name === 'InvalidPDFException' || /^Invalid PDF structure\.?$/i.test(message)) return INVALID_PDF_MESSAGE;
  if (name === 'PdfPasswordRequiredError') return message;
  if (name === 'PasswordException') return 'This PDF is password-protected. Enter its password to open it.';
  if (/Failed to parse PDF document|No PDF header found|Invalid object ref/i.test(message)) return INVALID_PDF_MESSAGE;
  return message || 'The PDF operation failed. Your file was not changed.';
}

// An /Encrypt entry is either an indirect reference or an inline dictionary.
const ENCRYPT_ENTRY = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/;
const HEAD_BYTES = 16 * 1024;
const TAIL_BYTES = 256 * 1024;

function latin1(bytes: Uint8Array): string {
  let text = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return text;
}

/**
 * Cheap check for an /Encrypt entry. The trailer (or cross-reference stream
 * dictionary) is uncompressed and sits at the end of the file, or at the start
 * of linearized files, so only the head and tail are scanned. This can miss an
 * unusual layout; edits still fail safely with ENCRYPTED_EDIT_MESSAGE then.
 */
export function looksEncryptedPdf(bytes: Uint8Array): boolean {
  if (bytes.length <= HEAD_BYTES + TAIL_BYTES) return ENCRYPT_ENTRY.test(latin1(bytes));
  return ENCRYPT_ENTRY.test(latin1(bytes.subarray(0, HEAD_BYTES))) ||
    ENCRYPT_ENTRY.test(latin1(bytes.subarray(bytes.length - TAIL_BYTES)));
}
