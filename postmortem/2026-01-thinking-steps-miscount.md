# Postmortem: Incorrect counting of "thinking steps" due to TODO list parsing

## Summary

The UI/runtime attempted to count "thinking steps" from agent outputs. A TODO list format was mistakenly interpreted as "thinking" steps, leading to incorrect counts. Subsequent fixes oscillated between counting and not counting TODO items.

## Severity

**Sev-4 (Low)**: metrics/UI display bug; no correctness impact on task execution.

## Impact

- Incorrect "thinking steps" numbers displayed to the user.

## Detection

- Observed during formatting improvements and metrics review.

## Root cause

The heuristic used to classify lines as "thinking steps" was too permissive and treated TODO list items as equivalent to thinking steps.

## Triggering commits (introduced by)

- `5555663` started counting TODO items as thinking steps.

## Fix commits (resolved/mitigated by)

- `bc6d13d` stopped counting TODO list items as thinking steps.

## Reproduction steps

1. Produce an agent output containing a TODO list.
2. Observe the thinking-step count changes unexpectedly.

## Resolution

Refine the heuristic to exclude TODO list items and keep the definition of "thinking steps" narrow and stable.

## Lessons learned

- Heuristics for user-facing metrics need explicit definitions and regression tests.

## Prevention / action items

1. Add tests that cover representative output formats (plain text, markdown lists, TODO lists).
2. Document the definition of "thinking steps" and the supported formats.

