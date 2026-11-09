/** X.509 certificates: parsing, public keys for WebCrypto, signature checks and chain building. */
import { OID, child, equalBytes, intBytes, oidToString, parseDer, parseInner, stringValue, tagged, timeValue, type Der } from './asn1';

export interface Certificate {
  der: Uint8Array; tbs: Uint8Array; serial: Uint8Array; issuer: Der; subject: Der;
  issuerName: string; subjectName: string; notBefore: Date; notAfter: Date;
  spki: Der; keyType: 'RSA' | 'EC'; curve?: string; sigAlg: string; sigParams?: Der; signature: Uint8Array;
  isCA: boolean; keyUsage: number; extKeyUsage: string[]; crlUrls: string[]; ocspUrls: string[];
}

const subtle = () => { const s = globalThis.crypto?.subtle; if (!s) throw new Error('This environment has no Web Crypto, which signing needs.'); return s; };
const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;

export function nameToString(name: Der): string {
  const parts: string[] = [];
  for (const rdn of name.children) for (const atv of rdn.children) {
    const type = oidToString(child(atv, 0));
    const label = type === OID.commonName ? 'CN' : type === OID.organization ? 'O' : type === '2.5.4.6' ? 'C' : type === '2.5.4.11' ? 'OU' : type === '1.2.840.113549.1.9.1' ? 'E' : null;
    if (label) parts.push(`${label}=${stringValue(child(atv, 1))}`);
  }
  return parts.join(', ');
}
export const commonName = (c: Certificate) => /CN=([^,]+)/.exec(c.subjectName)?.[1] ?? c.subjectName;

export function parseCertificate(der: Uint8Array): Certificate {
  const root = parseDer(der);
  const tbs = child(root, 0);
  const hasVersion = tbs.children[0].tag === 0xa0;
  const at = (i: number) => child(tbs, i + (hasVersion ? 1 : 0));
  const validity = at(3);
  const spki = at(5);
  const keyAlg = oidToString(child(child(spki, 0), 0));
  const cert: Certificate = {
    der: root.bytes, tbs: tbs.bytes, serial: intBytes(at(0)), issuer: at(2), subject: at(4), issuerName: nameToString(at(2)), subjectName: nameToString(at(4)),
    notBefore: timeValue(child(validity, 0)), notAfter: timeValue(child(validity, 1)), spki,
    keyType: keyAlg === OID.rsaEncryption || keyAlg === OID.rsassaPss ? 'RSA' : 'EC', curve: keyAlg === OID.ecPublicKey ? oidToString(child(child(spki, 0), 1)) : undefined,
    sigAlg: oidToString(child(child(root, 1), 0)), sigParams: child(root, 1).children[1], signature: child(root, 2).value.subarray(1),
    isCA: false, keyUsage: 0, extKeyUsage: [], crlUrls: [], ocspUrls: [],
  };
  if (keyAlg !== OID.rsaEncryption && keyAlg !== OID.ecPublicKey && keyAlg !== OID.rsassaPss) throw new Error('Only RSA and elliptic-curve certificates are supported.');
  const extensions = tagged(tbs, 3)?.children[0]?.children ?? [];
  for (const ext of extensions) {
    const id = oidToString(child(ext, 0));
    const value = parseInner(ext.children[ext.children.length - 1]);
    if (id === OID.basicConstraints) cert.isCA = value.children[0]?.tag === 0x01 && value.children[0].value[0] !== 0;
    else if (id === OID.keyUsage) { const bits = value.value; cert.keyUsage = (bits[1] ?? 0) << 8 | (bits[2] ?? 0); }
    else if (id === OID.extKeyUsage) cert.extKeyUsage = value.children.map(oidToString);
    else if (id === OID.crlDistributionPoints) {
      for (const point of value.children) for (const uri of collect(point, 0x86)) cert.crlUrls.push(new TextDecoder().decode(uri.value));
    } else if (id === OID.authorityInfoAccess) {
      for (const access of value.children) if (oidToString(child(access, 0)) === OID.ocsp && access.children[1]?.tag === 0x86) cert.ocspUrls.push(new TextDecoder().decode(access.children[1].value));
    }
  }
  return cert;
}
function collect(node: Der, tag: number): Der[] { return node.tag === tag ? [node] : node.children.flatMap((c) => collect(c, tag)); }

/** Key usage bit numbers as in RFC 5280 (digitalSignature = 0, nonRepudiation = 1, keyCertSign = 5). */
export const hasKeyUsage = (c: Certificate, bit: number) => c.keyUsage === 0 || ((c.keyUsage >> (15 - bit)) & 1) === 1;

