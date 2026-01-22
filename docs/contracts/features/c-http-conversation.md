# C-HTTP-CONVERSATION

Status: Draft
Verification: Mock=yes, Provider=yes, CI=no

## Surface

- Method: `GET`
- Path: `/api/workspaces/{workspace_id}/conversations/{thread_id}`

## Purpose

Paginated read for a single conversation thread.

## Parameters

- `workspace_id`: integer path parameter
- `thread_id`: integer path parameter

## Query

- `limit`: integer (default is controlled by the web UI)
- `before`: integer (optional pagination cursor)

## Response

- `200 OK`
- JSON body: `ConversationSnapshot`

## Invariants

- Pagination must be stable (no duplicates across pages for the same cursor).
- Entries must remain in a deterministic order.

## Web usage

- `web/lib/luban-http.ts` `fetchConversation(workspaceId, threadId, { before?, limit? })`
