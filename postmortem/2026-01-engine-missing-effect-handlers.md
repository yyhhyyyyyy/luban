# Postmortem: Domain effects existed but were not executed by the server engine

## Summary

Two user-facing features were effectively no-ops because the domain reducer emitted effects that the server engine did not execute:

1. "Open in editor"
2. "Archive worktree/workspace"

## Severity

**Sev-2 (High)**: core workflow actions silently failed with no meaningful feedback.

## Impact

- Clicking "Open in editor" did not open the workspace path in the configured editor.
- Archiving a worktree/workspace did not update the worktree status and did not run the underlying archive logic.

## Detection

- Manual verification and user report after UI migration.
- Domain unit tests existed that asserted effect emission, but no integration test asserted that effects were executed by the engine.

## Root cause

The architectural contract is:

- domain reducer: pure state transition + effect emission
- server engine: effect runner that actually performs side effects and dispatches follow-up actions/events

The contract was violated because the engine match arms for these effects were missing, so the effects were never executed.

## Triggering commits (introduced by)

- `fe03cf3` added/centralized the reducer that emits `Effect::OpenWorkspaceInIde` and `Effect::ArchiveWorkspace` (and had unit tests for the reducer), but the engine side did not implement corresponding runners.

## Fix commits (resolved/mitigated by)

- `6481652` implemented `Effect::OpenWorkspaceInIde` in `crates/luban_server/src/engine.rs`, including error feedback via toast and a follow-up action.
- `b4e52ae` implemented `Effect::ArchiveWorkspace` in `crates/luban_server/src/engine.rs`, ensuring the side effect runs and the workspace state transitions to archived.

## Reproduction steps

### Open in editor

1. Open a workspace UI.
2. Click the "Open in editor" button.
3. Observe that nothing happens (no editor opens, no error).

### Archive workspace

1. Open the workspace list.
2. Click "Archive worktree".
3. Observe that the worktree remains active and no archive operation occurs.

## Resolution

Implement effect runners in the engine to complete the domain/engine contract:

- execute side effects off the async runtime where appropriate (`spawn_blocking`)
- emit user-facing errors as toast events
- dispatch follow-up actions for state updates when needed

## Lessons learned

- Reducer unit tests are necessary but not sufficient; side-effect wiring must be covered by engine integration tests.
- For new `Effect` variants, the change should be considered incomplete until:
  - the engine runs the effect
  - and a test asserts that it does

## Prevention / action items

1. Add a checklist item: every new `Effect` must have an engine match arm and a test covering execution.
2. Consider making missing effect execution fail loudly in debug builds (e.g., a tracing error for unknown/unhandled effects).

