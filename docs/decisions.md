# Technical Decisions (Implemented)

This document tracks important technical decisions that are already implemented in the codebase.
It is intentionally high-level and links to deeper design docs when they exist.

## Codex integration (CLI-first, no sidecar)

Decision:

- Luban runs the Codex CLI directly rather than using a Node.js sidecar process.
- The CLI binary is discovered via `PATH` or `LUBAN_CODEX_BIN`.

Rationale:

- Reduce dependencies (no Node.js runtime, fewer moving parts).
- Keep failures obvious: if `codex` is missing, surface a clear, user-visible error.

Details:

- See `docs/codex-cli.md`.

## Embedded terminal (upstream gpui-ghostty)

Decision:

- The embedded terminal uses upstream `gpui-ghostty` via a git dependency.
- We do not vendor a forked `crates/gpui_ghostty_terminal` in this repository.

Rationale:

- Avoid maintaining a long-lived fork.
- Keep improvements upstreamable and reduce divergence.

Details:

- See `docs/terminal.md`.

## Workspace context tokens (inline attachments)

Decision:

- Attachments are persisted as files inside a workspace-scoped `context/` directory and referenced by
  `<<context:...>>` tokens inside the user message text.
- The UI renders tokens as inline thumbnails/chips while keeping the persisted text stable.

Details:

- See `docs/context-tokens.md`.

## Dashboard (Kanban workspace overview)

Decision:

- Dashboard renders a full-window Kanban view of workspaces split into fixed stages.
- The main workspace is excluded from Dashboard.
- Workspace stage is derived from branch/PR state; "Finished" is based on PR merged/closed.

Details:

- See `docs/dashboard.md`.

## Workspace thread tabs (browser-like, archive-on-close)

Decision:

- Workspace chat supports multiple local threads displayed as a tab strip.
- Closing a tab archives it; archived tabs can be restored from a menu.
- Tabs do not auto-reorder after creation; users reorder by dragging.

Details:

- See `docs/workspace-thread-tabs.md`.

## UI test strategy (Inspector-first)

Decision:

- UI integration tests rely on stable `debug_selector` ids and inspector-derived bounds rather than
  brittle pixel comparisons.

Details:

- See `docs/ui-testing.md`.

