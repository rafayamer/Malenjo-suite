# qpdf provider pack

MALENJO uses qpdf as a permissively licensed local helper for PDF structural repair/optimization paths that Stirling core can delegate to qpdf.

- Version: 12.4.2
- License: Apache-2.0
- Official Windows x64 release asset: `qpdf-12.4.2-msvc64.zip`
- Pinned SHA-256: `db87077e683630c1217e0e8f9a20a9749d952ab676e881c3689187763a5de25d`

Install for Windows development:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-qpdf-pack.ps1
```

The script downloads only the pinned official release, verifies its digest, preserves the binary distribution root, verifies `qpdf --version`, and writes a generated manifest.

Generated runtime files and manifest are gitignored. Release packaging must retain the qpdf Apache-2.0 license and NOTICE from `third_party/qpdf/`.
