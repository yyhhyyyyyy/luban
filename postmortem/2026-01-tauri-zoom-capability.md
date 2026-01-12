# Postmortem: Tauri webview zoom capability was misconfigured

## Summary

The Tauri capability for adjusting webview zoom used an incorrect permission identifier, preventing zoom changes from working.

## Severity

**Sev-3 (Medium)**: a platform-specific UX feature was broken for desktop users.

## Impact

- Tauri zoom adjustments were blocked by capability configuration.

## Detection

- Manual testing of zoom adjustment feature.

## Root cause

The capability configuration referenced `"webview:allow-set-webview-zoom"` instead of the correct `"core:webview:allow-set-webview-zoom"`.

## Triggering commits (introduced by)

- `0295e38` introduced the capability but used the wrong permission id.

## Fix commits (resolved/mitigated by)

- `2aed57d` corrected the permission id.

## Reproduction steps

1. Run the Tauri app.
2. Attempt to change zoom.
3. Observe permission/capability denial or no effect.

## Resolution

Fix the permission id in `crates/luban_tauri/capabilities/main.json`.

## Lessons learned

- Capability configuration is part of the runtime contract; treat it as code and test it in CI when possible.

## Prevention / action items

1. Add a smoke test that validates critical permissions exist in the shipped capabilities JSON.
2. Maintain a short list of "desktop-only" feature checks for release verification.

