# Phase 1 — Application Foundation: acceptance record (2 Nov 2026)

**Status: NOT COMPLETED.** The owner set the acceptance policy on 2 Nov 2026:
- Acceptance is by Claude's own review plus the Codex review on each PR: "use ur review, codex review from now on". The owner's manual test is no longer a gate. §3 remains as an optional checklist.
- The native Windows gates (§4) are deferred until the rest of MALENJO is built: "windows is the last thing we will do". They carry over to the final release phase.

Phase 1 becomes COMPLETED when the Phase 1 completion PR is merged into integration with all of the following:
- green CI on its exact head (including the visual matrix job);
- a clean Claude review;
- a clean Codex review, or every valid finding fixed.

## 1. Verified automatically (runs in CI on every PR)

| Requirement (Master Spec v2 Phase 1 / handoff §6) | Evidence |
|---|---|
| Single-window shell, ten ribbon tabs, 90 MAL entries discoverable | `scripts/pdf-ui-browser-smoke.mjs`; ten tabs and 90/90 MAL ids checked in Chromium |
| Command palette: Enter, focus return, repeated Ctrl+K, rapid reopen, removed launcher | `scripts/command-palette-enter-focus-browser-smoke.mjs` |
| Keyboard operation and focus return for menus, drawers, tab close, the password prompt and Home's recent-file menu | `scripts/phase1-shell-keyboard-browser-smoke.mjs` |
| Every workspace: named controls, valid ARIA id references, unique ids, hidden pickers not exposed | `phase1-shell-keyboard-browser-smoke.mjs` scenario 2b |
| One control per name ("Recent Files" is only Home's history button) | `phase1-shell-keyboard-browser-smoke.mjs` scenario 2a |
| Session restore and recovery after restart; browser files explained once and never stored; corrupt stored state | `scripts/phase1-session-restore-browser-smoke.mjs`, `src/suite/files/sessionRestore.test.ts` |
| Every screen in both themes at 1920×1080, 1440×900, 1366×768, 1024×768, 768×600 and 390×844: no overflow, no clipped bar controls, WCAG AA text contrast, no browser errors | `scripts/phase1-visual-matrix.mjs` (288 captures; artifact `phase1-visual-matrix`) |
| Theme toggle leaves document pixels and session unchanged; reduced motion respected | Verified in Chromium during the 2 Nov audit loop (round 5) |
| Real PDF Save/Undo/Redo with independent reopen; page navigation | `pdf-ui-browser-smoke.mjs`, `scripts/pdf-phase2-browser-acceptance.mjs` |

Desktop session restore is exercised through a stubbed Tauri IPC bridge with real PDF bytes. Restore on an installed Windows app is one of the §4 gates.

## 2. Defects fixed in this phase pass

Merged PRs, each with a regression test that fails without its fix:
- rafayamer/Malenjo-suite#298 and #299: command palette focus.
- #300: Workspaces menu and AI drawer keyboard access; ARIA references.
- #301: focus after closing a tab and after a wrong PDF password.
- #302: Home recent-file menu.
- #303: unnamed controls and the PDF tab/panel duplicate id.

The Phase 1 completion PR adds:
- session restore;
- the "Recent Files" naming fix;
- light-theme contrast fixes for Help/Support, Scanner/OCR, the enterprise status badges, session-state chips and primary buttons.

Superseded drafts #254–#258 were closed with a feature-by-feature mapping.

## 3. Optional owner checklist (Codespaces/browser)

This is no longer a gate under the 2 Nov acceptance policy. Use it any time for a hands-on check.

Record the integration commit SHA being tested: `__________`

For each step, mark **Pass/Fail** and add a note for any Fail.

1. **Home.**
   - Open File opens the real file picker.
   - Choose two PDFs; both open as tabs.
   - Recent Files shows them.
2. **Tabs.**
   - Switch tabs with a click and with Ctrl+Tab.
   - Close one tab with its × and confirm the prompt.
   - Focus lands on the remaining tab.
3. **PDF.**
   - Scroll, jump to a page number, and zoom.
   - Rotate a page.
   - Save, then reopen the saved file. The original is unchanged.
4. **Ribbon.**
   - Each of the ten tabs shows its tools.
   - "More PDF tools" lists 90 entries; unverified ones say Unavailable.
5. **Command palette.**
   - Ctrl+K, type "settings", press Enter; Settings opens.
   - Ctrl+K, press Escape; focus returns to where you were.
6. **Keyboard only** (put the mouse aside):
   - Open the Workspaces menu, choose a workspace, and get back.
   - Open and close the AI drawer with Escape.
7. **Themes.**
   - Toggle Light/Dark with a PDF open. The page and tab are kept and the document looks identical.
   - Reload; the theme persists.
8. **Restore.**
   - Reload with a browser file open.
   - Expected: a one-time notice that temporary browser files were not kept.
9. **Window sizes.**
   - Resize from full width down to phone width.
   - Nothing is cut off and there is no sideways scrolling.
10. **Visual review.**
    - Download the `phase1-visual-matrix` artifact from the PR's CI run.
    - Look over the 12 contact sheets (both themes × six sizes).

Optional owner notes (name, date, commit): `__________`

## 4. Deferred Windows gates

These run last, after the remaining phases are built. The owner decided this on 2 Nov 2026.

- **Install lifecycle:** clean install, launch, uninstall and rollback of the NSIS/MSI installer.
- **Desktop file handling:**
  - the real Windows file picker;
  - drag-and-drop from Explorer;
  - `.pdf` "Open with" association (not forced as default; Office formats stay unassociated).
- **Restart behaviour:** desktop session restore after a real restart, and crash-interruption recovery.
- **Display:** scaling (125–200 %) and theme persistence in the installed app.
- **Optional on-demand/nightly CI job:** build, silently install, launch and uninstall on `windows-latest`. Not added yet, per the same decision.
