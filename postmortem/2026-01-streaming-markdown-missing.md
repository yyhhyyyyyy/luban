# Postmortem: Streaming markdown messages were not rendered until reload

## Summary

Assistant messages that arrived during an ongoing run (streaming) were not shown in the UI in real time. They appeared only after reopening or reloading the conversation.

## Severity

**Sev-2 (High)**: core chat UX was broken; users could not observe progress in real time.

## Impact

- The conversation view lagged behind the actual agent output.
- Users perceived the system as "stuck" even while work was ongoing.

## Detection

- User report: "new messages do not render until reopen".

## Root cause

`buildMessages()` constructed the visible message list primarily from persisted conversation entries. During a running turn, the backend also exposes a list of `in_progress_items`. For streaming `agent_message` items, those items were only present in `in_progress_items` and were not merged into the visible assistant message content.

## Triggering commits (introduced by)

- `57bd65a` (kanban implementation) introduced/relied on `in_progress_items` rendering but did not merge `agent_message` items into the assistant content.

## Fix commits (resolved/mitigated by)

- `3c17e36`:
  - tracks agent item ids already present in entries
  - merges `agent_message` items from `in_progress_items` into the assistant content
  - avoids duplicates when the same item exists in both places

## Reproduction steps

1. Start an agent run that streams output.
2. Observe that the assistant message content does not update in the UI.
3. Reload the page or reopen the workspace: the missing content appears.

## Resolution

Treat `in_progress_items` as a first-class input for the conversation UI while a run is active, and merge message items into the visible message list deterministically.

## Lessons learned

- State that is split across "persisted entries" vs "in-progress items" must be merged at the UI layer with clear precedence and de-duplication rules.

## Prevention / action items

1. Add a UI test that asserts streaming assistant content appears without a reload.
2. Document the message-building contract in `web/lib/conversation-ui.ts` (sources of truth and merge rules).

