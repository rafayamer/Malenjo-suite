# LottieFiles asset and player provenance — MALENJO

## Actually bundled source (initial UI integration)
- Upstream: https://github.com/LottieFiles/dotlottie-web
- Reviewed repository commit: `d8a4e9e2cf76740b7b3848257f962b38d71aa71a` (2026-10-06).
- Source asset: `fixtures/down.json`
- Source blob SHA: `79284c3fd4d2e82711cafd9233e5e2a26fcf2b7c`
- MALENJO copy: `public/animations/lottiefiles-down.json` (locally bundled, 5.5 KB JSON; contains no image assets).
- Upstream repository license: MIT, copyright (c) 2023 LottieFiles.com. Retain MIT license and copyright notice when distributing.
- Runtime: `@lottiefiles/dotlottie-react` `^0.20.0` backed by upstream `LottieFiles/dotlottie-web`. Verify locked runtime transitive dependency and license inventory before Windows release.

## Implementation
- Home Recent Files displays the animation as a decorative accent only, with readable text and a static icon fallback.
- Player is imported only when the animation is visible and user has not requested reduced motion; never changes PDF canvas/source pixels.
- No runtime LottieFiles/CDN network access is required to load this animation. Runtime build/WASM and offline packaging must pass final integration CI.
- LottieFiles free community catalogue candidates documented in `docs/PDF2_AND_LOTTIE_ACCEPTANCE.md` are **not** shipped until each asset's license, downloaded bytes, SHA-256, provenance and rendering have been verified. The public free catalogue uses the Lottie Simple License, whose terms differ from this upstream MIT fixture.
- Future assets must be reviewed individually and placed under `public/animations/` with manifest/provenance records and size/performance budgets.

## Status
NOT COMPLETED until frontend build, exact-head tests, Chromium playback/reduced-motion tests, local/offline runtime checks, performance regression and owner aesthetic acceptance pass. This entry is provenance, not a claim of those gates.
