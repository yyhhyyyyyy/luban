# Claude Code Integration

This document describes how Luban runs Claude Code (`claude`) and maps streamed events into the chat UI.

## Executable discovery

- Default: `claude` in `PATH`.
- Override: set `LUBAN_CLAUDE_BIN` to an absolute path.

## Config root

The Settings panel exposes a filesystem-backed config editor rooted at:

- Default: `$HOME/.claude`
- Override: set `LUBAN_CLAUDE_ROOT` to an absolute path.

## Streaming mode

Luban runs Claude Code in non-interactive print mode and reads stdout line-by-line:

- `--print`
- `--output-format stream-json`
- `--include-partial-messages`

The `stream-json` output is normalized into the canonical internal event stream (`AgentThreadEvent`).

## Permissions and safety

Luban runs Claude Code with:

- `--permission-mode bypassPermissions`

This is required to avoid interactive permission prompts that would otherwise block the server.
It is powerful and should only be used in local, trusted environments.

## Conversation continuity

Luban stores the Claude Code `session_id` emitted by the `system.init` event as the conversation's
`remote_thread_id`, and passes it back via `--resume` on subsequent turns.

## Attachments

Attachments are copied into the workspace context store and referenced by absolute path in the prompt.
When attachments exist, Luban also adds the context blob directory to Claude Code's allowed tool roots via `--add-dir`.

## Known limitations

- The `remote_thread_id` storage is shared across agent runners. Switching runners inside the same thread may cause the
  new runner to start a fresh session (or fail to resume, depending on the upstream CLI behavior).
