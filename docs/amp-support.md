# Amp Support

## Goal

Integrate `amp` as an agent runner alongside Codex, with a single attachment model shared across runners, and a per-turn override mechanism for Amp mode (`smart` / `rush`).

## Decisions

- Amp mode is configured via Amp config files (edited in the Amp config panel).
  - The Settings panel does not expose a dedicated Amp mode input.
- Precedence for resolving Amp mode:
  1. `LUBAN_AMP_MODE` environment variable
  2. Per-turn override from the agent picker (`smart` / `rush`)
  3. Detect from Amp config files under the Amp config root (`LUBAN_AMP_ROOT` or OS default)
- The agent picker supports selecting the runner for a single message:
  - Runner: Default / Codex / Amp
  - Amp mode: Default / Smart / Rush (only when runner resolves to Amp)

## Progress

- [x] Add per-turn runner and Amp mode overrides to send/queue actions.
- [x] Resolve default Amp mode from Amp config files.
- [x] Update chat agent picker to allow selecting Amp and overriding mode per turn.
- [ ] Ensure all user entry points (e.g. queued prompt editor) can pick Amp and mode consistently.

## Verification

- `just fmt && just lint && just test`
- Manual smoke:
  1. `just run-server`
  2. Open Settings -> Agent and set Default Runner to Amp (optional).
  3. Send a message and select `Amp` + `Smart` (or `Rush`) from the agent picker.
  4. Verify the run starts and produces agent events and a final response.

