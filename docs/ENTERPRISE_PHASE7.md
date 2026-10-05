# Phase 7 — Automation, DMS, Backup and Administration

## Scope

Phase 7 implements enterprise-quality local workflows while retaining the MALENJO student/noncommercial profile. All Phase 7 services remain local-first and function without a mandatory cloud control plane.

## DMS

The local DMS stores an index under MALENJO application data and snapshots registered library documents into immutable version files.

Each version records:

- creation timestamp;
- SHA-256;
- byte size;
- note;
- internal snapshot path.

Registering a document creates an initial immutable version. Manual or workflow-driven snapshots create additional versions.

### Retention and legal hold

Every DMS record has:

- retention days;
- legal-hold flag;
- tags;
- version history.

Retention is a two-step operation:

1. preview candidates;
2. explicitly apply the previewed version IDs.

MALENJO never selects the newest version for retention deletion. Legal-hold records are excluded entirely. Retention only removes MALENJO's internal DMS snapshots; it never deletes the user's source document.

## Automation

Phase 7 defines a versioned workflow contract stored locally.

Supported local steps:

- audit checkpoint;
- DMS immutable version snapshot.

Workflows are validated before persistence or execution and are limited to 1–20 steps.

### Temporal adapter

An optional external Temporal CLI can receive a saved workflow contract.

Current fixed connection contract:

- address: `127.0.0.1:7233`
- namespace: `default`
- task queue: `malenjo`
- workflow type: `MalenjoDocumentWorkflow`

MALENJO invokes the CLI directly without a shell. A compatible worker must already be running. Temporal is not started automatically.

## Backup and disaster recovery

### MALENJO offline backup

The built-in local backup covers MALENJO enterprise and security application state.

For each backup:

- files are copied into a new backup directory;
- symbolic links are skipped/rejected;
- every file receives a SHA-256 entry;
- a versioned manifest is written;
- every manifest entry is rehashed before success is reported.

### Restore safety

Restore:

1. verifies every manifest entry;
2. creates a recovery copy of current enterprise/security state;
3. copies backup data into a staging directory;
4. replaces live state;
5. attempts recovery if replacement fails;
6. retains the pre-restore recovery directory even after success.

User documents are not part of this restore target and are never deleted by the restore pipeline.

Automated Rust tests prove verified restore behavior, preservation of the old state in the recovery directory, and failure of integrity inspection after backup tampering.

### Kopia adapter

Kopia is an optional external backup engine.

Phase 7 supports:

- status/version discovery;
- snapshot of MALENJO enterprise app state;
- restore of an explicit snapshot ID to an explicit existing directory.

Repository credentials and Kopia repository configuration are not stored by this UI.

## Administration and shared permissions

Phase 7 uses one local policy document shared across DMS, automation, backup and administration.

Roles:

- owner
- admin
- editor
- viewer

Permissions are enforced in the native command boundary rather than only hiding frontend controls.

The current Phase 7 UI intentionally keeps the active local role read-only to avoid a local owner accidentally locking themselves out before identity-provider binding exists.

A future identity provider can bind user identities/groups to these permission contracts without replacing DMS/workflow/backup authorization logic.

## Audit retention

The policy has an audit-retention target.

Applying audit retention:

- reads the native Phase 6 JSONL audit stream;
- moves expired records into a timestamped archive JSONL file;
- rewrites the active log with retained records;
- records an audit-retention event.

Old audit records are archived rather than silently discarded.

## Security boundaries

- DMS snapshots contain canonical library files only.
- DMS internal paths are relative and traversal-checked.
- Retention cannot target newest versions or legal-hold records.
- Temporal and Kopia are invoked directly, not via a shell.
- Temporal address is fixed to loopback.
- Workflow inputs are bounded.
- Backup paths reject symbolic links.
- Restore is integrity-verified before live-state replacement.
- Shared permissions are checked in Rust for sensitive commands.
- Enterprise operations emit Phase 6 audit events.

## Third-party provenance

Temporal server is MIT licensed. Phase 7 does not vendor the server or CLI. The adapter is an optional external process and uses a fixed local endpoint.

Kopia is Apache-2.0 licensed. The reviewed current release for Phase 7 is v0.23.1. MALENJO does not vendor Kopia in this repository.

## Acceptance checklist

- [x] DMS indexing/version model.
- [x] SHA-256 immutable version evidence.
- [x] Retention preview/apply model.
- [x] Legal-hold protection.
- [x] Workflow contract model.
- [x] Local workflow runner.
- [x] Optional Temporal adapter.
- [x] Verified offline backup.
- [x] Integrity-checked restore.
- [x] Recovery copy before restore.
- [x] Offline restore/tamper Rust tests.
- [x] Optional Kopia adapter.
- [x] Shared role/permission model.
- [x] Native permission enforcement.
- [x] Audit logging integration.
- [x] Audit retention/archive control.
- [ ] Automated Phase 7 CI.
- [ ] Physical Windows Temporal/Kopia integration matrix.
- [ ] Multi-user identity-provider binding.
