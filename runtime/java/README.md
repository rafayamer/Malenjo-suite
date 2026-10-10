# Generated offline Java runtime

This is the resource destination for MALENJO's bundled Java 25 runtime.
The tracked README keeps the directory present in development; it is **not**
a Java installation.

For the Windows offline installer, build the pinned runtime with:

```powershell
./scripts/build-temurin-runtime-windows.ps1
```

That script installs `bin/java.exe`, the complete legal notice directory,
`release` metadata, and `malenjo-runtime-manifest.json`. The archive must
pass its pinned SHA-256 and Java 25 smoke check first.

**Never ship an installer containing only this README.** Windows CI and
release acceptance must exercise the bundled Java executable with Stirling.
