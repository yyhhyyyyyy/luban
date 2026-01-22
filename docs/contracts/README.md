# Contracts (Web <-> Server)

This directory contains consumer-driven contracts (CDC) that define the integration surface between:

- the browser UI (`web/`) as the consumer
- the local Rust server (`crates/luban_server`) as the provider

The goal is to make UI-first iteration cheap while keeping integration correct and reviewable.

## Principles

- Contracts are **explicit artifacts**: they are reviewed like code.
- Contracts are **consumer-driven**: the UI defines what it needs.
- Contracts must be **testable**: providers must pass contract checks in CI.
- Contracts should be **stable and additive**: prefer backward-compatible evolution.

## Layout

- `docs/contracts/progress.md`: cross-cutting tracker (what exists, what is verified).
- `docs/contracts/features/*.md`: one contract per user-visible interaction surface.

## Contract lifecycle

When adding or changing a user-visible interaction:

1. Update or add a contract under `docs/contracts/features/`.
2. Update mock-mode behavior in `web/` to satisfy the contract.
3. Implement server behavior in `crates/luban_server` to satisfy the contract.
4. Add/extend provider contract tests so CI enforces the contract.

## Local workflow

### Preview UI in mock mode

- `just web dev-mock`

### Develop against the real server

- `just web run` (single process, same-origin `/api/*`)

### Keep contracts aligned

When changing the web/server boundary (HTTP routes, WS paths, or message schemas), update:

- `docs/contracts/features/*`
- `docs/contracts/progress.md`

The repository enforces basic contract coverage via tests:

- `just test` (includes contract coverage checks)

## Status fields

Each feature contract should include:

- `Status`: `Draft` | `Stable`
- `Verification`:
  - `Mock`: whether mock mode implements it
  - `Provider`: whether the Rust server implements it
  - `CI`: whether provider contract tests enforce it
