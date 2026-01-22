# Agent Thread Events (Multi-Agent Normalization)

## Context

Luban currently renders and persists agent activity as a stream of Codex-style events
(`item.started`, `item.updated`, `item.completed`, `turn.*`, etc). This works well for Codex CLI,
but it blocks multi-agent support because other CLIs (for example Amp) emit different streaming
shapes.

The goal of this work is to introduce a single canonical event model (`AgentThreadEvent`) and
normalize all agent runners into that model.

## Goals / Success Criteria

- One canonical event stream type for the server and UI (`AgentThreadEvent`).
- Each agent runner converts its native stream into `AgentThreadEvent`.
- Conversation persistence continues to work without database migrations.
- The web UI continues to render activities from the normalized events.

## Key Decisions

### 1) Canonical schema is Codex-compatible (initially)

To avoid a high-risk database migration, `luban_domain::AgentThreadEvent` is initially implemented
as a type alias over the existing Codex event schema (same serde tags and payload shapes).

This keeps:

- persisted JSON entries backward-compatible
- in-memory reducer logic unchanged
- the web UI rendering unchanged

We can later evolve the schema (e.g., make usage optional, add agent identity, etc.) with an
explicit compatibility strategy.

### 2) Amp integration uses `--stream-json`

Amp is integrated via `amp --execute ... --stream-json`, and its Claude Code-compatible JSON Lines
stream is translated into the canonical event model.

For server stability:

- Amp is run with `--no-notifications --no-ide --no-jetbrains` to avoid interactive/IDE coupling.
- Amp is run with `--dangerously-allow-all` so the server never blocks on interactive approvals.

### 3) Amp config root follows XDG conventions

The Amp configuration root is resolved using the following precedence:

1. `LUBAN_AMP_ROOT` (explicit override)
2. `$XDG_CONFIG_HOME/amp`
3. `$HOME/.config/amp`

For tests, the default root is `.amp` to keep filesystem fixtures local.

All config file operations are restricted to a relative path under the resolved root, and the
backend ignores symlinks in directory listings.

## Current Status (2026-01-22)

Implemented:

- `crates/luban_domain/src/agent_thread.rs`: exported `AgentThreadEvent` and related types.
- `crates/luban_domain/src/adapters.rs`: `ProjectWorkspaceService::run_agent_turn_streamed` now streams `AgentThreadEvent`.
- `crates/luban_backend/src/services/amp_cli.rs`: Amp `--stream-json` parser and runner.
- `crates/luban_backend/src/services/amp_cli.rs`: common Amp tools are normalized (bash/web_search/file edits).
- `crates/luban_domain/src/state.rs`: persisted default runner and Amp mode (`agent_default_runner`, `agent_amp_mode`).
- `crates/luban_backend/src/sqlite_store.rs`: stored default runner and Amp mode in `app_settings_text`.
- `crates/luban_backend/src/services.rs`: runner selection driven by request config (with env overrides).
- `web/components/settings-panel.tsx`: UI controls to select default runner; Amp mode is configured in the Amp panel.
- `crates/luban_backend/src/services.rs`: Amp config root resolution and file operations (`amp_check`, `amp_config_*`).
- `crates/luban_api/src/lib.rs`: Amp config protocol (`AmpConfigEntrySnapshot` and request/ready events).
- `crates/luban_server/src/engine.rs`: Amp config action routing over WebSocket.
- `web/components/settings-panel.tsx`: Amp config editor UI (check, browse tree, read/write).
- `web/lib/luban-api.ts`: Amp config request/response types for the UI.
- `web/lib/luban-actions.ts`: Amp config request helpers.
- `web/lib/luban-transport.ts`: Amp config ready event routing for request responses.
- `web/components/feedback-modal.tsx`: feedback flow can start a "Fix it" run using the default agent in the current thread.
- `web/components/sidebar.tsx`: feedback modal entry aligned to design.

Environment variables (overrides):

- `LUBAN_AGENT_RUNNER`: `codex` (default) or `amp`.
- `LUBAN_AMP_BIN`: optional absolute path to the `amp` executable (defaults to `amp` on `PATH`).
- `LUBAN_AMP_MODE`: optional Amp mode value passed via `--mode` (configured in Settings -> Agent -> Amp).
- `LUBAN_AMP_ROOT`: optional override for the Amp config root directory.

Known limitations:

- Amp runner forwards attachments by injecting `@/path/to/file` references into the prompt.
- Amp stream parsing is intentionally tolerant; we may need to adjust mapping once we capture more
  real-world stream variants.
- Tool name normalization is heuristic and based on Amp built-in tool names.

## How to Verify

- Run unit tests:
  - `just test-fast`
- Run full checks:
  - `just fmt && just lint && just test`

Manual smoke steps:

1. Start the server (existing workflow):
   - `just run-server`
2. Open the web UI, then open Settings.
3. In Settings -> Agent:
   - set Default Runner to Amp
4. In Settings -> Agent:
   - expand Amp settings
   - set Amp Mode
   - click "Check" to validate `amp --version`
   - open and edit a config file, confirm it is saved
5. Send a message in a workspace thread.
6. Confirm:
   - activities appear as tool calls / reasoning
   - a final assistant message is recorded
7. Open the feedback modal from the sidebar, paste an image, click "Fix it", and confirm a new agent run starts in the active thread.

## Next Steps

- Add per-thread runner selection (optional) without breaking persistence.
- Extend the Amp mapping to recognize common tools (bash/file edit/search) as dedicated activity
  kinds where possible.
- Decide how to represent token usage for non-Codex runners.

## Change Log

- 2026-01-21: Introduced `AgentThreadEvent` and added Amp `--stream-json` normalization.
- 2026-01-21: Updated `ProjectWorkspaceService` to stream `AgentThreadEvent`.
- 2026-01-21: Mapped Amp tool_use/tool_result to richer items (bash/web_search/file changes).
- 2026-01-21: Persisted default runner and Amp mode; added UI controls and request-driven runner selection.
- 2026-01-22: Enabled Amp image attachments by prompt `@path` injection.
- 2026-01-22: Forwarded all attachment kinds to Codex and Amp via context blob paths.
- 2026-01-22: Added Amp config APIs mirroring the Codex config module.
- 2026-01-22: Added Amp config settings UI mirroring the Codex config editor.
- 2026-01-22: Added feedback modal aligned to design; "Fix it" uses the default agent in the active thread.
- 2026-01-22: Moved Amp mode control into the Amp settings panel.
