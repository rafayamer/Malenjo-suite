# Codespaces: execute real local PDF operations

This development test is an executable processing suite, not a marketing
feature inventory. It runs production TypeScript PDF modules against genuine
generated PDF source documents, SAVES output PDFs and archives, reads the
bytes back from disk, and reopens/parses all generated files.

## Run in an existing Linux GitHub Codespace

    node --version      # must be Node 24 or newer (PDF.js 6 uses Promise.try)
    npm install --no-audit --no-fund
    npm run test:pdf-execution

Outputs are under .build/pdf-codespaces-execution/run-*/.
Each run creates a new directory and refuses overwriting previous artifacts.
The manifest.json lists tested operation IDs, output file names, SHA-256 values
and the checks actually performed. The pdf-execution-linux GitHub Actions job
uses the same command and uploads the pdf-codespaces-executed-artifacts bundle.

A successful normal npm test does NOT count: the disk-execution suite requires
the environment variable set by the dedicated runner and is skipped in
ordinary frontend unit-test runs.

## Explicit scope

This proves a subset of real, offline, browser-independent PDF functions
actually produce readable disk artifacts in Linux. It does NOT prove all 90
feature equivalents, Tauri GUI behavior, Windows installation, rendering via
an HTMLCanvasElement, or any separately configured provider. Its manifest
lists these outstanding execution categories explicitly.

qpdf permissions, PaddleOCR model execution, pyHanko signing/TSA, PDF/A via
LibreOffice+veraPDF, licensed RAR-based CBR, Java Stirling endpoints and
opt-in public HTTPS capture need separate end-to-end provider testing.
A folder-scanning guide or SSO architecture document does not execute a
folder watcher or SSO login.

Do not mark any 90-row release acceptance status as complete based on this
Codespaces subset. Windows installer work remains explicitly deferred.

## Execute an operation on your own local PDF

This is not limited to test fixtures. In the same Codespace, invoke:

    npm run pdf:execute -- --operation rotate-pdf --input ./input.pdf --output ./rotated.pdf --page 1
    npm run pdf:execute -- --operation remove-pages --input ./input.pdf --output ./trimmed.pdf --pages 2,4
    npm run pdf:execute -- --operation pdf-to-json --input ./input.pdf --output ./extracted.json
    npm run pdf:execute -- --operation split-by-size-or-count --input ./input.pdf --output ./parts.zip --page 2
    npm run pdf:execute -- --help

This CLI invokes the actual production PDF function and writes the result only
after validating input and operation shape. It then REOPENS the PDF, ZIP, EPUB,
JSON, XML or text output from disk, and writes a SHA-256 receipt next to it
as <output>.execution.json. Existing output files are never overwritten.

It does not enable optional native providers that need Tauri, licensed tools,
OCR model files, or an RFC 3161 local authority. Run the help command for the
supported subset. When the source file is a PDF, it must actually begin with
the PDF header. Every operation preserves the input; it is a new-file workflow.
