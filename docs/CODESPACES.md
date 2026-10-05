# MALENJO GitHub Codespaces

Create the Codespace from the repository default branch, `main`.

The dev container installs Node.js 22, npm 11, Rust stable, and the Linux libraries required to compile the Tauri shell. It then installs JavaScript dependencies and fetches Rust dependencies.

## Recommended verification

Run the complete verification as one command:

```bash
npm run verify:codespace
```

That script runs these checks in order:

```bash
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Using the single verification command avoids accidental terminal concatenation when pasting several commands at once.

## Run the browser shell

```bash
npm run dev -- --host 0.0.0.0
```

Port 1420 is forwarded automatically.

## Desktop limitation

A Codespace is Linux. It is suitable for React/TypeScript work, Rust core logic, tests, documentation, adapters, and much of Tauri development. Windows-specific WebView2 behavior, NSIS/MSI packaging, Authenticode signing, and final Windows desktop validation remain the responsibility of the Windows GitHub Actions runner and Windows test machines.

The CI workflow includes a dedicated `codespace-linux` job so Linux/Tauri regressions such as missing PNG application resources are caught before they reach `main`.
