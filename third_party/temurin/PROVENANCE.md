# MALENJO offline Windows Java runtime — verified release input

The PDF workspace uses the legally reusable Stirling open-core backend, which needs Java 25.
The finished Windows installer must supply Java itself; users must never have to
download a JDK/JRE to run PDF tools.

## Reviewed input

- Distributor: Eclipse Adoptium, Eclipse Temurin OpenJDK / HotSpot
- Release: `jdk-25.0.4.1+1`
- Platform: Windows x64
- Asset: `OpenJDK25U-jdk_x64_windows_hotspot_25.0.4.1_1.zip`
- Download origin: https://github.com/adoptium/temurin25-binaries/releases/tag/jdk-25.0.4.1%2B1
- Exact asset SHA-256: `00c847d804f4a78e9f04f2683faf14fed898535b177b7fc704486cb0284e9283`
- OpenJDK license: **GPLv2 with Classpath Exception**; additionally preserve
  every license/notice in the original distribution's `legal/` directory.
- Licensing overview: https://adoptium.net/docs/faq

The source ZIP is downloaded only by the build process, never from the
end-user application. `scripts/build-temurin-runtime-windows.ps1` enforces
the exact hash, vendor/version metadata, Java executable smoke test, and legal
directory requirement before copying the full JDK distribution to
`runtime/java/`. Generated binaries are gitignored.

## Why a full portable JDK is used initially

A custom `jlink` image is smaller, but the pinned Stirling backend and its
transitive converters can load Java modules reflectively. Until every PDF
operation is tested, pruning modules risks hidden startup failures. Packaging
the complete reviewed runtime is the deliberately conservative compatibility
choice; minimize it only after passing fidelity and smoke tests for all routes.

The Tauri resource map installs the runtime at `runtime/java/`. The native
Stirling launcher prefers the bundled executable ahead of system Java and
explicit overrides, while retaining system fallback for development and
diagnostics. Windows CI exercises the exact bundled executable in its Stirling
provider operation smoke tests.

## Release gate

The archive checksum, licenses and vendored runtime prove only the origin and
presence of a portable Java environment. They do **not** prove all Stirling
operations work, that the installer is complete, or that all transitive software
redistribution obligations have been reviewed. Release remains gated on
updated attribution/source obligations, provider-pack SBOM and notices,
complete offline installer testing, and end-to-end operation acceptance.
