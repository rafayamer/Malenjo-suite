# MALENJO qpdf provider pack

Generated Windows component pack for MALENJO PDF provider operations.

- qpdf: **12.4.2**
- upstream: `qpdf/qpdf@v12.4.2`
- license: Apache-2.0
- Windows x64 asset: `qpdf-12.4.2-msvc64.zip`
- SHA-256: `db87077e683630c1217e0e8f9a20a9749d952ab676e881c3689187763a5de25d`
- build: `powershell -ExecutionPolicy Bypass -File scripts/build-qpdf-windows.ps1`

The generated `runtime/` directory and manifest are not committed. The builder preserves the official distribution layout and adds retained MALENJO notice copies. MALENJO prepends only the directory containing the generated `qpdf.exe` to the on-demand local Stirling child process. It is not added to the user or machine PATH.

Redistribution requires the Apache-2.0 license and qpdf NOTICE/attribution material. See `third_party/qpdf/PROVENANCE.md` and `docs/THIRD_PARTY_NOTICES.md`.
