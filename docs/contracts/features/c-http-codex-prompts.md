# C-HTTP-CODEX-PROMPTS

Status: Draft
Verification: Mock=yes, Provider=yes, CI=no

## Surface

- Method: `GET`
- Path: `/api/codex/prompts`

## Purpose

List user-editable prompt templates for Codex CLI integration.

## Response

- `200 OK`
- JSON body: `CodexCustomPromptSnapshot[]`

## Invariants

- Each item must have a stable `id` within the resolved Codex root.

## Web usage

- `web/lib/luban-http.ts` `fetchCodexCustomPrompts()`
