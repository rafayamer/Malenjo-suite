/**
 * Unlock and decrypt PDF (MAL-062): removes standard-security-handler protection (revisions 2–6: RC4 40/128-bit,
 * AES-128, AES-256) for a user who gives the password that permits it, and writes an unprotected copy.
 *
 * Where permitted: removing protection needs the owner (permissions) password. The open password alone is enough
 * only when the file grants every permission, since then the owner has placed no restriction to remove.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFParser, PDFRawStream, PDFRef, PDFString, type PDFObject } from 'pdf-lib';
import { aesDecrypt, concat, hashR6, legacyFileKey, legacyObjectKey, legacyUserCheck, legacyUserPasswordFromOwner, padPassword, passwordR6, rc4, type LegacyParams } from './pdfCrypto';
import { permissionsFromBits, type PdfPermissions } from './pdfEncrypt';

const N = PDFName.of;
const MAX_INPUT = 200 * 1024 * 1024;

export interface PdfProtection {
  encrypted: boolean;
  /** Human-readable method, e.g. "AES-256" or "RC4 128-bit". */
  method: string;
  /** Whether the file opens without a password. */
  opensWithoutPassword: boolean;
  permissions: PdfPermissions | null;
}
export interface UnlockResult { bytes: Uint8Array; authenticatedAs: 'owner' | 'user'; method: string }

type Cipher = 'none' | 'rc4' | 'aes128' | 'aes256';
interface Handler { r: number; v: number; key: Uint8Array; stm: Cipher; str: Cipher; encryptMetadata: boolean; p: number }

const bytesOf = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.asBytes() : new Uint8Array());
const num = (d: PDFDict, k: string, fallback: number) => d.lookupMaybe(N(k), PDFNumber)?.asNumber() ?? fallback;

/** The trailer's encryption dictionary and first file ID, read without decrypting anything. */
async function readTrailer(bytes: Uint8Array) {
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false }); } catch { throw new Error('This PDF could not be read because it is invalid or damaged.'); }
  const ref = doc.context.trailerInfo.Encrypt;
  const encrypt = ref ? doc.context.lookup(ref) : undefined;
  const id = doc.context.trailerInfo.ID ? doc.context.lookup(doc.context.trailerInfo.ID) : undefined;
  return { encrypt: encrypt instanceof PDFDict ? encrypt : undefined, encryptRef: ref instanceof PDFRef ? ref : undefined, id0: id instanceof PDFArray ? bytesOf(id.get(0)) : new Uint8Array() };
}

function cipherOf(encrypt: PDFDict, which: 'StmF' | 'StrF'): Cipher {
  const v = num(encrypt, 'V', 0);
  if (v < 4) return 'rc4';
  const name = encrypt.lookupMaybe(N(which), PDFName)?.decodeText() ?? 'Identity';
  if (name === 'Identity') return 'none';
  const cfm = encrypt.lookupMaybe(N('CF'), PDFDict)?.lookupMaybe(N(name), PDFDict)?.lookupMaybe(N('CFM'), PDFName)?.decodeText();
  return cfm === 'AESV3' ? 'aes256' : cfm === 'AESV2' ? 'aes128' : cfm === 'V2' ? 'rc4' : cfm === 'None' ? 'none' : (() => { throw new Error(`This PDF uses an encryption method (${cfm ?? 'unknown'}) MALENJO cannot remove.`); })();
}
const methodName = (c: Cipher, keyBytes: number) => c === 'aes256' ? 'AES-256' : c === 'aes128' ? 'AES-128' : c === 'rc4' ? `RC4 ${keyBytes * 8}-bit` : 'none';

/** Describes a PDF's protection without a password. */
export async function inspectPdfProtection(bytes: Uint8Array): Promise<PdfProtection> {
  const { encrypt, id0 } = await readTrailer(bytes);
  if (!encrypt) return { encrypted: false, method: 'none', opensWithoutPassword: true, permissions: null };
  const filter = encrypt.lookupMaybe(N('Filter'), PDFName)?.decodeText();
  if (filter !== 'Standard') return { encrypted: true, method: `${filter ?? 'unknown'} security handler (certificate or custom)`, opensWithoutPassword: false, permissions: null };
  const p = num(encrypt, 'P', -1) | 0;
  let opens = false;
  try { await authenticate(encrypt, id0, ''); opens = true; } catch { /* needs a password */ }
  return { encrypted: true, method: methodName(cipherOf(encrypt, 'StmF'), num(encrypt, 'Length', 40) / 8), opensWithoutPassword: opens, permissions: permissionsFromBits(p) };
}

