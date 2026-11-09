/**
 * Minimal DER reader and writer for the structures PDF signing needs (X.509, PKCS#12, CMS, RFC 3161).
 * The reader keeps each element's exact bytes, so signed parts (tbsCertificate, signed attributes) are verified
 * over what was actually signed.
 */

export interface Der {
  /** Full tag byte: class, constructed bit and number (only low tag numbers are used here). */
  tag: number;
  /** Header and contents. */
  bytes: Uint8Array;
  /** Contents only. */
  value: Uint8Array;
  children: Der[];
}

export const TAG = { BOOLEAN: 0x01, INTEGER: 0x02, BIT_STRING: 0x03, OCTET_STRING: 0x04, NULL: 0x05, OID: 0x06, UTF8: 0x0c, PRINTABLE: 0x13, IA5: 0x16, UTC_TIME: 0x17, GENERALIZED_TIME: 0x18, SEQUENCE: 0x30, SET: 0x31 } as const;

export class Asn1Error extends Error {}

export function parseDer(data: Uint8Array, offset = 0, end = data.length, depth = 0): Der {
  if (depth > 64) throw new Asn1Error('ASN.1 nesting is too deep.');
  if (offset + 2 > end) throw new Asn1Error('ASN.1 data is truncated.');
  const tag = data[offset];
  if ((tag & 0x1f) === 0x1f) throw new Asn1Error('High ASN.1 tag numbers are not supported.');
  let length = data[offset + 1]; let header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw new Asn1Error('Unsupported ASN.1 length.');
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + data[offset + 2 + i];
    header += count;
  }
  const start = offset + header; const stop = start + length;
  if (stop > end) throw new Asn1Error('ASN.1 element runs past its container.');
  const node: Der = { tag, bytes: data.subarray(offset, stop), value: data.subarray(start, stop), children: [] };
  if (tag & 0x20) {
    for (let at = start; at < stop;) { const child = parseDer(data, at, stop, depth + 1); node.children.push(child); at += child.bytes.length; }
  }
  return node;
}
/** Parses the contents of an OCTET STRING or BIT STRING that wraps DER. */
export const parseInner = (node: Der, skip = 0) => parseDer(node.value.subarray(skip));

export function oidToString(node: Der): string {
  const v = node.value; const parts: number[] = [];
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    n = n * 128 + (v[i] & 0x7f);
    if (!(v[i] & 0x80)) { if (!parts.length) parts.push(n < 80 ? Math.floor(n / 40) : 2, n < 80 ? n % 40 : n - 80); else parts.push(n); n = 0; }
  }
  return parts.join('.');
}
export function intBytes(node: Der): Uint8Array { let v = node.value; while (v.length > 1 && v[0] === 0) v = v.subarray(1); return v; }
export function intValue(node: Der): number { return intBytes(node).reduce((n, b) => n * 256 + b, 0); }
export function timeValue(node: Der): Date {
  const s = new TextDecoder().decode(node.value);
  const m = /^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.(\d+))?Z$/.exec(s);
  if (!m) throw new Asn1Error(`Unsupported time ${s}.`);
  let year = Number(m[1]); if (m[1].length === 2) year += year < 50 ? 2000 : 1900;
  return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), Number((m[7] ?? '0').slice(0, 3).padEnd(3, '0'))));
}
export const stringValue = (node: Der) => new TextDecoder(node.tag === 0x1e ? 'utf-16be' : 'utf-8').decode(node.value);
export const child = (node: Der, index: number): Der => { const c = node.children[index]; if (!c) throw new Asn1Error('ASN.1 structure is missing an element.'); return c; };
/** The first child with a context tag [n] (constructed or primitive). */
export const tagged = (node: Der, n: number) => node.children.find((c) => (c.tag & 0xc0) === 0x80 && (c.tag & 0x1f) === n);

// ---- writer ----

