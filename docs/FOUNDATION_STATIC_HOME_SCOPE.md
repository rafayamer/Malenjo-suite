# Owner scope decision — static Home assets (2026-10-16)

**Authority:** The owner's explicit 2026-10-16 instruction supersedes only the LottieFiles/animated Home icon requirement in `docs/MALENJO_MASTER_SPEC_V2.md` §§2.4, 9.5. It does **not** waive accessibility, performance, offline execution, PDF 2.0 ISO 32000-2, or any MAL-001–090 capability.

## Implementation contract

- Use lightweight first-party static SVG/icons for Home **Open File** and **Recent Files**. Do not add a Lottie player, animation WASM, third-party animation JSON, runtime CDN, or licensed animation dependency.
- Preserve existing keyboard-accessible, actual file picker/recent-file workflows and two-theme visual consistency.
- Do not introduce network calls to display Home icons. Honor operating-system reduced-motion settings for any unrelated motion that remains.
- PR #292 is **not** an approved integration candidate: its animation runtime and PDF acceptance document are mixed. Preserve the distinct PDF 2.0 and 90-capability test requirements through an independently reviewed, animation-free change, not by merging the animation PR.
- The current integration Home already contains static SVG/Lucide assets in `src/suite/home/HomeWorkspace.tsx`. This note does not claim a new icon implementation or runtime/browser acceptance.

## Acceptance evidence still required

Verify both themes, Open File picker, Recent Files open/error handling, keyboard/screen-reader semantics, no animation network requests, offline operation and responsive viewports in real Chromium and native Windows. Record exact-head CI and actual results. **Foundation remains NOT COMPLETED** until all mandatory owner-UAT/native and functional gates are satisfied.
