# pyHanko adapter

MALENJO Phase 6 uses pyHanko as an optional external signing/validation engine.

Target reviewed version:

- pyHanko 0.37.x
- pyhanko-cli 0.5.x

The repository does not vendor pyHanko or private signing keys.

## Commands

Validation uses the external `pyhanko sign validate` CLI.

Signing uses an isolated Python worker built around:

- `SimpleSigner.load_pkcs12(..., passphrase=...)`
- `IncrementalPdfFileWriter`
- `PdfSignatureMetadata`
- `PdfSigner.sign_pdf`

The PKCS#12 passphrase is supplied over stdin from MALENJO's native ephemeral secret store, not on the command line.

## Security boundary

- source is a canonical MALENJO library PDF;
- PKCS#12 identity must be an explicit regular file;
- destination must be explicit and not a symbolic link;
- no source overwrite;
- bounded execution timeout;
- partial failed output is removed when possible;
- audit event emitted.

pyHanko trust/revocation policy remains separately configurable and must be tested for the target deployment.
