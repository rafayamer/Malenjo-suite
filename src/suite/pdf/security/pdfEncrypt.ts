/**
 * Protect PDF (MAL-061): password-based AES-256 encryption (standard security handler, V 5 / R 6) with permission
 * flags. Every string and stream is encrypted with the file key (AES-256-CBC, a random IV per item); the key is
 * wrapped for the user and owner passwords, and the permissions are sealed in /Perms.
 *
 * Permission flags are honoured by conforming readers; they cannot stop software that ignores them, and the UI says so.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFObject } from 'pdf-lib';
import { aesEncrypt, aesEncryptRaw, concat, hashR6, passwordR6, randomBytes } from './pdfCrypto';

export type PrintPermission = 'none' | 'low' | 'high';
export interface PdfPermissions {
  print: PrintPermission;
  /** Change the document's content. */
  modify: boolean;
  /** Copy or extract text and graphics. */
  copy: boolean;
  /** Add or change comments, and fill forms. */
  annotate: boolean;
  /** Fill existing form fields (even when commenting is not allowed). */
  fillForms: boolean;
  /** Extract text for accessibility tools. */
  accessibility: boolean;
  /** Insert, rotate or delete pages, and create bookmarks or thumbnails. */
  assemble: boolean;
}
export const ALL_PERMISSIONS: PdfPermissions = { print: 'high', modify: true, copy: true, annotate: true, fillForms: true, accessibility: true, assemble: true };
export interface ProtectOptions { userPassword: string; ownerPassword: string; permissions: PdfPermissions }

const N = PDFName.of;

/** The /P value: bits 3–6 and 9–12 are the permissions; bits 7–8 and 13–32 are set, bits 1–2 clear. */
export function permissionBits(p: PdfPermissions): number {
  let bits = 0xfffff0c0;
  if (p.print !== 'none') bits |= 1 << 2;
  if (p.modify) bits |= 1 << 3;
  if (p.copy) bits |= 1 << 4;
  if (p.annotate) bits |= 1 << 5;
  if (p.fillForms) bits |= 1 << 8;
  if (p.accessibility) bits |= 1 << 9;
  if (p.assemble) bits |= 1 << 10;
  if (p.print === 'high') bits |= 1 << 11;
  return bits | 0;
}
export function permissionsFromBits(bits: number): PdfPermissions {
  const on = (bit: number) => (bits & (1 << (bit - 1))) !== 0;
  return { print: !on(3) ? 'none' : on(12) ? 'high' : 'low', modify: on(4), copy: on(5), annotate: on(6), fillForms: on(9), accessibility: on(10), assemble: on(11) };
}

const MAX_INPUT = 200 * 1024 * 1024;

export async function protectPdf(bytes: Uint8Array, options: ProtectOptions): Promise<Uint8Array> {
  if (bytes.length > MAX_INPUT) throw new Error('Protect PDF handles files up to 200 MB.');
  if (!options.ownerPassword) throw new Error('Enter an owner password: it is needed to change or remove the protection later.');
  if (options.ownerPassword === options.userPassword) throw new Error('Use a different owner password from the open password, or anyone who can open the PDF could remove its protection.');
  let source: PDFDocument;
  try { source = await PDFDocument.load(bytes, { updateMetadata: false }); } catch (error) {
    if (/encrypt/i.test(String(error))) throw new Error('This PDF is already protected. Remove its protection first, then protect it again.');
    throw new Error('This PDF could not be read because it is invalid or damaged.');
  }
  if (source.getForm().getFields().some((f) => f.acroField.dict.lookup(N('FT')) === N('Sig') && f.acroField.dict.has(N('V')))) {
    throw new Error('This PDF is digitally signed; encrypting it would invalidate the signatures. Protect an unsigned copy instead.');
  }
  // One plain save first, without object streams, so every object is an ordinary indirect object to encrypt.
  const doc = await PDFDocument.load(await source.save({ useObjectStreams: false, updateFieldAppearances: false }), { updateMetadata: false });
  const fileKey = randomBytes(32);

  const encryptValue = async (value: PDFObject): Promise<PDFObject> => {
    if (value instanceof PDFString || value instanceof PDFHexString) {
      const iv = randomBytes(16);
      return PDFHexString.of(toHex(concat(iv, await aesEncrypt(fileKey, iv, value.asBytes()))));
    }
    // In place, so the catalog and page tree keep the classes pdf-lib gave them.
    if (value instanceof PDFArray) { for (let i = 0; i < value.size(); i++) value.set(i, await encryptValue(value.get(i))); return value; }
    if (value instanceof PDFDict) { for (const [key, item] of value.entries()) value.set(key, await encryptValue(item)); return value; }
    return value;
  };

  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFStream) {
      const type = object.dict.lookupMaybe(N('Type'), PDFName);
      if (type === N('XRef') || type === N('ObjStm')) continue;
      const contents = object instanceof PDFRawStream ? object.contents : object.getContents();
      const dict = await encryptValue(object.dict) as PDFDict;
      const iv = randomBytes(16);
      const sealed = concat(iv, await aesEncrypt(fileKey, iv, contents));
      dict.set(N('Length'), PDFNumber.of(sealed.length));
      doc.context.assign(ref, PDFRawStream.of(dict, sealed));
    } else doc.context.assign(ref, await encryptValue(object));
  }

  // Key wrapping (ISO 32000-2, Algorithms 8–10).
  const user = passwordR6(options.userPassword), owner = passwordR6(options.ownerPassword);
  const [uValidation, uKey, oValidation, oKey] = [randomBytes(8), randomBytes(8), randomBytes(8), randomBytes(8)];
  const U = concat(await hashR6(user, uValidation), uValidation, uKey);
  const UE = await aesEncryptRaw(await hashR6(user, uKey), new Uint8Array(16), fileKey);
  const O = concat(await hashR6(owner, oValidation, U), oValidation, oKey);
  const OE = await aesEncryptRaw(await hashR6(owner, oKey, U), new Uint8Array(16), fileKey);
  const p = permissionBits(options.permissions);
  const perms = new Uint8Array(16);
  new DataView(perms.buffer).setInt32(0, p, true);
  perms.set([0xff, 0xff, 0xff, 0xff, 0x54 /* T: metadata is encrypted */, 0x61, 0x64, 0x62], 4);
  perms.set(randomBytes(4), 12);
  const Perms = await aesEncryptRaw(fileKey, new Uint8Array(16), perms); // one block: CBC with a zero IV is ECB

  const encrypt = doc.context.obj({
    Filter: 'Standard', V: 5, R: 6, Length: 256, P: p, EncryptMetadata: true,
    CF: { StdCF: { Type: 'CryptFilter', CFM: 'AESV3', AuthEvent: 'DocOpen', Length: 32 } }, StmF: 'StdCF', StrF: 'StdCF',
    O: PDFHexString.of(toHex(O)), U: PDFHexString.of(toHex(U)), OE: PDFHexString.of(toHex(OE)), UE: PDFHexString.of(toHex(UE)), Perms: PDFHexString.of(toHex(Perms)),
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt) as PDFRef;
  if (!doc.context.trailerInfo.ID) { const id = PDFHexString.of(toHex(randomBytes(16))); doc.context.trailerInfo.ID = doc.context.obj([id, id]); }
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
}

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
