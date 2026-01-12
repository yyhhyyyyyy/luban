# Postmortem: Terminal clipboard shortcuts (Cmd/Ctrl+C/V) behaved unexpectedly

## Summary

The web terminal (PTY backed by `ghostty-web`) did not provide terminal-like clipboard behavior for `Cmd/Ctrl+C` and `Cmd/Ctrl+V` consistently across browser and Tauri. Multiple iterations attempted to fix copy/paste, and the incident exposed a fragile interaction surface between:

- non-native terminal selection (not a DOM selection)
- clipboard APIs with platform/permission differences
- event propagation ordering between app code and `ghostty-web`

## Severity

**Sev-2 (High)**: the terminal is a core workflow surface; clipboard behavior being wrong causes repeated user friction and reduces trust in the tool.

## Impact

- `Cmd/Ctrl+C` did not reliably copy selected terminal text.
- `Cmd/Ctrl+V` did not reliably paste clipboard text into the PTY input stream.
- In some environments, pasting resulted in unexpected characters rather than the intended clipboard text.

## Detection

- Manual testing in both browser and Tauri (user report).
- Playwright E2E added coverage for paste-on-PTY socket frames but could not validate full OS clipboard behavior.

## Root cause

1. `ghostty-web` selection is internal to the terminal renderer; the browser copy pipeline does not see it. As a result, `Cmd/Ctrl+C` requires explicit handling to copy `term.getSelection()` rather than relying on native DOM selection.
2. The paste path depends on receiving a `paste` event with `clipboardData`. This can differ by environment and focus target.
3. Implementations that intercept `paste` too early (capture + stop propagation) can prevent `ghostty-web` from observing the event, while relying solely on `ghostty-web` leaves gaps for `Cmd+C` selection copy.

## Triggering commits (introduced by)

- `a343f74` removed the wrapper-level clipboard handling and relied on `ghostty-web` defaults, which does not provide terminal-selection copy via `Cmd/Ctrl+C`.
- `a3b4fd0` introduced wrapper-level intercepts for copy/paste, but the event strategy proved brittle across environments and required further iteration.

## Fix commits (resolved/mitigated by)

- `a3b4fd0` implemented wrapper intercepts (copy selection; paste -> PTY input; context menu behavior) and added an E2E regression test for paste frames.
- `b7120c4` made the terminal container focusable to reduce focus-related paste misses.
- `a343f74` reverted to `ghostty-web` defaults (later found to not meet expectations for `Cmd/Ctrl+C`).
- `397fc88` implemented explicit `Cmd/Ctrl+C` selection copy and a `Cmd/Ctrl+V` fallback path using `navigator.clipboard.readText()` when a paste event does not occur.

## Reproduction steps

1. Open any workspace with a running PTY terminal.
2. Generate output (e.g. run `echo "hello"`).
3. Select a substring in the terminal using mouse selection.
4. Press `Cmd+C` (macOS) or `Ctrl+C` (Windows/Linux).
5. Paste into another editor: expected the selected text; observed empty or unexpected clipboard content.
6. Copy any text from an external source and focus the terminal.
7. Press `Cmd+V` / `Ctrl+V`: expected text to be sent to PTY; observed no input or unexpected characters.

## Resolution

The current mitigation is to explicitly implement terminal-like clipboard semantics at the app layer:

- Copy: only intercept `Cmd/Ctrl+C` when the terminal has an internal selection; copy `term.getSelection()` to the system clipboard.
- Paste: prefer the native `paste` event (works with both browser and `ghostty-web`), and add a fallback that reads clipboard text in a microtask if a `paste` event does not arrive for a `Cmd/Ctrl+V` gesture.

## Lessons learned

- Terminal selection is not DOM selection; `Cmd/Ctrl+C` must be intentionally supported and tested.
- Clipboard behavior is platform-dependent; relying on a single API path (`paste` only or `readText` only) is insufficient.
- Event propagation ordering matters; avoid capture-phase listeners that stop propagation unless the ownership model is explicit and tested.

## Prevention / action items

1. Add explicit acceptance criteria for terminal clipboard behavior (copy selection, paste clipboard, and interaction with `Ctrl+C` interrupt).
2. Expand E2E tests:
   - Keep the PTY frame assertion for paste.
   - Add a UI-level copy test if a deterministic clipboard mocking strategy is possible in the test environment.
3. Document the event ownership contract in `web/components/pty-terminal.tsx` (who handles what and why).
4. When changing terminal input/selection behavior, require manual validation in both browser and Tauri.

