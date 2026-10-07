# MALENJO WeasyPrint inventory pack

This directory is an **audit-stage provider pack**, not a release-approved
component.

Build on Windows:

`powershell -ExecutionPolicy Bypass -File scripts/build-weasyprint-windows.ps1`

Generated files are ignored by Git:

- `runtime/`
- `manifest.json`
- `inventory.json`

The manifest must keep `capabilityEnabled=false` and
`redistribution=inventory-only-not-approved` until the exact transitive
Windows runtime license closure is completed under PDF issue #143.
