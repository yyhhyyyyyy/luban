# Dashboard (Kanban)

Dashboard is a full-window Kanban view that lists workspaces grouped by stage.
It does not reuse the regular workspace layout (sidebar/chat/terminal panes).

## Stage model

Dashboard stages are fixed:

- Start
- Running
- Pending
- Reviewing
- Finished

Rules:

- The main workspace is excluded from Dashboard.
- Draft pull requests are treated as `Reviewing`.
- `Finished` is based on pull request merged/closed state.

## Layout

- Columns are vertical lists arranged horizontally.
- Each column has an inset background to distinguish it from neighboring columns.
- Cards have consistent spacing and do not visually "merge" when stacked.

## Preview panel

Clicking a card opens a preview panel for that workspace:

- The preview renders the same message list and composer UI as the workspace view (but without the
  embedded terminal).
- Clicking outside the preview closes it.
- When the preview is open, background Kanban scrolling is blocked to avoid confusing interactions.
- The preview panel width is resizable.

## Navigation

- Dashboard can be toggled from the titlebar without moving the titlebar layout.
- Returning from Dashboard restores the previously active workspace view.

