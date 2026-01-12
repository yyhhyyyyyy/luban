# Postmortem: Terminal cursor visibility on light background (GPUI era)

## Summary

When using a GPUI-based terminal component, the cursor could become hard to see on light backgrounds. This was a user-facing readability issue for a critical interaction surface.

## Severity

**Sev-3 (Medium)**: degraded usability; not a data correctness issue.

## Impact

- Cursor visibility was reduced on light themes, making terminal interaction harder.

## Detection

- Manual UI testing on light background themes.

## Root cause

The terminal theme/cursor color defaults did not provide sufficient contrast in light theme variants.

## Triggering commits (introduced by)

The issue existed in the GPUI terminal implementation prior to the fix; the introducing commit is not uniquely identified in the current history.

## Fix commits (resolved/mitigated by)

- `7502750` introduced a dedicated terminal crate and configuration that ensured cursor visibility on light backgrounds.

## Reproduction steps

1. Run the GPUI UI with a light theme.
2. Focus the terminal input.
3. Observe that the cursor is difficult to see.

## Resolution

Ensure the cursor uses a high-contrast color derived from the theme, and validate visibility in both light and dark modes.

## Lessons learned

- Visual accessibility concerns (contrast) should be validated for interactive cursors, selections, and focus indicators.

## Prevention / action items

1. Add theme-contrast checks for cursor and selection colors (manual checklist or automated screenshot tests).
2. Keep terminal theming logic centralized to avoid divergence across UI surfaces.

