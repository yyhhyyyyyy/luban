# C-HTTP-ATTACHMENTS-UPLOAD

Status: Draft
Verification: Mock=yes, Provider=yes, CI=no

## Surface

- Method: `POST`
- Path: `/api/workspaces/{workspace_id}/attachments`

## Purpose

Upload a single attachment to be referenced by chat messages.

## Request

Multipart form-data:

- `kind`: `AttachmentKind` (`image` | `text` | `file`)
- `file`: binary payload

## Response

- `200 OK`
- JSON body: `AttachmentRef`

## Web usage

- `web/lib/luban-http.ts` `uploadAttachment({ workspaceId, file, kind })`
