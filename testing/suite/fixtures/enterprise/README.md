# Phase 7 enterprise recovery and policy corpus

Automated and manual cases include:

## DMS

- initial immutable version creation;
- repeated version snapshot;
- SHA-256 evidence;
- legal hold blocks retention;
- newest version never qualifies for retention deletion;
- retention applies only explicitly previewed candidates.

## Automation

- empty workflow rejected;
- workflow with more than 20 steps rejected;
- DMS snapshot step requires record ID;
- unsupported step kind rejected;
- local audit and DMS snapshot steps;
- Temporal unavailable/timeout/error.

## Backup and restore

- verified backup manifest;
- missing backup file;
- modified/tampered backup file;
- symlink rejection;
- offline restore;
- preservation of pre-restore state in recovery copy;
- failed replacement recovery path;
- user documents outside enterprise/security app state are untouched.

## Administration

- viewer cannot mutate DMS;
- viewer cannot restore backups;
- owner has administration write permission;
- audit retention archives old events.

Use only synthetic app-state fixtures. Do not add real user documents, secrets, repository credentials or production backup data.
