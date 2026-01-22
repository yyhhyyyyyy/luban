# C-HTTP-THREADS

Status: Draft
Verification: Mock=yes, Provider=yes, CI=no

## Surface

- Method: `GET`
- Path: `/api/workspaces/{workspace_id}/threads`

## Purpose

List thread metadata and tab state for a workspace.

Thread titles are user-facing and should be short:

- Default title is `"Thread {thread_id}"`.
- After the first user message, the provider may update the title based on:
  - A deterministic first-line derivation (immediate).
  - An asynchronous AI-generated title (may arrive later).
- Titles should be limited to `40` Unicode scalar values.

## Parameters

- `workspace_id`: integer path parameter

## Response

- `200 OK`
- JSON body: `ThreadsSnapshot`

## Invariants

- The response must be deserializable into `ThreadsSnapshot`.
- Thread ordering must match the UI expectations documented in `docs/workspace-thread-tabs.md`.

## Web usage

- `web/lib/luban-http.ts` `fetchThreads(workspaceId)`
