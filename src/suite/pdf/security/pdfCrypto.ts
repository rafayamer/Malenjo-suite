/**
 * Primitives for the PDF standard security handler (ISO 32000-2, 7.6.4): MD5 and RC4 (which WebCrypto does not
 * offer), AES through WebCrypto, and the password algorithms for revisions 2–6.
 *
 * MD5 and RC4 are needed only to open and remove the protection of older files (revisions 2–4); new protection is
 * always AES-256 (revision 6).
 */

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('This environment has no Web Crypto, which PDF encryption needs.');
  return s;
};

// ---- MD5 (RFC 1321) ------------------------------------------------------------------------------

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const padded = new Uint8Array(((data.length + 8) >> 6 << 6) + 64);
  padded.set(data); padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(off + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const sum = (a + f + K[i] + m[g]) >>> 0;
      a = d; d = c; c = b;
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16); const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((w, i) => ov.setUint32(i * 4, w, true));
  return out;
}

// ---- RC4 ------------------------------------------------------------------------------------------

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

// ---- AES (WebCrypto CBC) ------------------------------------------------------------------------------

/** WebCrypto takes ArrayBuffer-backed views; the typed arrays here always are. */
const buf = (u: Uint8Array) => u as unknown as BufferSource;
const importAes = (key: Uint8Array, usage: KeyUsage) => subtle().importKey('raw', buf(key), 'AES-CBC', false, [usage]);

/** AES-CBC with PKCS#7 padding. */
export async function aesEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: buf(iv) }, await importAes(key, 'encrypt'), buf(data)));
}
/** AES-CBC without padding: `data` must be a whole number of blocks. */
export async function aesEncryptRaw(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length % 16) throw new Error('AES block data must be a multiple of 16 bytes.');
  // WebCrypto always pads; in CBC the padding is a final extra block, so dropping it leaves the unpadded result.
  return (await aesEncrypt(key, iv, data)).subarray(0, data.length);
}
/** AES-CBC decryption; `padded` false decrypts whole blocks with no padding to remove. */
export async function aesDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array, padded = true): Promise<Uint8Array> {
  if (!data.length || data.length % 16) throw new Error('Encrypted data is damaged.');
  const k = await importAes(key, 'decrypt');
  if (padded) return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: buf(iv) }, k, buf(data)));
  // Append a block that decrypts to a full block of padding, so WebCrypto's padding check passes and removes it.
  const last = data.subarray(data.length - 16);
  const pad = await aesEncryptRaw(key, last, new Uint8Array(16).fill(16));
  const joined = new Uint8Array(data.length + 16); joined.set(data); joined.set(pad, data.length);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: buf(iv) }, k, buf(joined)));
}

const digest = async (alg: 'SHA-256' | 'SHA-384' | 'SHA-512', data: Uint8Array) => new Uint8Array(await subtle().digest(alg, buf(data)));
export const randomBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// ---- Revision 6 (AES-256) password hash: Algorithm 2.B ---------------------------------------------------

/** A password as revision 5/6 reads it: UTF-8, at most 127 bytes. */
export const passwordR6 = (password: string) => new TextEncoder().encode(password.normalize('NFKC')).subarray(0, 127);

export async function hashR6(password: Uint8Array, salt: Uint8Array, userKey: Uint8Array = new Uint8Array()): Promise<Uint8Array> {
  let k = await digest('SHA-256', concat(password, salt, userKey));
  for (let round = 0; ; round++) {
    const block = concat(password, k, userKey);
    const k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);
    const e = await aesEncryptRaw(k.subarray(0, 16), k.subarray(16, 32), k1);
    let sum = 0; for (let i = 0; i < 16; i++) sum += e[i];
    k = await digest(sum % 3 === 0 ? 'SHA-256' : sum % 3 === 1 ? 'SHA-384' : 'SHA-512', e);
    // Stop after at least 64 rounds once E's last byte is at most (rounds done − 32); `round` counts from 0.
    if (round >= 63 && e[e.length - 1] <= round + 1 - 32) break;
  }
  return k.subarray(0, 32);
}

// ---- Revisions 2–4 (RC4 / AES-128): Algorithms 2–7 ---------------------------------------------------------

const PAD = Uint8Array.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
/** A password padded to 32 bytes (Latin-1, as revisions 2–4 read it). */
export function padPassword(password: string): Uint8Array {
  const bytes = Uint8Array.from([...password].slice(0, 32).map((c) => c.charCodeAt(0) & 255));
  return concat(bytes, PAD).subarray(0, 32);
}

export interface LegacyParams { r: number; o: Uint8Array; u: Uint8Array; p: number; id0: Uint8Array; lengthBytes: number; encryptMetadata: boolean }

/** Algorithm 2: the file key from a (user) password. */
export function legacyFileKey(password: Uint8Array, q: LegacyParams): Uint8Array {
  const p = new Uint8Array(4); new DataView(p.buffer).setInt32(0, q.p, true);
  let h = md5(concat(password, q.o.subarray(0, 32), p, q.id0, q.r >= 4 && !q.encryptMetadata ? Uint8Array.from([255, 255, 255, 255]) : new Uint8Array()));
  const n = q.r === 2 ? 5 : q.lengthBytes;
  if (q.r >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n));
  return h.subarray(0, n);
}

/** Algorithms 4/5: the U value a file key produces, compared on 32 bytes (R2) or the first 16 (R3+). */
export function legacyUserCheck(fileKey: Uint8Array, q: LegacyParams): boolean {
  if (q.r === 2) return rc4(fileKey, PAD).every((b, i) => b === q.u[i]);
  let x = rc4(fileKey, md5(concat(PAD, q.id0)));
  for (let i = 1; i <= 19; i++) x = rc4(fileKey.map((b) => b ^ i), x);
  return x.every((b, i) => b === q.u[i]);
}

/** Algorithm 7: the user password hidden in O, recovered with the owner password. */
export function legacyUserPasswordFromOwner(owner: string, q: LegacyParams): Uint8Array {
  let h = md5(padPassword(owner));
  if (q.r >= 3) for (let i = 0; i < 50; i++) h = md5(h);
  const key = h.subarray(0, q.r === 2 ? 5 : q.lengthBytes);
  if (q.r === 2) return rc4(key, q.o.subarray(0, 32));
  let x = q.o.subarray(0, 32);
  for (let i = 19; i >= 0; i--) x = rc4(key.map((b) => b ^ i), x);
  return x;
}

/** Algorithm 1: the key for one object (revisions 2–4); `aes` adds the "sAlT" suffix for AESV2. */
export function legacyObjectKey(fileKey: Uint8Array, objectNumber: number, generation: number, aes: boolean): Uint8Array {
  const id = Uint8Array.from([objectNumber & 255, (objectNumber >> 8) & 255, (objectNumber >> 16) & 255, generation & 255, (generation >> 8) & 255]);
  const h = md5(concat(fileKey, id, aes ? Uint8Array.from([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array()));
  return h.subarray(0, Math.min(fileKey.length + 5, 16));
}
