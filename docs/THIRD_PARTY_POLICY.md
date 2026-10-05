# Third-party integration policy

Noncommercial classroom use does **not** make every public repository file freely redistributable. Before code or binaries are permanently included:

1. Pin the exact repository/version/commit.
2. Record the direct and material transitive licenses.
3. Separate open-source, proprietary/source-available, models, fonts, codecs and binaries.
4. Check whether redistribution, modification, model-weight or training-data terms apply.
5. Prefer package/service adapters over copying entire repositories.
6. Store license/notice material under `third_party/`.
7. Generate an SBOM and keep provenance machine-readable.

The repository intentionally does not vendor Stirling proprietary/open-core directories. Only legally cleared components may be integrated.
