# Signing validation corpus

Phase 6 signing/validation testing must cover:

- unsigned PDF;
- valid synthetic signed PDF;
- PDF modified after signing;
- corrupted signature container;
- expired/untrusted synthetic certificate;
- encrypted PKCS#12 with wrong passphrase;
- pyHanko unavailable;
- signing worker timeout.

Only synthetic test identities are allowed. Never commit a real user's private signing key.
