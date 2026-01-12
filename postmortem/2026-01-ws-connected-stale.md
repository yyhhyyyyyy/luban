# Postmortem: WebSocket connection state was not propagated to UI

## Summary

The UI connection state (`wsConnected`) became stale because a provider refactor stopped exposing the transport's connection flag to the rest of the app.

## Severity

**Sev-3 (Medium)**: connection indicators and any reconnect-dependent behavior could be incorrect.

## Impact

- UI could display incorrect online/offline state.
- Reconnect flows could behave unexpectedly if gated on `wsConnected`.

## Detection

- Observed during UI alignment and reconnection behavior testing.

## Root cause

`useLubanTransport()` returned `{ wsConnected, sendAction, request }`, but the provider stored it as a single `transport` object and later only forwarded methods, not the connection state.

## Triggering commits (introduced by)

- `ca804fa` refactored `LubanProvider` to use `useLubanTransport` but did not plumb `wsConnected`.

## Fix commits (resolved/mitigated by)

- `2e19684` destructured `{ wsConnected, sendAction, request }` and returned the correct `wsConnected` through context.

## Reproduction steps

1. Simulate a websocket disconnect/reconnect.
2. Observe the UI does not reflect the actual connection state.

## Resolution

Always treat connection state as first-class data alongside transport methods and ensure it is forwarded through context.

## Lessons learned

- Provider refactors can silently drop important state fields when switching from object forwarding to method forwarding.

## Prevention / action items

1. Add a unit test (or lightweight UI test) asserting the provider updates `wsConnected` when the transport reconnects.
2. Prefer typed return values for hooks and avoid partial forwarding unless explicitly verified.

