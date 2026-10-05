# Security baseline

- Treat every imported PDF, Office document, image, archive, DICOM or CAD file as untrusted input.
- Keep parsing/conversion/OCR/AI engines out of privileged UI hot paths.
- Bind local helper services to loopback by default and authenticate sensitive local APIs.
- Store secrets using a `SecretStore` abstraction backed by Windows DPAPI/Credential Manager and TPM wrapping when appropriate.
- Never put signing keys, OAuth client secrets, passwords or production credentials in Git.
- Production updates must be signed and verified before installation.
- Build SBOM and third-party notices for every release.
- Add corpus fuzzing, archive-bomb limits, path traversal tests, malformed-file tests and update-supply-chain tests before release.