async function authenticate(encrypt: PDFDict, id0: Uint8Array, password: string): Promise<{ handler: Handler; as: 'owner' | 'user' }> {
  const r = num(encrypt, 'R', 0), v = num(encrypt, 'V', 0), p = num(encrypt, 'P', -1) | 0;
  const o = bytesOf(encrypt.lookup(N('O'))), u = bytesOf(encrypt.lookup(N('U')));
  const encryptMetadata = encrypt.get(N('EncryptMetadata'))?.toString() !== 'false';
  const base = { r, v, p, encryptMetadata, stm: cipherOf(encrypt, 'StmF'), str: cipherOf(encrypt, 'StrF') };
  if (r === 5 || r === 6) {
    const pw = passwordR6(password);
    const hash = r === 6 ? hashR6 : async (pass: Uint8Array, salt: Uint8Array, udata: Uint8Array = new Uint8Array()) => new Uint8Array(await crypto.subtle.digest('SHA-256', concat(pass, salt, udata) as unknown as BufferSource));
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
    const unwrap = (key: Uint8Array, wrapped: Uint8Array) => aesDecrypt(key, new Uint8Array(16), wrapped.subarray(0, 32), false);
    if (same(await hash(pw, o.subarray(32, 40), u.subarray(0, 48)), o.subarray(0, 32))) {
      return { handler: { ...base, key: await unwrap(await hash(pw, o.subarray(40, 48), u.subarray(0, 48)), bytesOf(encrypt.lookup(N('OE')))) }, as: 'owner' };
    }
    if (same(await hash(pw, u.subarray(32, 40)), u.subarray(0, 32))) {
      return { handler: { ...base, key: await unwrap(await hash(pw, u.subarray(40, 48)), bytesOf(encrypt.lookup(N('UE')))) }, as: 'user' };
    }
    throw new Error('Incorrect password.');
  }
  if (r < 2 || r > 4) throw new Error(`This PDF uses security handler revision ${r}, which MALENJO cannot remove.`);
  const q: LegacyParams = { r, o, u, p, id0, lengthBytes: Math.max(5, Math.min(16, num(encrypt, 'Length', 40) / 8)), encryptMetadata };
  const ownerKey = legacyFileKey(legacyUserPasswordFromOwner(password, q), q);
  if (legacyUserCheck(ownerKey, q)) return { handler: { ...base, key: ownerKey }, as: 'owner' };
  const userKey = legacyFileKey(padPassword(password), q);
  if (legacyUserCheck(userKey, q)) return { handler: { ...base, key: userKey }, as: 'user' };
  throw new Error('Incorrect password.');
}

async function decryptBytes(h: Handler, cipher: Cipher, data: Uint8Array, ref: PDFRef): Promise<Uint8Array> {
  if (cipher === 'none' || !data.length) return data;
  if (cipher === 'aes256') return aesDecrypt(h.key, data.subarray(0, 16), data.subarray(16));
  const key = legacyObjectKey(h.key, ref.objectNumber, ref.generationNumber, cipher === 'aes128');
  return cipher === 'rc4' ? rc4(key, data) : aesDecrypt(key, data.subarray(0, 16), data.subarray(16));
}

async function decryptObject(h: Handler, value: PDFObject, ref: PDFRef, context: PDFDocument['context']): Promise<PDFObject> {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    try { return PDFHexString.of(Array.from(await decryptBytes(h, h.str, value.asBytes(), ref), (b) => b.toString(16).padStart(2, '0')).join('')); }
    catch { return value; } // a damaged string is kept rather than failing the whole file
  }
  // Arrays and dictionaries are decrypted in place: the parser gives the catalog and page tree their own classes.
  if (value instanceof PDFArray) { for (let i = 0; i < value.size(); i++) value.set(i, await decryptObject(h, value.get(i), ref, context)); return value; }
  if (value instanceof PDFDict) {
    // A signature's /Contents is never encrypted.
    const signature = value.lookupMaybe(N('Type'), PDFName) === N('Sig') || value.has(N('ByteRange'));
    for (const [key, item] of value.entries()) if (!(signature && key === N('Contents'))) value.set(key, await decryptObject(h, item, ref, context));
    return value;
  }
  return value;
}

