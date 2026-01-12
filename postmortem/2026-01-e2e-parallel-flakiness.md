# Postmortem: Playwright E2E failures due to shared state and parallelism

## Summary

`just test-ui` became flaky and/or failed deterministically due to tests running in parallel while sharing a single application instance and persistent workspace/project state. Strict Playwright locators and text-based assertions amplified the problem.

## Severity

**Sev-3 (Medium)**: CI and local verification were blocked intermittently; users could not trust E2E results.

## Impact

- E2E failures such as:
  - strict mode violations (multiple matching elements for a selector)
  - timeouts waiting for hidden/occluded elements
  - false negatives due to cross-test message history

## Detection

- `just test-ui` failures after adding terminal regression coverage.

## Root cause

1. Playwright config allowed full parallelism (`fullyParallel: true`) while the tests interact with global/shared application state.
2. The E2E helper `ensureWorkspace` used broad selectors that were vulnerable to:
   - multiple projects with similar names
   - multiple messages matching the same substring across test runs
3. Some interactions targeted a non-clickable descendant (`thread-tab-title` span) rather than the clickable tab container.

## Triggering commits (introduced by)

- Pre-existing test architecture: shared server/home directory with multiple workers.
- `web/playwright.config.ts` with `fullyParallel: true` (no single introducing commit identified; it was present prior to the incident window).

## Fix commits (resolved/mitigated by)

- `6051e9d`:
  - Set `fullyParallel: false` to reduce shared-state concurrency.
  - Tightened selectors to use `exact: true` where appropriate.
  - Made chat E2E assertions less dependent on global ordering.
- `0489744`:
  - Stabilized workspace selection and chat scroll assertions.
  - Avoided waiting for hidden elements by improving click targeting in helpers.

## Reproduction steps

1. Run `just test-ui` repeatedly.
2. Observe intermittent failures such as strict locator matches and timeouts.

## Resolution

The suite was stabilized by treating the E2E environment as a shared-state system:

- disable full parallelism for the spec suite
- avoid ambiguous text selectors
- use unique markers for test payloads
- poll for asynchronous scroll settling rather than single-shot assertions

## Lessons learned

- E2E suites that share a single stateful backend must either isolate state per worker or avoid parallel execution.
- Strict locators are a feature, not a nuisance; failures reveal underlying ambiguity that should be fixed.

## Prevention / action items

1. Introduce per-test or per-worker isolation for home/db directories if parallelism is required.
2. Prefer `data-testid` selectors and unique run markers for message-based assertions.
3. Keep helper functions responsible for producing a stable, visible UI state (including scroll and tab focus).

