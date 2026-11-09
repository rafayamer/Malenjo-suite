/** Test-only helpers for MAL-065: an OpenSSL-backed timestamp authority and independent validators. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Transport } from '../../src/suite/pdf/signing/cms';

export const PKI = resolve(__dirname, 'fixtures/signatures/pki');
export const pki = (name: string) => new Uint8Array(readFileSync(join(PKI, name)));

/** Answers timestamp requests with `openssl ts -reply` and serves the CA's CRL, like a TSA and a CRL server would. */
export function opensslTransport(log: string[] = []): Transport {
  const dir = mkdtempSync(join(tmpdir(), 'malenjo-tsa-'));
  writeFileSync(join(dir, 'serial'), '01\n');
  writeFileSync(join(dir, 'tsa.cnf'), `[tsa]\ndefault_tsa = t\n[t]\ndir = ${dir}\nserial = ${dir}/serial\ncrypto_device = builtin\nsigner_cert = ${PKI}/tsa.pem\ncerts = ${PKI}/ca.pem\nsigner_key = ${PKI}/tsa.key\nsigner_digest = sha256\ndefault_policy = 1.2.3.4.1\ndigests = sha256, sha384, sha512\naccuracy = secs:1\nordering = yes\ntsa_name = no\ness_cert_id_chain = no\ness_cert_id_alg = sha256\n`);
  return async ({ method, url, body }) => {
    log.push(`${method} ${url}`);
    if (method === 'GET' && url.endsWith('/ca.crl')) return pki('ca.crl');
    if (method === 'POST' && url.endsWith('/tsa')) {
      writeFileSync(join(dir, 'q.tsq'), body!);
      execFileSync('openssl', ['ts', '-reply', '-config', join(dir, 'tsa.cnf'), '-queryfile', join(dir, 'q.tsq'), '-out', join(dir, 'r.tsr')], { stdio: 'pipe' });
      return new Uint8Array(readFileSync(join(dir, 'r.tsr')));
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
}

/**
 * pyHanko's AdES validation (`pyhanko sign adesverify`, an independent PAdES implementation), or null when pyHanko is
 * not installed. B-LT and B-LTA must validate from the file's own revocation data: nothing serves the CRL here.
 */
export function pyhankoValidate(bytes: Uint8Array, level: string): string | null {
  try { execFileSync('pyhanko', ['--version'], { stdio: 'pipe' }); } catch { return null; }
  const dir = mkdtempSync(join(tmpdir(), 'malenjo-pyhanko-'));
  writeFileSync(join(dir, 'in.pdf'), bytes);
  const args = ['sign', 'adesverify', '--trust', join(PKI, 'ca.pem'), '--trust-replace', '--pretty-print', ...(level === 'B-B' || level === 'B-T' ? ['--no-revocation-check'] : []), join(dir, 'in.pdf')];
  try { return execFileSync('pyhanko', args, { stdio: 'pipe', encoding: 'utf8' }); }
  catch (error) { const e = error as { stdout?: string; stderr?: string }; return `FAILED\n${e.stdout ?? ''}\n${e.stderr ?? ''}`; }
}

/** `openssl cms -verify` over the signature's byte range. */
export function opensslVerify(bytes: Uint8Array, signatureIndex = 0): string {
  const text = new TextDecoder('latin1').decode(bytes);
  const ranges = [...text.matchAll(/\/ByteRange \[0 (\d+) (\d+) (\d+)\s*\]/g)];
  const [a, b, c] = ranges[signatureIndex].slice(1).map(Number);
  const dir = mkdtempSync(join(tmpdir(), 'malenjo-cms-'));
  const hex = text.slice(a + 1, b - 1).replace(/(00)+$/, '');
  writeFileSync(join(dir, 'sig.der'), Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex'));
  writeFileSync(join(dir, 'data'), Buffer.concat([Buffer.from(bytes.subarray(0, a)), Buffer.from(bytes.subarray(b, b + c))]));
  try { execFileSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', join(dir, 'sig.der'), '-content', join(dir, 'data'), '-CAfile', join(PKI, 'ca.pem'), '-purpose', 'any', '-out', '/dev/null'], { stdio: 'pipe' }); return 'OK'; }
  catch (error) { return String((error as { stderr?: Buffer }).stderr ?? error); }
}