/** A pdf-lib parser that decrypts each top-level object as it is read, before object streams are unpacked. */
function decryptingParser(bytes: Uint8Array, h: Handler, encryptRef: PDFRef | undefined) {
  const parser = PDFParser.forBytesWithOptions(bytes, Infinity, false, false) as unknown as Record<string, any>;
  parser.parseIndirectObject = async function parseIndirectObject(this: Record<string, any>) {
    const ref: PDFRef = this.parseIndirectObjectHeader();
    this.skipWhitespaceAndComments();
    let object: PDFObject = this.parseObject();
    this.skipWhitespaceAndComments();
    this.matchKeyword([0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a]); // endobj
    const type = object instanceof PDFRawStream ? object.dict.lookup(N('Type')) : undefined;
    if (type === N('XRef')) { (await import('pdf-lib')).PDFXRefStreamParser.forStream(object as PDFRawStream).parseIntoContext(); return ref; }
    if (encryptRef && ref.objectNumber === encryptRef.objectNumber && ref.generationNumber === encryptRef.generationNumber) { this.context.assign(ref, object); return ref; }
    if (object instanceof PDFRawStream) {
      const raw = object;
      const dict = await decryptObject(h, raw.dict, ref, this.context) as PDFDict;
      // A stream with its own Crypt filter (usually Identity) is not decrypted with the default method.
      const filter = dict.lookup(N('Filter'));
      const crypt = filter === N('Crypt') || (filter instanceof PDFArray && filter.get(0) === N('Crypt'));
      const metadata = dict.lookup(N('Type')) === N('Metadata') && !h.encryptMetadata;
      const contents = crypt || metadata ? raw.contents : await decryptBytes(h, h.stm, raw.contents, ref).catch(() => raw.contents);
      dict.set(N('Length'), PDFNumber.of(contents.length));
      object = PDFRawStream.of(dict, contents);
      if (type === N('ObjStm')) { await (await import('pdf-lib')).PDFObjectStreamParser.forStream(object as PDFRawStream).parseIntoContext(); return ref; }
    } else object = await decryptObject(h, object, ref, this.context);
    this.context.assign(ref, object);
    return ref;
  };
  return parser as unknown as PDFParser;
}

export async function unlockPdf(bytes: Uint8Array, password: string): Promise<UnlockResult> {
  if (bytes.length > MAX_INPUT) throw new Error('Unlock handles files up to 200 MB.');
  const { encrypt, encryptRef, id0 } = await readTrailer(bytes);
  if (!encrypt) throw new Error('This PDF is not protected; there is nothing to remove.');
  if (encrypt.lookupMaybe(N('Filter'), PDFName)?.decodeText() !== 'Standard') throw new Error('This PDF is protected with certificates or a custom security handler, which needs the recipient\'s private key; MALENJO cannot remove it with a password.');
  const { handler, as } = await authenticate(encrypt, id0, password);
  const permissions = permissionsFromBits(handler.p);
  const unrestricted = permissions.print === 'high' && permissions.modify && permissions.copy && permissions.annotate && permissions.fillForms && permissions.accessibility && permissions.assemble;
  if (as === 'user' && !unrestricted) throw new Error('That password opens the PDF, but removing its protection needs the owner (permissions) password.');
  const context = await decryptingParser(bytes, handler, encryptRef).parseDocument();
  delete (context.trailerInfo as { Encrypt?: unknown }).Encrypt;
  if (encryptRef) context.delete(encryptRef);
  const doc = new (PDFDocument as unknown as new (c: typeof context, ignoreEncryption: boolean, updateMetadata: boolean) => PDFDocument)(context, false, false);
  return { bytes: await doc.save({ useObjectStreams: false, updateFieldAppearances: false }), authenticatedAs: as, method: methodName(handler.stm, handler.key.length) };
}
