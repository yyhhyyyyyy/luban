# Embedded Terminal

Luban embeds a terminal using upstream `gpui-ghostty` and isolates sessions per workspace thread.

## Dependency

- The terminal renderer uses a git dependency on `gpui-ghostty`.
- Building the terminal requires Zig for `ghostty_vt_sys`.

## Session isolation

- Each `(workspace_id, thread_id)` owns one terminal session and renderer state.
- The right-side terminal pane displays the active thread's session.
- Non-active sessions remain running but are hidden.

Rationale: concurrent agent runs must not interleave output into a single PTY.

## Session lifecycle

If the user exits the terminal session (e.g. `Ctrl+D`):

- Luban clears the session state for that thread and initializes a fresh session.

## Layout and persistence

- The terminal pane width is user-resizable via dragging.
- The width is persisted in SQLite as a single global value and restored on startup.

