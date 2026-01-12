# Postmortem: Duplicate projects/workspaces due to missing dedupe rules

## Summary

The system could show duplicate workspaces or duplicate projects when:

- loading persisted state containing repeated worktree paths
- adding the same GitHub repository via different local paths/remotes

## Severity

**Sev-2 (High)**: duplicates confuse users, break strict UI selectors, and can lead to actions being applied to the wrong workspace.

## Impact

- Repeated/duplicate workspaces in the UI.
- Duplicate projects for the same underlying GitHub repository.
- E2E tests became more brittle when duplicates appeared.

## Detection

- User report about repeated data.
- Engine/domain tests were added to cover normalization and reuse logic.

## Root cause

1. Persistence load path did not dedupe workspaces by normalized worktree path.
2. Project addition logic did not canonicalize and reuse existing projects when the GitHub repo id matched.

## Triggering commits (introduced by)

- `62aa6b0` introduced persistence behaviors that could surface duplicates on load (the load path did not enforce uniqueness).
- Project add logic existed prior to reuse-by-repo-id support; duplicates were possible depending on how projects were added.

## Fix commits (resolved/mitigated by)

- `c3eed50`:
  - dedupes workspaces by normalized worktree path on load
  - prefers main name when duplicates exist
- `1a2981e`:
  - extracts GitHub repo identity from remotes when possible
  - reuses an existing project when a GitHub repo match is found
  - adds engine-level tests for reuse behavior

## Reproduction steps

### Duplicate workspaces on load

1. Persist app state with the same worktree path duplicated (e.g., through legacy import or corruption).
2. Restart the app.
3. Observe multiple workspace entries pointing to the same path.

### Duplicate projects for the same GitHub repo

1. Add a project by local path.
2. Add another project pointing to a different path or remote representation of the same GitHub repo.
3. Observe two projects for the same repository.

## Resolution

Establish canonical identity:

- workspace uniqueness: normalized worktree path
- project reuse: GitHub repo id (when discoverable), otherwise normalized local path

## Lessons learned

- Dedupe rules are correctness rules. They belong in domain/persistence and must be tested.

## Prevention / action items

1. Define and document identity keys for projects and workspaces.
2. Add invariant tests:
   - no duplicate workspaces by normalized path after load
   - no duplicate projects when GitHub repo id matches
3. Add observability for dedupe events (e.g., logs/metrics) to detect recurring corruption.

