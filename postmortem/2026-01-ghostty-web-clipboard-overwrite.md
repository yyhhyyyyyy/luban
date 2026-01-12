# Postmortem: Upstream `ghostty-web` overwrote clipboard on terminal click (issue #108)

## Summary

Terminal clipboard behavior issues (`Cmd/Ctrl+C` and `Cmd/Ctrl+V`) were partially rooted in an upstream library bug in `ghostty-web` (v0.1.1). The library's selection manager can write to the system clipboard during normal mouse interactions, which breaks user expectations:

- clicking/focusing the terminal can overwrite the user's clipboard
- subsequent paste (`Cmd/Ctrl+V`) pastes unexpected content

Upstream tracking: https://github.com/coder/ghostty-web/issues/108

## Severity

**Sev-2 (High)**: clipboard corruption on a core workflow surface (terminal) causes repeated user-facing failures and undermines trust.

## Impact

- User clipboard can be overwritten when interacting with the terminal, even without an intentional copy action.
- Paste operations then insert unrelated content into the terminal or other applications.
- `Cmd/Ctrl+C` semantics become confusing because clipboard changes are not attributable to explicit user intent.

## Detection

- Manual testing in both browser and Tauri.
- User report with screenshots showing unexpected pasted output.

## Root cause

`ghostty-web` implements non-native selection. In v0.1.1, the selection workflow can cause a clipboard write on mouse interactions that are not clearly a selection gesture:

- a mouse down initializes selection start/end to the same cell
- a mouse up finalizes selection and attempts to copy the selection text to clipboard

This means a click can produce a "selection" of a single cell and then copy it, overwriting the clipboard. The effect is highly visible when the copied cell contains a non-ASCII glyph or a prompt marker, which then appears when users paste elsewhere.

## Triggering commits (introduced by)

- `55720f7` introduced the `web/` frontend and added `ghostty-web` as a dependency at `^0.1.1`.

## Fix commits (resolved/mitigated by)

No complete fix exists in this repository yet because the underlying behavior is upstream.

These commits are mitigation attempts that improved parts of the experience but could not fully guarantee correct semantics while the upstream bug exists:

- `a3b4fd0` (custom clipboard handling in the wrapper)
- `b7120c4` (improved focus behavior)
- `a343f74` (experimented with relying on upstream defaults)
- `397fc88` (explicit copy behavior and paste fallback)

## Reproduction steps

1. Open a workspace with the terminal pane.
2. Copy a distinct string in another application (e.g., `clipboard-sentinel-123`).
3. Click inside the terminal to focus it (without dragging to select text).
4. Paste into another application.
5. Observe the clipboard no longer contains the sentinel and has been overwritten by terminal content.

## Resolution

### Current state

Treat this as an upstream correctness bug. Local workarounds must avoid relying on upstream implicit clipboard writes.

### Recommended remediation options

1. **Upgrade `ghostty-web` to a version that fixes issue #108**, once released, and validate terminal copy/paste on all supported platforms.
2. If a release is not available:
   - **Pin to a patched fork** (or a git revision) and vendor the fix until upstream publishes a release.
3. In the meantime:
   - avoid any behavior that triggers clipboard writes on click/focus
   - provide explicit, opt-in copy semantics via `Cmd/Ctrl+C` when the terminal has a real selection

## Lessons learned

- Upstream terminal emulators often implement clipboard semantics; these must be tested under the exact embedding environment (browser + Tauri).
- A "works in browser" assumption does not hold for clipboard across WebView engines and permission models.
- When integrating a terminal emulator, avoid implicit copy-on-select behavior unless it is explicitly designed and tested.

## Prevention / action items

1. Add an integration-level regression test plan:
   - clicking the terminal must not change clipboard
   - selecting and `Cmd/Ctrl+C` must copy the selection (and only then)
   - `Cmd/Ctrl+V` must paste the clipboard text into PTY input
2. Pin `ghostty-web` versions explicitly when taking fixes that change clipboard semantics.
3. Track upstream issues as first-class dependencies in postmortems and release checklists.

