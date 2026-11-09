/**
 * PKCS#12 (.p12 / .pfx) signing identities: the integrity MAC is checked, password-protected parts are decrypted
 * (PBES2 with PBKDF2 and AES, as current OpenSSL, Windows and macOS export them) and the private key is imported
 * into WebCrypto as non-extractable. Legacy RC2 / triple-DES files are refused with advice to re-export.
 */
import { OID, child, concatBytes, equalBytes, intValue, oidToString, parseDer, tagged, type Der } from './asn1';
import { parseCertificate, type Certificate } from './x509';

export interface SigningIdentity { key: CryptoKey; keyType: 'RSA' | 'EC'; certificate: Certificate; chain: Certificate[] }

const subtle = () => { const s = globalThis.crypto?.subtle; if (!s) throw new Error('This environment has no Web Crypto, which signing needs.'); return s; };
const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;
const HMAC: Record<string, string> = { [OID.hmacSha1]: 'SHA-1', [OID.hmacSha256]: 'SHA-256', [OID.hmacSha384]: 'SHA-384', [OID.hmacSha512]: 'SHA-512' };
const DIGEST: Record<string, string> = { [OID.sha1]: 'SHA-1', [OID.sha256]: 'SHA-256', [OID.sha384]: 'SHA-384', [OID.sha512]: 'SHA-512' };
const BLOCK: Record<string, number> = { 'SHA-1': 64, 'SHA-256': 64, 'SHA-384': 128, 'SHA-512': 128 };
const LEN: Record<string, number> = { 'SHA-1': 20, 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64 };

export class Pkcs12PasswordError extends Error { constructor() { super('The password for this signing certificate file is not correct.'); this.name = 'Pkcs12PasswordError'; } }

/** RFC 7292 appendix B key derivation (used for the MAC key). */
async function pkcs12Kdf(hash: string, password: Uint8Array, salt: Uint8Array, id: number, iterations: number, size: number): Promise<Uint8Array> {
  const v = BLOCK[hash], u = LEN[hash];
  const fill = (src: Uint8Array) => { if (!src.length) return new Uint8Array(); const out = new Uint8Array(v * Math.ceil(src.length / v)); for (let i = 0; i < out.length; i++) out[i] = src[i % src.length]; return out; };
  const I = concatBytes(fill(salt), fill(password));
  const D = new Uint8Array(v).fill(id);
  const out = new Uint8Array(size);
  for (let produced = 0; produced < size; produced += u) {
    let A = new Uint8Array(await subtle().digest(hash, buf(concatBytes(D, I))));
    for (let r = 1; r < iterations; r++) A = new Uint8Array(await subtle().digest(hash, buf(A)));
    out.set(A.subarray(0, Math.min(u, size - produced)), produced);
    const B = new Uint8Array(v); for (let i = 0; i < v; i++) B[i] = A[i % u];
    for (let j = 0; j < I.length; j += v) { let carry = 1; for (let k = v - 1; k >= 0; k--) { const sum = I[j + k] + B[k] + carry; I[j + k] = sum & 0xff; carry = sum >> 8; } }
  }
  return out;
}
const bmpPassword = (password: string) => { const out = new Uint8Array((password.length + 1) * 2); for (let i = 0; i < password.length; i++) { out[2 * i] = password.charCodeAt(i) >> 8; out[2 * i + 1] = password.charCodeAt(i) & 0xff; } return out; };

/** PBES2 (PBKDF2 + AES-CBC) decryption; the password is used as UTF-8, as OpenSSL does for PBES2. */
async function pbes2Decrypt(algorithm: Der, data: Uint8Array, password: string): Promise<Uint8Array> {
  const scheme = oidToString(child(algorithm, 0));
  if (scheme !== OID.pbes2) throw new Error('This certificate file uses old RC2 or triple-DES encryption. Export it again with AES-256 (for example: openssl pkcs12 -export, or “AES256-SHA256” in Windows), then try again.');
  const params = child(algorithm, 1);
  const kdf = child(params, 0); const enc = child(params, 1);
  if (oidToString(child(kdf, 0)) !== OID.pbkdf2) throw new Error('Only PBKDF2 key derivation is supported in certificate files.');
  const kp = child(kdf, 1);
  const salt = child(kp, 0).value; const iterations = intValue(child(kp, 1));
  const prfNode = kp.children.find((c) => c.tag === 0x30);
  const prf = prfNode ? HMAC[oidToString(child(prfNode, 0))] : 'SHA-1';
  const cipher = oidToString(child(enc, 0));
  const keyLength = cipher === OID.aes256cbc ? 32 : cipher === OID.aes192cbc ? 24 : cipher === OID.aes128cbc ? 16 : 0;
  if (!keyLength || !prf) throw new Error('This certificate file uses an encryption WebCrypto cannot open; export it again with AES-256.');
  if (iterations > 10_000_000) throw new Error('This certificate file asks for too many key-derivation rounds.');
  const base = await subtle().importKey('raw', buf(new TextEncoder().encode(password)), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle().deriveKey({ name: 'PBKDF2', salt: buf(salt), iterations, hash: prf }, base, { name: 'AES-CBC', length: keyLength * 8 }, false, ['decrypt']);
  try { return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: buf(child(enc, 1).value) }, key, buf(data))); }
  catch { throw new Pkcs12PasswordError(); }
}

