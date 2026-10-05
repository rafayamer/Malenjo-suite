# Phase 6 — Security Center, Metadata Studio and Signing

## Scope

Phase 6 provides local security vertical slices while preserving the MALENJO rule that source documents are never silently destroyed.

## Metadata Studio

Implemented for PDF and OOXML:

- inspect standard metadata;
- edit title/author/subject/keywords;
- sanitize standard PDF metadata fields;
- remove OOXML custom property part;
- rewrite selected OOXML core/application fields;
- export a new copy only.

Metadata Studio does **not** claim that field rewriting removes every hidden object or revision artifact. High-assurance PDF sanitization uses the destructive CDR path.

## Destructive PDF CDR and redaction

Security Center can create a new PDF by:

1. rendering each source page locally with PDF.js;
2. drawing configured normalized redaction rectangles into the raster image;
3. optionally drawing a watermark;
4. embedding only the resulting page images into a brand-new PDF;
5. resetting standard metadata.

This deliberately destroys selectable text, embedded scripts, attachments, forms and original PDF object structure rather than covering sensitive content with a reversible overlay.

Phase 6 caps CDR at 120 pages per operation. The original PDF is untouched.

## Watermark-only operation

A separate pdf-lib operation can add a visible watermark while preserving original PDF content. This is **not** a sanitization operation.

## Encryption operation

Phase 6 secure export uses a MALENJO envelope:

- AES-256-GCM;
- password-derived key using PBKDF2-SHA-256;
- 250,000 PBKDF2 iterations;
- random 16-byte salt;
- random 12-byte IV.

The exported extension is `.malenjo-secure`.

This is application-level encryption and is intentionally not described as Acrobat-compatible PDF password encryption.

## ClamAV

The desktop adapter executes the optional external `clamscan` program directly:

- no shell string construction;
- source path is resolved from the MALENJO library;
- execution timeout: 45 seconds;
- source document is never removed automatically;
- exit code 0 = clean;
- exit code 1 = infection reported;
- other exits are treated as adapter errors;
- results are written to the MALENJO audit log.

ClamAV is not bundled by Phase 6.

## CDR / malware separation

Malware scanning and CDR are independent controls. A clean antivirus result is not treated as proof that a document has no active or privacy-sensitive content. CDR can be used regardless of ClamAV status.

## pyHanko signing and validation

Phase 6 targets pyHanko 0.37.x / pyhanko-cli 0.5.x as an optional desktop Python environment.

Validation invokes the pyHanko CLI directly with a MALENJO library PDF.

Signing:

- source PDF is resolved from the MALENJO library;
- user explicitly chooses a PKCS#12/PFX identity;
- user explicitly chooses a signed-copy destination;
- passphrase is placed in the native ephemeral `SecurityState`;
- the secret is zeroized when removed/dropped;
- the passphrase is sent to the Python worker over stdin;
- the passphrase is not placed in process arguments;
- the source PDF is never overwritten;
- signing has a 90 second timeout;
- failures remove a partial destination where possible.

The Phase 6 store is intentionally **ephemeral**. MALENJO does not persist private keys or signing passphrases. A future Windows Credential Manager/DPAPI/TPM persistent provider can implement the same native secret-store boundary.

## Trust model

A pyHanko command completing successfully does not by itself mean a signer is universally trusted. Trust anchors, revocation information, policy and offline/online validation configuration affect the result.

## Audit

Native security operations append JSONL audit events under MALENJO application data. The UI shows recent events. Audit records are bounded when displayed but are append-only on disk in this phase.

Audit events do not include signing passphrases or private-key bytes.

## Acceptance checklist

- [x] Metadata inspect/edit/sanitize preview.
- [x] Destructive PDF redaction/CDR export.
- [x] PDF watermark operation.
- [x] AES-GCM encrypted export.
- [x] ClamAV isolated-process adapter.
- [x] CDR design separated from malware scanning.
- [x] pyHanko signing adapter.
- [x] pyHanko validation adapter.
- [x] Native ephemeral zeroizing secret store.
- [x] Audit events.
- [x] Metadata tests.
- [x] Encryption/tamper tests.
- [x] Redaction-bound tests.
- [x] Security corpus documentation.
- [ ] Automated Phase 6 CI.
- [ ] Physical Windows ClamAV + pyHanko integration matrix.
- [ ] Windows persistent secret-store provider.
