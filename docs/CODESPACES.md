# MALENJO GitHub Codespaces

After Phase 1 is merged, create the Codespace from the repository default branch, `main`.

The dev container installs Node.js 22, npm 11, Rust stable, and the Linux libraries required to compile the Tauri shell. It then installs JavaScript dependencies and fetches Rust dependencies.

## First checks

```bash
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## Run the browser shell

```bash
npm run dev -- --host 0.0.0.0
```

Port 1420 is forwarded automatically.

## Desktop limitation

A Codespace is Linux. It is suitable for React/TypeScript work, Rust core logic, tests, documentation, adapters, and much of Tauri development. Windows-specific WebView2 behavior, NSIS/MSI packaging, Authenticode signing, and final Windows desktop validation remain the responsibility of the Windows GitHub Actions runner and Windows test machines.