export async function readPkcs12(bytes: Uint8Array, password: string): Promise<SigningIdentity> {
  let pfx: Der;
  try { pfx = parseDer(bytes); } catch { throw new Error('This is not a PKCS#12 (.p12 or .pfx) signing certificate file.'); }
  if (bytes.length > 1024 * 1024) throw new Error('This certificate file is too large.');
  const authSafe = child(pfx, 1);
  if (oidToString(child(authSafe, 0)) !== OID.data) throw new Error('Certificate files protected with public-key integrity are not supported.');
  const content = child(tagged(authSafe, 0)!, 0).value;
  const macData = pfx.children[2];
  if (macData) {
    const digestInfo = child(macData, 0);
    const hash = DIGEST[oidToString(child(child(digestInfo, 0), 0))];
    if (!hash) throw new Error('This certificate file uses an unsupported integrity check.');
    const salt = child(macData, 1).value; const iterations = macData.children[2] ? intValue(macData.children[2]) : 1;
    if (iterations > 10_000_000) throw new Error('This certificate file asks for too many key-derivation rounds.');
    const macKey = await pkcs12Kdf(hash, bmpPassword(password), salt, 3, iterations, LEN[hash]);
    const key = await subtle().importKey('raw', buf(macKey), { name: 'HMAC', hash }, false, ['sign']);
    const mac = new Uint8Array(await subtle().sign('HMAC', key, buf(content)));
    if (!equalBytes(mac, child(digestInfo, 1).value)) throw new Pkcs12PasswordError();
  }
  const keys: { pkcs8: Uint8Array; id?: Uint8Array }[] = []; const certs: { cert: Certificate; id?: Uint8Array }[] = [];
  const bags = async (safeContents: Uint8Array) => {
    for (const bag of parseDer(safeContents).children) {
      const type = oidToString(child(bag, 0)); const value = child(tagged(bag, 0)!, 0);
      const id = bag.children[2]?.children.find((a) => oidToString(child(a, 0)) === OID.localKeyId)?.children[1]?.children[0]?.value;
      if (type === OID.shroudedKeyBag) keys.push({ pkcs8: await pbes2Decrypt(child(value, 0), child(value, 1).value, password), id });
      else if (type === OID.keyBag) keys.push({ pkcs8: value.bytes, id });
      else if (type === OID.certBag && oidToString(child(value, 0)) === OID.x509Certificate) certs.push({ cert: parseCertificate(child(tagged(value, 0)!, 0).value), id });
    }
  };
  for (const info of parseDer(content).children) {
    const type = oidToString(child(info, 0)); const body = child(tagged(info, 0)!, 0);
    if (type === OID.data) await bags(body.value);
    else if (type === OID.encryptedData) {
      const eci = child(body, 1); const encrypted = tagged(eci, 0);
      if (encrypted) await bags(await pbes2Decrypt(child(eci, 1), encrypted.value, password));
    }
  }
  if (keys.length !== 1) throw new Error(keys.length ? 'This certificate file holds several private keys; export just the signing one.' : 'This certificate file has no private key, so it cannot sign.');
  const signer = certs.find((c) => c.id && keys[0].id && equalBytes(c.id, keys[0].id))?.cert ?? certs.find((c) => !c.cert.isCA)?.cert;
  if (!signer) throw new Error('This certificate file has no certificate for its private key.');
  const keyInfo = parseDer(keys[0].pkcs8);
  const algorithm = child(keyInfo, 1);
  const keyOid = oidToString(child(algorithm, 0));
  let key: CryptoKey; let keyType: 'RSA' | 'EC';
  if (keyOid === OID.rsaEncryption) { keyType = 'RSA'; key = await subtle().importKey('pkcs8', buf(keys[0].pkcs8), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); }
  else if (keyOid === OID.ecPublicKey) {
    keyType = 'EC';
    const curve = oidToString(child(algorithm, 1));
    const namedCurve = curve === OID.p256 ? 'P-256' : curve === OID.p384 ? 'P-384' : curve === OID.p521 ? 'P-521' : '';
    if (!namedCurve) throw new Error('Only P-256, P-384 and P-521 elliptic-curve keys are supported.');
    key = await subtle().importKey('pkcs8', buf(keys[0].pkcs8), { name: 'ECDSA', namedCurve }, false, ['sign']);
  } else throw new Error('Only RSA and elliptic-curve signing keys are supported.');
  return { key, keyType, certificate: signer, chain: certs.map((c) => c.cert).filter((c) => c !== signer) };
}
