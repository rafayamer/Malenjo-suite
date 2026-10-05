# Kopia adapter

Phase 7 implements an optional external Kopia adapter in addition to MALENJO's built-in verified offline backup.

Reviewed release baseline: Kopia v0.23.1.

Supported operations:

- `kopia --version`
- snapshot the MALENJO enterprise app-data directory;
- restore an explicit snapshot ID into an explicit existing directory.

The adapter:

- invokes Kopia directly, not through a shell;
- does not create/delete repositories;
- does not store repository credentials in the MALENJO UI;
- does not restore directly over live MALENJO state.

MALENJO's built-in offline backup/restore remains the deterministic recovery path with SHA-256 manifest verification and recovery-copy protection.

Kopia is Apache-2.0 licensed. No Kopia binary/source is vendored in Phase 7.