function lengthBytes(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = []; while (n > 0) { out.unshift(n & 0xff); n = Math.floor(n / 256); }
  return [0x80 | out.length, ...out];
}
export function encode(tag: number, ...contents: Uint8Array[]): Uint8Array {
  const total = contents.reduce((n, c) => n + c.length, 0);
  const head = [tag, ...lengthBytes(total)];
  const out = new Uint8Array(head.length + total); out.set(head);
  let at = head.length; for (const c of contents) { out.set(c, at); at += c.length; }
  return out;
}
export const seq = (...items: Uint8Array[]) => encode(TAG.SEQUENCE, ...items);
/** A DER SET OF: members sorted by their encodings. */
export const set = (...items: Uint8Array[]) => encode(TAG.SET, ...[...items].sort(compareBytes));
export const octets = (bytes: Uint8Array) => encode(TAG.OCTET_STRING, bytes);
export const nul = () => encode(TAG.NULL);
export const bool = (v: boolean) => encode(TAG.BOOLEAN, Uint8Array.of(v ? 0xff : 0));
export const explicit = (n: number, ...items: Uint8Array[]) => encode(0xa0 | n, ...items);
export const implicitConstructed = (n: number, inner: Uint8Array) => { const node = parseDer(inner); return encode(0xa0 | n, node.value); };
export function integer(value: number | Uint8Array): Uint8Array {
  let bytes: number[];
  if (typeof value === 'number') { bytes = []; let v = value; do { bytes.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0); }
  else { bytes = Array.from(value); while (bytes.length > 1 && bytes[0] === 0 && !(bytes[1] & 0x80)) bytes.shift(); }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return encode(TAG.INTEGER, Uint8Array.from(bytes));
}
export function oid(dotted: string): Uint8Array {
  const parts = dotted.split('.').map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) { const chunk: number[] = []; let v = p; do { chunk.unshift(v & 0x7f); v = Math.floor(v / 128); } while (v > 0); out.push(...chunk.map((b, i) => (i < chunk.length - 1 ? b | 0x80 : b))); }
  return encode(TAG.OID, Uint8Array.from(out));
}
export const utf8 = (s: string) => encode(TAG.UTF8, new TextEncoder().encode(s));
export function generalizedTime(d: Date): Uint8Array {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return encode(TAG.GENERALIZED_TIME, new TextEncoder().encode(`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`));
}
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
export const concatBytes = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
export const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export const OID = {
  data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2', encryptedData: '1.2.840.113549.1.7.6',
  contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47', timeStampToken: '1.2.840.113549.1.9.16.2.14', tstInfo: '1.2.840.113549.1.9.16.1.4',
  friendlyName: '1.2.840.113549.1.9.20', localKeyId: '1.2.840.113549.1.9.21',
  keyBag: '1.2.840.113549.1.12.10.1.1', shroudedKeyBag: '1.2.840.113549.1.12.10.1.2', certBag: '1.2.840.113549.1.12.10.1.3', x509Certificate: '1.2.840.113549.1.9.22.1',
  pbes2: '1.2.840.113549.1.5.13', pbkdf2: '1.2.840.113549.1.5.12', hmacSha1: '1.2.840.113549.2.7', hmacSha256: '1.2.840.113549.2.9', hmacSha384: '1.2.840.113549.2.10', hmacSha512: '1.2.840.113549.2.11',
  aes128cbc: '2.16.840.1.101.3.4.1.2', aes192cbc: '2.16.840.1.101.3.4.1.22', aes256cbc: '2.16.840.1.101.3.4.1.42',
  sha1: '1.3.14.3.2.26', sha256: '2.16.840.1.101.3.4.2.1', sha384: '2.16.840.1.101.3.4.2.2', sha512: '2.16.840.1.101.3.4.2.3',
  rsaEncryption: '1.2.840.113549.1.1.1', sha256WithRSA: '1.2.840.113549.1.1.11', sha384WithRSA: '1.2.840.113549.1.1.12', sha512WithRSA: '1.2.840.113549.1.1.13', sha1WithRSA: '1.2.840.113549.1.1.5', rsassaPss: '1.2.840.113549.1.1.10',
  ecPublicKey: '1.2.840.10045.2.1', ecdsaSha256: '1.2.840.10045.4.3.2', ecdsaSha384: '1.2.840.10045.4.3.3', ecdsaSha512: '1.2.840.10045.4.3.4',
  p256: '1.2.840.10045.3.1.7', p384: '1.3.132.0.34', p521: '1.3.132.0.35',
  commonName: '2.5.4.3', organization: '2.5.4.10', basicConstraints: '2.5.29.19', keyUsage: '2.5.29.15', extKeyUsage: '2.5.29.37', crlDistributionPoints: '2.5.29.31',
  timeStamping: '1.3.6.1.5.5.7.3.8', authorityInfoAccess: '1.3.6.1.5.5.7.1.1', ocsp: '1.3.6.1.5.5.7.48.1',
} as const;
