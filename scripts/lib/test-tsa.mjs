/* A local RFC 3161 timestamp authority (OpenSSL `ts -reply`) and CRL server for signing acceptance, on 127.0.0.1:47811.
 * Uses the synthetic test PKI in testing/suite/fixtures/signatures/pki. Answers CORS preflights so the browser app can call it. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { root } from './pdf-harness.mjs';

export const PKI = resolve(root, 'testing/suite/fixtures/signatures/pki');
export async function startTestTsa() {
  const work = mkdtempSync(join(tmpdir(), 'malenjo-tsa-'));
  writeFileSync(join(work, 'serial'), '01\n');
  writeFileSync(join(work, 'tsa.cnf'), `[tsa]\ndefault_tsa = t\n[t]\ndir = ${work}\nserial = ${work}/serial\ncrypto_device = builtin\nsigner_cert = ${PKI}/tsa.pem\ncerts = ${PKI}/ca.pem\nsigner_key = ${PKI}/tsa.key\nsigner_digest = sha256\ndefault_policy = 1.2.3.4.1\ndigests = sha256, sha384, sha512\naccuracy = secs:1\nordering = yes\ntsa_name = no\ness_cert_id_chain = no\ness_cert_id_alg = sha256\n`);
  const requests = [];
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push(`${req.method} ${req.url}`);
      try {
        if (req.method === 'GET' && req.url === '/ca.crl') { res.writeHead(200, { 'Content-Type': 'application/pkix-crl' }).end(readFileSync(join(PKI, 'ca.crl'))); return; }
        if (req.method === 'POST' && req.url === '/tsa') {
          writeFileSync(join(work, 'q.tsq'), Buffer.concat(chunks));
          execFileSync('openssl', ['ts', '-reply', '-config', join(work, 'tsa.cnf'), '-queryfile', join(work, 'q.tsq'), '-out', join(work, 'r.tsr')], { stdio: 'pipe' });
          res.writeHead(200, { 'Content-Type': 'application/timestamp-reply' }).end(readFileSync(join(work, 'r.tsr'))); return;
        }
        res.writeHead(404).end();
      } catch (error) { res.writeHead(500).end(String(error)); }
    });
  });
  await new Promise((ok) => server.listen(47811, '127.0.0.1', ok));
  return { url: 'http://127.0.0.1:47811/tsa', requests, work, close: () => server.close() };
}
/** pyHanko's AdES validation of every signature in `bytes` (throws when pyHanko is missing or a signature fails). */
export function pyhankoAdes(bytes, work) {
  const file = join(work, `validate-${Date.now()}.pdf`); writeFileSync(file, bytes);
  return execFileSync('pyhanko', ['sign', 'adesverify', '--trust', join(PKI, 'ca.pem'), '--trust-replace', '--pretty-print', '--no-revocation-check', file], { encoding: 'utf8', stdio: 'pipe' });
}
