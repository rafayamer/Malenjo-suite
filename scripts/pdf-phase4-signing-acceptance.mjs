/* Phase 4 digital-signature acceptance (MAL-065) in real Chromium: certificate-based signing at PAdES B-LTA with a
 * trusted timestamp, revocation data and an archive timestamp, then signature validation in the app.
 * A local timestamp authority (OpenSSL `ts -reply`) and CRL server stand in for real ones. The signed output is
 * validated independently by OpenSSL (`cms -verify`) and pyHanko (`sign adesverify`, PAdES/AdES validation).
 * Run: node scripts/pdf-phase4-signing-acceptance.mjs   (needs `playwright`, `openssl` and `pyhanko` on PATH)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { root, startHarness } from './lib/pdf-harness.mjs';

const PKI = resolve(root, 'testing/suite/fixtures/signatures/pki');
const work = mkdtempSync(join(tmpdir(), 'malenjo-signing-'));
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

const h = await startHarness('PHASE4-SIGNING');
const { page, panel, expect, check, action, notice, openPdf, download } = h;
const tabFor = (name) => page.locator('.document-tab-main').filter({ hasText: name });
const canvasBox = () => panel().locator('[id$="-page-1"] canvas').first().boundingBox();

try {
  await check('MAL-065 certificate-based signing with a trusted timestamp at PAdES B-LTA, validated independently and in the app', async () => {
    execFileSync('pyhanko', ['--version'], { stdio: 'pipe' }); // independent validator required
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]).drawText('Service agreement', { x: 72, y: 720, size: 18, font: await pdf.embedFont(StandardFonts.Helvetica) });
    await openPdf(await pdf.save(), 'agreement.pdf');
    await action('Protect', 'Digital signatures…');
    const d = page.getByRole('dialog', { name: 'Digital signatures' });
    await d.locator('input[type="file"][accept^=".p12"]').setInputFiles(join(PKI, 'signer.p12'));
    await d.getByLabel('Certificate password').fill('wrong');
    await d.getByRole('button', { name: 'Open certificate' }).click();
    await d.getByRole('alert').getByText('The password for this signing certificate file is not correct.').waitFor();
    await d.getByLabel('Certificate password').fill('test-pass');
    await d.getByRole('button', { name: 'Open certificate' }).click();
    await d.getByText(/^Signing as Dana Signer, issued by MALENJO Test Root CA, valid until \d{4}-\d\d-\d\d\.$/).waitFor();
    await d.getByLabel('PAdES profile').selectOption('B-LTA');
    await d.getByLabel('Timestamp authority (RFC 3161)').fill('http://127.0.0.1:47811/tsa');
    await d.getByLabel('Reason', { exact: true }).fill('I approve this agreement');
    await d.getByLabel('Location', { exact: true }).fill('Lahore');
    await d.getByLabel('Show a signature box on the page').check();
    await d.getByRole('button', { name: 'Draw the signature box' }).click();
    const b = await canvasBox();
    await page.mouse.move(b.x + 0.06 * b.width, b.y + 0.12 * b.height); await page.mouse.down();
    for (let t = 1; t <= 8; t++) await page.mouse.move(b.x + (0.06 + 0.2 * t / 8) * b.width, b.y + (0.12 + 0.06 * t / 8) * b.height);
    await page.mouse.up();
    await d.getByRole('button', { name: 'Box on page 1 — draw again' }).waitFor();
    const signed = await download(() => d.getByRole('button', { name: 'Sign and save a copy' }).click());
    await notice(/Signed by Dana Signer at PAdES B-LTA; saved agreement-signed\.pdf and opened it in a new tab\./);
    expect(requests.filter((r) => r === 'POST /tsa').length === 2 && requests.includes('GET /ca.crl'), 'TSA and CRL requests ' + requests.join(', '));
    // Independent validation.
    const file = join(work, 'signed.pdf'); writeFileSync(file, signed);
    const report = execFileSync('pyhanko', ['sign', 'adesverify', '--trust', join(PKI, 'ca.pem'), '--trust-replace', '--pretty-print', file], { encoding: 'utf8', stdio: 'pipe' });
    for (const line of ['The signature is judged VALID.', "The signer's certificate is trusted.", 'The timestamp token is cryptographically sound.', 'The TSA certificate is trusted.', 'All modifications relate to signature maintenance'])
      expect(report.includes(line), `pyHanko: missing "${line}"\n${report}`);
    const text = signed.toString('latin1');
    const [, a, bb, c] = /\/ByteRange \[0 (\d+) (\d+) (\d+)\s*\]/.exec(text).map(Number);
    writeFileSync(join(work, 'sig.der'), Buffer.from(text.slice(a + 1, bb - 1).replace(/(00)+$/, ''), 'hex'));
    writeFileSync(join(work, 'content'), Buffer.concat([signed.subarray(0, a), signed.subarray(bb, bb + c)]));
    execFileSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', join(work, 'sig.der'), '-content', join(work, 'content'), '-CAfile', join(PKI, 'ca.pem'), '-purpose', 'any', '-out', '/dev/null'], { stdio: 'pipe' });
    // Validation in the app, on the signed copy that opened in its own tab.
    await tabFor('agreement-signed.pdf').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.document-session-panel.active .pdf-workspace')?.getAttribute('data-pdf-first-rendered') === 'true', null, { timeout: 60000 });
    await d.getByRole('button', { name: 'Close digital signatures' }).click().catch(() => {});
    await action('Protect', 'Digital signatures…');
    const v = page.getByRole('dialog', { name: 'Digital signatures' });
    await v.locator('input[type="file"][accept^=".cer"]').setInputFiles(join(PKI, 'ca.pem'));
    await v.getByRole('list', { name: 'Trusted certificates' }).getByText(/MALENJO Test Root CA/).waitFor();
    await v.getByRole('button', { name: 'Check signatures' }).click();
    const sig = v.getByRole('region', { name: 'Signature Signature1' });
    await sig.getByText('Signature1: Valid').waitFor();
    for (const line of ['Level: PAdES B-LTA', 'Document integrity: unchanged since signing', 'Certificate: trusted', 'Revocation: checked from embedded data, not revoked', 'Reason: I approve this agreement'])
      await sig.getByText(line, { exact: true }).waitFor();
    await sig.getByText(/\(trusted timestamp\)$/).waitFor();
    await v.getByRole('region', { name: 'Signature DocumentTimestamp1' }).getByText('DocumentTimestamp1: Valid').waitFor();
    // A copy altered inside the signed bytes is reported as invalid.
    const tampered = Buffer.from(signed); const at = tampered.indexOf('stream\n') + 'stream\n'.length + 4; expect(at > 20 && at < a, 'no stream to alter'); tampered[at] ^= 0x01; // inside the first signed stream
    await openPdf(tampered, 'agreement-altered.pdf');
    await action('Protect', 'Digital signatures…');
    const t = page.getByRole('dialog', { name: 'Digital signatures' });
    await t.getByRole('button', { name: 'Check signatures' }).click();
    await t.getByRole('region', { name: 'Signature Signature1' }).getByText('Signature1: Invalid').waitFor();
    await t.getByText('The signed bytes do not match the signature (the document was altered).').waitFor();
  });
} finally {
  await h.finish();
  server.close();
}