export function pemToDer(text: string): Uint8Array[] {
  const blocks = [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)];
  return blocks.map((m) => Uint8Array.from(atob(m[1].replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
}
/** Certificates from a .cer/.crt/.pem file (DER or PEM). */
export function readCertificateFile(bytes: Uint8Array): Certificate[] {
  const text = new TextDecoder('latin1').decode(bytes);
  const ders = text.includes('-----BEGIN CERTIFICATE-----') ? pemToDer(text) : [bytes];
  return ders.map(parseCertificate);
}

const HASH: Record<string, string> = {
  [OID.sha256WithRSA]: 'SHA-256', [OID.sha384WithRSA]: 'SHA-384', [OID.sha512WithRSA]: 'SHA-512', [OID.sha1WithRSA]: 'SHA-1',
  [OID.ecdsaSha256]: 'SHA-256', [OID.ecdsaSha384]: 'SHA-384', [OID.ecdsaSha512]: 'SHA-512',
};
const CURVES: Record<string, string> = { [OID.p256]: 'P-256', [OID.p384]: 'P-384', [OID.p521]: 'P-521' };

/** ECDSA signatures are DER (r, s) in CMS and X.509; WebCrypto wants r || s. */
export function ecdsaDerToRaw(der: Uint8Array, size: number): Uint8Array {
  const node = parseDer(der);
  const part = (d: Der) => { const v = intBytes(d); const out = new Uint8Array(size); out.set(v.subarray(Math.max(0, v.length - size)), Math.max(0, size - v.length)); return out; };
  const raw = new Uint8Array(size * 2); raw.set(part(child(node, 0))); raw.set(part(child(node, 1)), size); return raw;
}
const curveSize = (curve?: string) => (curve === OID.p384 ? 48 : curve === OID.p521 ? 66 : 32);

/** Verifies `signature` over `data` with the certificate's key, for the given signature algorithm (OID). */
export async function verifyWith(cert: Certificate, sigAlg: string, signature: Uint8Array, data: Uint8Array, digestAlg?: string): Promise<boolean> {
  try {
    if (cert.keyType === 'RSA') {
      const hash = HASH[sigAlg] ?? (digestAlg ? DIGEST_NAMES[digestAlg] : undefined);
      if (sigAlg === OID.rsassaPss) {
        const key = await subtle().importKey('spki', buf(cert.spki.bytes), { name: 'RSA-PSS', hash: hash ?? 'SHA-256' }, false, ['verify']);
        return await subtle().verify({ name: 'RSA-PSS', saltLength: (hash === 'SHA-512' ? 64 : hash === 'SHA-384' ? 48 : 32) }, key, buf(signature), buf(data));
      }
      if (!hash) return false;
      const key = await subtle().importKey('spki', buf(cert.spki.bytes), { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
      return await subtle().verify('RSASSA-PKCS1-v1_5', key, buf(signature), buf(data));
    }
    const hash = HASH[sigAlg] ?? (digestAlg ? DIGEST_NAMES[digestAlg] : undefined);
    const namedCurve = CURVES[cert.curve ?? ''];
    if (!hash || !namedCurve) return false;
    const key = await subtle().importKey('spki', buf(cert.spki.bytes), { name: 'ECDSA', namedCurve }, false, ['verify']);
    return await subtle().verify({ name: 'ECDSA', hash }, key, buf(ecdsaDerToRaw(signature, curveSize(cert.curve))), buf(data));
  } catch { return false; }
}
export const DIGEST_NAMES: Record<string, string> = { [OID.sha256]: 'SHA-256', [OID.sha384]: 'SHA-384', [OID.sha512]: 'SHA-512', [OID.sha1]: 'SHA-1' };

export const issuedBy = (cert: Certificate, issuer: Certificate) => equalBytes(cert.issuer.bytes, issuer.subject.bytes);
export const selfIssued = (cert: Certificate) => equalBytes(cert.issuer.bytes, cert.subject.bytes);

export interface ChainResult { chain: Certificate[]; trusted: boolean; problems: string[] }
/** Builds the chain from `leaf` through `pool` to one of `anchors`, checking every signature and validity at `when`. */
export async function buildChain(leaf: Certificate, pool: Certificate[], anchors: Certificate[], when: Date): Promise<ChainResult> {
  const chain = [leaf]; const problems: string[] = [];
  let current = leaf;
  for (let depth = 0; depth < 10; depth++) {
    if (when < current.notBefore || when > current.notAfter) problems.push(`${commonName(current)} was not valid on ${when.toISOString().slice(0, 10)} (valid ${current.notBefore.toISOString().slice(0, 10)} to ${current.notAfter.toISOString().slice(0, 10)}).`);
    const anchor = anchors.find((a) => equalBytes(a.der, current.der));
    if (anchor) return { chain, trusted: problems.length === 0, problems };
    const issuer = [...anchors, ...pool].find((c) => issuedBy(current, c) && !equalBytes(c.der, current.der));
    if (!issuer) {
      problems.push(selfIssued(current) ? `${commonName(current)} is self-signed and not in your trusted certificates.` : `The issuer of ${commonName(current)} (${current.issuerName}) was not found.`);
      return { chain, trusted: false, problems };
    }
    if (!(await verifyWith(issuer, current.sigAlg, current.signature, current.tbs))) { problems.push(`The signature on ${commonName(current)} by ${commonName(issuer)} does not verify.`); return { chain, trusted: false, problems }; }
    if (!issuer.isCA || !hasKeyUsage(issuer, 5)) problems.push(`${commonName(issuer)} is not allowed to issue certificates.`);
    chain.push(issuer); current = issuer;
  }
  problems.push('The certificate chain is too long.');
  return { chain, trusted: false, problems };
}
