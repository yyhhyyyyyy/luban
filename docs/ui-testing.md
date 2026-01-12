# UI Testing (Playwright-first)

The web UI is the primary frontend. UI regression testing should be done with Playwright and should
prioritize stability over pixel-perfect diffs.

## Principles

- Prefer semantic assertions (element exists, state changes, scroll behavior) over screenshot-only
  comparisons.
- When a screenshot is useful, keep it scoped (component-level) and treat it as supporting evidence,
  not the only assertion.

## Selectors

- Prefer stable `title=` attributes and structural selectors aligned with `design/`.
- Avoid selectors derived from transient values (timestamps, random ids, etc.).

## Recommended checks

- Tab behavior:
  - new tab always appends to the end
  - restore appends to the end
- Scroll behavior:
  - follow-tail when at bottom
  - show "Scroll to bottom" only when user scrolls away
  - no page-level scroll (only content panes scroll)
- Terminal:
  - reconnect/refresh preserves output (bounded replay)
  - resize sends rows/cols correctly
  - theme matches CSS variables

## Running locally

Install browsers (once):

`cd web && pnpm exec playwright install`

Run:

- `just test-ui`
- `just test-ui-headed`

## Isolation and safety

UI tests run against an isolated Luban instance by default:

- A temporary `LUBAN_E2E_ROOT` is created under your OS temp dir.
- The server binds to a random loopback port (via `LUBAN_E2E_PORT`).
- `HOME` and `LUBAN_ROOT` are pointed at directories inside `LUBAN_E2E_ROOT`, so the SQLite DB and
  on-disk state used by tests never touch your production instance.

You can override this behavior:

- `LUBAN_E2E_ROOT=/path/to/dir`: reuse a specific scratch root (will be cleared by global setup).
- `LUBAN_E2E_PORT=12345`: force a port (must be free).
- `LUBAN_E2E_REUSE_SERVER=1`: reuse an already running server at the configured port (local-only).
