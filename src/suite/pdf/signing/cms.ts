/**
 * CMS SignedData for PDF signatures (CAdES detached, as PAdES requires) and for RFC 3161 timestamp tokens:
 * building a signature with the PAdES signed attributes, and parsing and verifying one.
 */
import {
  OID, bool, child, compareBytes, concatBytes, encode, equalBytes, explicit, integer, intBytes, intValue, nul, octets, oid, oidToString, parseDer, seq, set, tagged, timeValue, type Der,
} from './asn1';
import { DIGEST_NAMES, parseCertificate, verifyWith, type Certificate } from './x509';
import type { SigningIdentity } from './pkcs12';

const subtle = () => { const s = globalThis.crypto?.subtle; if (!s) throw new Error('This environment has no Web Crypto, which signing needs.'); return s; };
const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;
export const sha256 = async (data: Uint8Array) => new Uint8Array(await subtle().digest('SHA-256', buf(data)));
export const digestOf = async (alg: string, data: Uint8Array) => new Uint8Array(await subtle().digest(DIGEST_NAMES[alg] ?? 'SHA-256', buf(data)));
const sha256Alg = () => seq(oid(OID.sha256), nul());
const attribute = (type: string, ...values: Uint8Array[]) => seq(oid(type), set(...values));
const issuerAndSerial = (cert: Certificate) => seq(cert.issuer.bytes, integer(cert.serial));

function rawToDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  return seq(integer(raw.subarray(0, half)), integer(raw.subarray(half)));
}
async function signBytes(identity: SigningIdentity, data: Uint8Array): Promise<{ signature: Uint8Array; algorithm: Uint8Array }> {
  if (identity.keyType === 'RSA') {
    return { signature: new Uint8Array(await subtle().sign('RSASSA-PKCS1-v1_5', identity.key, buf(data))), algorithm: seq(oid(OID.sha256WithRSA), nul()) };
  }
  const raw = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.key, buf(data)));
  return { signature: rawToDer(raw), algorithm: seq(oid(OID.ecdsaSha256)) };
}

export interface CmsOptions { contentType?: string; content?: Uint8Array; extraAttributes?: Uint8Array[]; certificates?: Certificate[] }
/**
 * A detached SignedData over `digest` (SHA-256 of the signed bytes). Signed attributes: content type, message digest
 * and the ESS signing-certificate-v2 reference PAdES requires; no signing-time attribute (PAdES puts the time in /M).
 */
export async function buildSignedData(identity: SigningIdentity, digest: Uint8Array, options: CmsOptions = {}): Promise<{ der: Uint8Array; signature: Uint8Array; addUnsigned(attributes: Uint8Array[]): Uint8Array }> {
  const cert = identity.certificate;
  const certHash = await sha256(cert.der);
  const essCertId = seq(octets(certHash), seq(seq(explicit(4, cert.issuer.bytes)), integer(cert.serial)));
  const contentType = options.contentType ?? OID.data;
  const signedAttrs = set(
    attribute(OID.contentType, oid(contentType)),
    attribute(OID.messageDigest, octets(digest)),
    attribute(OID.signingCertificateV2, seq(seq(essCertId))),
    ...(options.extraAttributes ?? []),
  );
  const { signature, algorithm } = await signBytes(identity, signedAttrs);
  const certificates = [cert, ...(options.certificates ?? identity.chain)];
  const assemble = (unsigned: Uint8Array[]) => {
    const signerInfo = seq(integer(1), issuerAndSerial(cert), sha256Alg(), encode(0xa0, parseDer(signedAttrs).value), algorithm, octets(signature),
      ...(unsigned.length ? [encode(0xa1, ...[...unsigned].sort(compareBytes))] : []));
    const encap = options.content ? seq(oid(contentType), explicit(0, octets(options.content))) : seq(oid(contentType));
    const signedData = seq(integer(options.content ? 3 : 1), set(sha256Alg()), encap, encode(0xa0, ...certificates.map((c) => c.der)), set(signerInfo));
    return seq(oid(OID.signedData), explicit(0, signedData));
  };
  return { der: assemble([]), signature, addUnsigned: assemble };
}
export const timestampAttribute = (token: Uint8Array) => attribute(OID.timeStampToken, token);

