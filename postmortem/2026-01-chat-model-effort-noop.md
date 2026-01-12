# Postmortem: Model and effort selectors were non-functional (no-op buttons)

## Summary

The UI displayed model and thinking-effort controls, but clicking them had no effect. The controls looked interactive but did not update application state.

## Severity

**Sev-3 (Medium)**: configuration controls were broken; users could not change model/effort from the UI.

## Impact

- Users could not adjust the agent model or effort level per thread/workspace via the UI.
- This reduced usability and led to confusion (UI suggested capability that did not work).

## Detection

- User report after UI refactors.

## Root cause

The controls were rendered as buttons with `onMouseDown` only (preventing focus changes) but no `onClick` handler or state wiring. This is a classic "UI present but not wired" regression.

## Triggering commits (introduced by)

- `8165659` introduced the UI controls during a refactor, but did not implement the click wiring and dropdown behavior.

## Fix commits (resolved/mitigated by)

- `c267663`:
  - added explicit dropdown UIs for model and effort
  - wired actions (`setChatModel`, `setThinkingEffort`) through `useLuban()`
  - constrained effort options based on the selected model

## Reproduction steps

1. Open a workspace with an active thread.
2. Click the model selector button.
3. Observe no dropdown and no state change.

## Resolution

Implement the control surface end-to-end: UI state (dropdown open/close), model list, effort list, and action wiring into the store.

## Lessons learned

- UI parity work must include interaction wiring; a visual refactor is incomplete if it breaks configuration paths.

## Prevention / action items

1. Add Playwright coverage that changes model/effort and asserts the UI reflects the new selection.
2. Prefer to keep such controls in a small, testable component with explicit props and callbacks.

