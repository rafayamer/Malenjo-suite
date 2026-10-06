# MALENJO Stirling open-core provider pack

This directory is the packaging destination for the **backend-only Stirling-PDF core flavor** used by MALENJO's local Windows PDF provider.

The provider is not a remote server dependency. MALENJO starts it on demand as a loopback-only child process on `127.0.0.1:28970` and communicates through the MALENJO Rust boundary.

## Build

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-stirling-core.ps1
```

Codespaces/Linux validation:

```bash
bash scripts/build-stirling-core.sh
```

The scripts pin `Stirling-Tools/Stirling-PDF@25220cbdbde2d526cebf173b94357884e180b8c1`, use sparse checkout for only open-core build paths, assert that every root-license restricted path is absent, build with `STIRLING_FLAVOR=core`, and copy only the resulting core JAR here.

Generated `stirling-pdf.jar` is intentionally gitignored. Release packaging must build it reproducibly, verify `manifest.json`, run the license/SBOM gate and then bundle this provider-pack directory as a Tauri resource.

Do not place a proprietary/saas/engine/desktop Stirling binary in this directory.
