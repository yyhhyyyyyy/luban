# UI Testing (Inspector-first)

Luban UI tests aim to be stable across small layout/styling changes while still preventing UX
regressions.

## Principles

- Prefer semantic assertions (element exists, is visible, is inside viewport) over pixel-perfect
  comparisons.
- Use stable ids and the GPUI inspector to locate elements.

## Stable selectors

Use `debug_selector` to attach stable identifiers to elements that tests need to query.
Selectors should be:

- Explicit and unique within a view (e.g. `workspace-thread-tabs-menu-trigger`).
- Stable across refactors (avoid including transient runtime values unless necessary).

## Bounds assertions

When layout stability matters, tests may record element bounds and assert invariants, such as:

- Composer stays within the viewport even with a long message history.
- Sidebar and terminal resizers remain interactive.
- Active indicators are vertically centered in rows.

This avoids relying on brittle screenshots while still catching major regressions.

