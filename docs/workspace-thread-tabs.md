# Workspace Thread Tabs

This document defines how Luban supports multiple conversation threads within the same workspace.
The UI model is browser-like tabs. A tab is an opened view of a thread.

## Goals

- Allow multiple independent conversation threads within one workspace.
- Provide browser-like tab navigation with minimal chrome.
- Preserve draft/scroll/model settings per thread.
- Allow concurrent agent runs per tab.
- Avoid terminal output interleaving by isolating terminal sessions per tab.

## Non-goals (initial)

- PDF/DOCX attachment previews (handled elsewhere).
- Cross-workspace tab grouping.
- Global search across threads.

## Concepts

### Thread

A thread is the durable conversation unit:

- Messages (user/assistant/agent events)
- Draft text + draft attachments
- Scroll position
- Per-thread run configuration (model + thinking effort)
- Turn state (running, pending, etc.)

Thread identity is local-first:

- `WorkspaceThreadId` is a locally-generated `u64` used for UI, persistence, and stable references.
- `remote_thread_id: Option<String>` is the Codex thread id. It is `None` until the first request
  starts a remote thread and we receive `thread.started`.

### Tab

A tab is an opened view of a thread. Tabs are not durable objects; they are derived from thread ids.

Workspace state stores:

- `open_tabs: Vec<WorkspaceThreadId>`: at most 3 items.
- `active_tab: WorkspaceThreadId`: the currently selected thread.
- `tab_lru: Vec<WorkspaceThreadId>`: most-recent-first ordering for auto-eviction.

Closing a tab removes it from `open_tabs` but does not delete the thread.

## UI

### Placement

The tab strip is rendered inside the chat pane:

- Workspace page: above message history, below the workspace pane title bar.
- Dashboard preview panel: in the preview header (same style), above the preview message list.

### Tab strip rules

- At most 3 tabs are visible.
- `+` creates a new thread and opens it as the active tab.
- `…` opens the Threads menu (all threads in this workspace).
- When opening a thread while already at 3 visible tabs, the least-recently-active tab is removed
  from `open_tabs` (not deleted) and remains accessible from the menu.
- Tabs show:
  - Title (derived from thread title)
  - Dirty indicator when the thread has a non-empty draft or draft attachments
  - Running indicator when the thread has an active turn
- Optional: `x` close button on hover (close only, no confirmation; state preserved).

### Threads menu (overflow)

The menu lists all threads sorted by `last_active_at` descending:

- Clicking an item activates the thread and ensures it is in `open_tabs` (subject to the 3-tab cap).

Future (not implemented in the initial delivery):

- Rename thread.
- Delete thread (confirmation; deletes local thread state only).

## Terminal behavior

Terminal sessions are isolated per tab:

- Each `(workspace_id, thread_id)` maps to one terminal session (PTY) and one terminal renderer state.
- The right-side terminal pane displays the active tab's terminal session.
- Non-active sessions remain running but are not visible.

Rationale: concurrent runs in one workspace must not interleave terminal output into a single PTY.

## Agent execution model

Turns are tracked per thread:

- Running/pending state is keyed by `(workspace_id, thread_id)`.
- Cancels are per thread.
- Turn event routing uses a `(workspace_id, thread_id)` key to append entries to the correct thread.

If a thread has `remote_thread_id = None`, the first turn starts a new remote thread; the returned
`thread.started` event binds the remote id to the local thread id.

## Persistence

Persisted app state includes:

- Per-workspace: `open_tabs`, `active_tab`, and `tab_lru`.
- Per-thread: draft text, draft attachments, scroll position, run config, and conversation entries.

We keep attachments on disk at the workspace-level context directory; threads only reference paths.

## Test strategy

- Domain tests:
  - Opening/closing/activating tabs keeps `open_tabs` <= 3 and maintains LRU eviction.
  - Closing tabs does not delete thread state (draft/messages preserved).
  - Concurrent turns are isolated per thread.
- UI tests (GPUI inspector bounds):
  - Tab strip renders in both workspace and dashboard preview.
  - Only 3 tabs visible; overflow menu exists.
  - Active tab changes update the visible conversation and terminal selection.
