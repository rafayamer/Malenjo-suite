# MALENJO: beginner developer start guide

For a new developer with little experience. Read this once, then follow the steps in order.

## What MALENJO is

A Windows desktop app for documents (PDF, Word/Excel/PowerPoint-style editors, scanner and OCR, local AI, signing, and more). It is a **local-first, noncommercial student build**. The code you are looking at already contains the Phase 0-7 foundation. You do **not** start from scratch and you do **not** fork Stirling-PDF again.

Read `docs/IMPLEMENTATION_STATUS.md` first. It is the honest list of what is finished and what is still a scaffold.

## Five rules

1. **One small task at a time.** "Add OCR" is too big. "Show an error message when the OCR model is missing" is a task.
2. **Licenses are a gate.** Never copy Stirling-PDF's restricted folders (`app/proprietary`, `app/saas`, `engine`, and the proprietary / desktop / saas / cloud / portal frontend layers). No GPL/AGPL libraries. Unsure? Ask.
3. **Do not commit to `main`.** Make a branch, open a pull request, get it reviewed.
4. **Every change needs a test** and a passing check run.
5. **Never commit secrets** (passwords, keys, tokens).

## Set up your computer (Windows 10/11, 64-bit)

Install in this order, and check each one in a new terminal:

| Tool | Check |
|---|---|
| Git | `git --version` |
| VS Code | opens |
| Node.js (see `.devcontainer` for the version CI uses, currently 22) | `node --version` |
| Rust stable (MSVC) via rustup | `rustc --version` |
| Visual Studio Build Tools, "Desktop development with C++", plus Windows SDK | installer finishes |
| WebView2 runtime | usually already installed on Windows 11 |
| Java JDK 25 (only needed for the Stirling-core job, not for everyday UI work) | `java -version` |

Building on your own PC costs nothing. You do not need GitHub Codespaces or paid GitHub minutes for this.

## First run

```bash
git clone https://github.com/rafayamer/Malenjo-suite.git
cd Malenjo-suite
npm install
npm run typecheck
npm test
npm run tauri:dev
```

If the MALENJO window opens, you are set up. If something fails, copy the **first** error message (not the last) and ask for help with: what you ran, what you expected, what happened.

## Day-to-day routine

1. `git checkout main && git pull`
2. `git checkout -b feat/<module>-<tiny-task>`
3. Read the existing code and docs for that module. Copy its style.
4. Make the smallest change that works. Add a normal test and a bad-input test.
5. Run the checks:
   ```bash
   npm run typecheck
   npm test
   npm run build
   cargo check --manifest-path src-tauri/Cargo.toml
   cargo test --manifest-path src-tauri/Cargo.toml --lib
   ```
6. Run the app and try to break your feature.
7. Push and open a pull request. Fill in the whole checklist in `.github/PULL_REQUEST_TEMPLATE.md`.

## Where things are

| What | Where |
|---|---|
| UI (React/TypeScript) | `src/suite/` |
| Native side (Rust/Tauri) | `src-tauri/src/suite/` |
| Engine adapters | `integrations/` |
| Cleared third-party material | `third_party/` |
| Tests and sample files | `testing/suite/` |
| Docs | `docs/` |

## Adapter idea (important)

The UI never talks to a library directly. It asks for a MALENJO capability, which goes through a MALENJO interface to an adapter, which talks to the engine. Then you can swap an engine without rewriting screens.

## Suggested first tasks

Pick from the "Next gate" column in `docs/IMPLEMENTATION_STATUS.md`. Good beginner starts are small tests or documentation fixes, then small UI fixes in a module that already works. Leave Windows camera, installer, signing and enterprise identity work for later.

## Using Claude Code

This repo has a project skill at `.claude/skills/malenjo-dev/`. It makes Claude Code follow the rules above automatically. Still read and understand every change before you commit it.
