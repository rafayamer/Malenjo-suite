# Stirling Office Convert 0.2.2 dependency review

Source release: `v0.2.2` / `673aab8d6ac784524cd1d90141c95e74b9fd26ae`.

Direct module dependencies declared by that release:

| Module | Direct dependency | Version | License family |
|---|---|---:|---|
| core | Apache PDFBox | 3.0.8 | Apache-2.0 |
| core | Apache Commons Logging | 1.4.0 | Apache-2.0 |
| core runtime | Apache PDFBox JBIG2 ImageIO | 3.0.5 | Apache-2.0 |
| legacy | Apache POI scratchpad | 5.5.1 | Apache-2.0 |
| topdf | Apache PDFBox | 3.0.8 | Apache-2.0 |
| topdf | Apache POI OOXML | 5.5.1 | Apache-2.0 |
| topdf | Apache POI scratchpad | 5.5.1 | Apache-2.0 |
| topdf | PDFBox Graphics2D | 3.0.5 | Apache-2.0 |

These are not the complete runtime transitive graph. MALENJO therefore does
not treat this table as the release license manifest. The provider build runs
the pinned Stirling `checkLicense generateLicenseReport --no-parallel` tasks
against the exact resolved graph and packages
`build/reports/dependency-license/index.json` as
`provider-packs/stirling-core/malenjo-notices/stirling-dependency-licenses.json`.

If the license task changes `app/license-overrides.json`, the provider build
must fail so newly unresolved metadata is reviewed rather than silently
accepted.
