# Temporal adapter

Phase 7 implements an optional local Temporal CLI handoff.

## Fixed local contract

- executable: `temporal`
- address: `127.0.0.1:7233`
- namespace: `default`
- task queue: `malenjo`
- workflow type: `MalenjoDocumentWorkflow`

MALENJO persists and validates its own workflow contract first, then serializes that contract as bounded CLI input.

The adapter:

- uses direct process invocation, not a shell;
- does not accept an arbitrary Temporal address from the frontend;
- has a bounded execution timeout;
- does not start Temporal automatically;
- requires a compatible worker to exist separately.

Temporal server is MIT licensed. No Temporal binary or server source is vendored by Phase 7.
