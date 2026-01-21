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

## Current Status (2026-01-21)

Implemented:

- `crates/luban_domain/src/agent_thread.rs`: exported `AgentThreadEvent` and related types.
- `crates/luban_domain/src/adapters.rs`: `ProjectWorkspaceService::run_agent_turn_streamed` now streams `AgentThreadEvent`.
- `crates/luban_backend/src/services/amp_cli.rs`: Amp `--stream-json` parser and runner.
- `crates/luban_backend/src/services.rs`: backend runner selection via `LUBAN_AGENT_RUNNER=amp`.

Environment variables:

- `LUBAN_AGENT_RUNNER`: `codex` (default) or `amp`.
- `LUBAN_AMP_BIN`: optional absolute path to the `amp` executable (defaults to `amp` on `PATH`).
- `LUBAN_AMP_MODE`: optional Amp mode value passed via `--mode` (e.g., `smart`, `free`).

Known limitations:

- Amp runner does not support image attachments yet (returns an error if images are present).
- Amp stream parsing is intentionally tolerant; we may need to adjust mapping once we capture more
  real-world stream variants.

## How to Verify

- Run unit tests:
  - `just test-fast`
- Run full checks:
  - `just fmt && just lint && just test`

Manual smoke steps:

1. Start the server (existing workflow):
   - `just run-server`
2. Set `LUBAN_AGENT_RUNNER=amp` and restart the server process.
3. Open the web UI and send a message in a workspace thread.
4. Confirm:
   - activities appear as tool calls / reasoning
   - a final assistant message is recorded

## Next Steps

- Add a first-class "agent id" into run config and UI selector (align with `design/`).
- Extend the Amp mapping to recognize common tools (bash/file edit/search) as dedicated activity
  kinds where possible.
- Decide how to represent token usage for non-Codex runners.

## Change Log

- 2026-01-21: Introduced `AgentThreadEvent` and added Amp `--stream-json` normalization.
- 2026-01-21: Updated `ProjectWorkspaceService` to stream `AgentThreadEvent`.
