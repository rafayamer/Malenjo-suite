# Build steps

1. Install Git, Node.js, Rust stable, Visual Studio Build Tools (Desktop development with C++), WebView2 runtime and Windows SDK.
2. Clone the repository and run `npm install`.
3. Commit the generated `package-lock.json` after the first trusted install, then prefer `npm ci` in CI.
4. Run `npm run typecheck` and `npm test` before changing integration code.
5. Run `npm run tauri:dev`; confirm the MALENJO shell opens without starting heavyweight services.
6. Implement one capability at a time behind `integrations/<engine>/` or a native service adapter.
7. Write unit tests for the adapter contract and integration tests using `testing/suite/fixtures/`.
8. Verify operation without Internet for local features.
9. Record dependency license/provenance before merging.
10. Benchmark startup, first-render, search, scrolling and idle memory against the developer-guide budgets.
11. Before packaging, generate SBOM/notices, run security scans, build with `npm run tauri:build`, sign binaries/installers, verify signatures and test clean install/upgrade/rollback/uninstall on Windows VMs.