// ---- parsing and verification ----

export interface SignerInfo {
  issuer: Uint8Array; serial: Uint8Array; digestAlg: string; signedAttrs?: Der; sigAlg: string; signature: Uint8Array; unsigned: Der[];
  attr(type: string): Der | undefined;
}
export interface SignedData { contentType: string; content?: Uint8Array; certificates: Certificate[]; crls: Uint8Array[]; signers: SignerInfo[] }

export function parseSignedData(der: Uint8Array): SignedData {
  const info = parseDer(der);
  if (oidToString(child(info, 0)) !== OID.signedData) throw new Error('The signature is not CMS signed data.');
  const sd = child(tagged(info, 0)!, 0);
  const encap = child(sd, 2);
  const certs = tagged(sd, 0)?.children ?? [];
  const crls = tagged(sd, 1)?.children ?? [];
  const signerSet = sd.children[sd.children.length - 1];
  const signers = signerSet.children.map((si): SignerInfo => {
    const sid = child(si, 1);
    let i = 3;
    const signedAttrs = si.children[i]?.tag === 0xa0 ? si.children[i++] : undefined;
    const sigAlg = oidToString(child(child(si, i), 0)); const signature = child(si, i + 1).value;
    const unsigned = si.children[i + 2]?.tag === 0xa1 ? si.children[i + 2].children : [];
    return {
      issuer: child(sid, 0).bytes, serial: intBytes(child(sid, 1)), digestAlg: oidToString(child(child(si, 2), 0)), signedAttrs, sigAlg, signature, unsigned,
      attr: (type: string) => signedAttrs?.children.find((a) => oidToString(child(a, 0)) === type)?.children[1]?.children[0],
    };
  });
  const content = tagged(encap, 0)?.children[0]?.value;
  return { contentType: oidToString(child(encap, 0)), content, certificates: certs.filter((c) => c.tag === 0x30).map((c) => parseCertificate(c.bytes)), crls: crls.map((c) => c.bytes), signers };
}

export function signerCertificate(data: SignedData, signer: SignerInfo): Certificate | undefined {
  return data.certificates.find((c) => equalBytes(c.issuer.bytes, signer.issuer) && equalBytes(c.serial, signer.serial));
}
/** Checks the message digest attribute against `digest` and the signature over the signed attributes. */
export async function verifySigner(data: SignedData, signer: SignerInfo, digest: Uint8Array): Promise<{ digestOk: boolean; signatureOk: boolean; certificate?: Certificate }> {
  const certificate = signerCertificate(data, signer);
  if (!signer.signedAttrs || !certificate) return { digestOk: false, signatureOk: false, certificate };
  const md = signer.attr(OID.messageDigest);
  const digestOk = !!md && equalBytes(md.value, digest);
  const toSign = concatBytes(Uint8Array.of(0x31), signer.signedAttrs.bytes.subarray(1));
  const signatureOk = await verifyWith(certificate, signer.sigAlg, signer.signature, toSign, signer.digestAlg);
  return { digestOk, signatureOk, certificate };
}

// ---- RFC 3161 timestamps ----

export type Transport = (request: { method: 'GET' | 'POST'; url: string; body?: Uint8Array; contentType?: string }) => Promise<Uint8Array>;
export const fetchTransport: Transport = async ({ method, url, body, contentType }) => {
  const response = await fetch(url, { method, body: body ? buf(body) : undefined, headers: contentType ? { 'Content-Type': contentType } : undefined });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
};

export interface TimestampInfo { time: Date; imprint: Uint8Array; imprintAlg: string; serial: Uint8Array; nonce?: Uint8Array; tsa?: Certificate; signatureOk: boolean; problems: string[] }

