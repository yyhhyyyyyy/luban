# Postmortem: Kanban excluded the main worktree

## Summary

The kanban view filtered out the main worktree, causing it to be absent from the list even when it should be visible.

## Severity

**Sev-4 (Low)**: content omission in a secondary view; did not block core actions.

## Impact

- Users could not see the main worktree in kanban, resulting in an incomplete overview.

## Detection

- Manual UI review and user request ("main worktree should be shown too").

## Root cause

The kanban board explicitly skipped workspaces where `workspace_name === "main"`.

## Triggering commits (introduced by)

- `57bd65a` introduced the kanban board and included the exclusion filter.

## Fix commits (resolved/mitigated by)

- `9b30a77` removed the exclusion filter.

## Reproduction steps

1. Open the kanban board.
2. Observe that the main worktree is missing.

## Resolution

Include the main worktree as a normal kanban item when its status is active.

## Lessons learned

- Hard-coded filters in view models require explicit design rationale and coverage.

## Prevention / action items

1. Add a small UI test that asserts the main worktree is present in kanban when active.
2. Centralize workspace filtering logic to avoid divergent rules across views.

