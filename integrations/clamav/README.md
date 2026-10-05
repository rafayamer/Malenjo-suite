# ClamAV adapter

Phase 6 integrates an optional system `clamscan` executable.

MALENJO does not redistribute ClamAV in the core repository.

Execution properties:

- direct process invocation, not a shell command;
- explicit MALENJO library file path;
- `--no-summary --infected --stdout`;
- 45 second timeout;
- no automatic deletion/quarantine;
- result written to audit events.

ClamAV version/signature database lifecycle remains the responsibility of the optional security pack or system administrator.