export async function requestTimestamp(url: string, data: Uint8Array, transport: Transport): Promise<Uint8Array> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Enter the timestamp authority address, starting with https:// or http://.');
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(8)); nonce[0] &= 0x7f;
  const request = seq(integer(1), seq(sha256Alg(), octets(await sha256(data))), integer(nonce), bool(true));
  let reply: Uint8Array;
  try { reply = await transport({ method: 'POST', url, body: request, contentType: 'application/timestamp-query' }); }
  catch (error) { throw new Error(`The timestamp authority could not be reached (${error instanceof Error ? error.message : String(error)}).`); }
  let response: Der;
  try { response = parseDer(reply); } catch { throw new Error('The timestamp authority sent something that is not a timestamp response.'); }
  const status = intValue(child(child(response, 0), 0));
  if (status > 1 || !response.children[1]) throw new Error(`The timestamp authority refused the request (status ${status}).`);
  const token = response.children[1].bytes;
  const checked = await verifyTimestampToken(token, data);
  if (!checked.signatureOk || checked.problems.length) throw new Error(`The timestamp authority's reply did not verify: ${checked.problems.join(' ') || 'bad signature.'}`);
  if (!checked.nonce || !equalBytes(checked.nonce, intBytes(parseDer(integer(nonce))))) throw new Error('The timestamp reply does not answer this request (nonce mismatch).');
  return token;
}

/** Verifies a timestamp token against the bytes it should cover (`data`, hashed with the token's algorithm). */
export async function verifyTimestampToken(token: Uint8Array, data: Uint8Array): Promise<TimestampInfo> {
  const sd = parseSignedData(token);
  if (sd.contentType !== OID.tstInfo || !sd.content) throw new Error('This is not a timestamp token.');
  const tst = parseDer(sd.content);
  const imprint = child(tst, 2);
  const imprintAlg = oidToString(child(child(imprint, 0), 0));
  const info: TimestampInfo = { time: timeValue(child(tst, 4)), imprint: child(imprint, 1).value, imprintAlg, serial: intBytes(child(tst, 3)), signatureOk: false, problems: [] };
  info.nonce = tst.children.slice(5).find((c) => c.tag === 0x02) ? intBytes(tst.children.slice(5).find((c) => c.tag === 0x02)!) : undefined;
  if (!equalBytes(info.imprint, await digestOf(imprintAlg, data))) info.problems.push('The timestamp is for different data.');
  const signer = sd.signers[0];
  if (!signer) { info.problems.push('The timestamp has no signer.'); return info; }
  const result = await verifySigner(sd, signer, await digestOf(signer.digestAlg, sd.content));
  info.tsa = result.certificate; info.signatureOk = result.digestOk && result.signatureOk;
  if (info.tsa && !info.tsa.extKeyUsage.includes(OID.timeStamping)) info.problems.push('The timestamp certificate is not for timestamping.');
  return info;
}

// ---- certificate revocation lists ----

export interface Crl { der: Uint8Array; issuer: Uint8Array; thisUpdate: Date; nextUpdate?: Date; revoked: { serial: Uint8Array; date: Date }[]; tbs: Uint8Array; sigAlg: string; signature: Uint8Array }
export function parseCrl(der: Uint8Array): Crl {
  const root = parseDer(der); const tbs = child(root, 0);
  let i = tbs.children[0].tag === 0x02 ? 1 : 0;
  i++; // signature algorithm
  const issuer = child(tbs, i++).bytes; const thisUpdate = timeValue(child(tbs, i++));
  const nextUpdate = tbs.children[i] && (tbs.children[i].tag === 0x17 || tbs.children[i].tag === 0x18) ? timeValue(tbs.children[i++]) : undefined;
  const list = tbs.children[i]?.tag === 0x30 ? tbs.children[i].children : [];
  return { der: root.bytes, issuer, thisUpdate, nextUpdate, revoked: list.map((r) => ({ serial: intBytes(child(r, 0)), date: timeValue(child(r, 1)) })), tbs: tbs.bytes,
    sigAlg: oidToString(child(child(root, 1), 0)), signature: child(root, 2).value.subarray(1) };
}
