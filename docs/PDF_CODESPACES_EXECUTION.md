# Codespaces: execute real local PDF operations

This development test is an executable processing suite, not a marketing
feature inventory. It runs production TypeScript PDF modules against genuine
generated PDF source documents, SAVES output PDFs and archives, reads the
bytes back from disk, and reopens/parses all generated files.

## Run in an existing Linux GitHub Codespace

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
