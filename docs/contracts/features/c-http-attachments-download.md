# C-HTTP-ATTACHMENTS-DOWNLOAD

Status: Draft
Verification: Mock=yes, Provider=yes, CI=no

## Surface

- Method: `GET`
- Path: `/api/workspaces/{workspace_id}/attachments/{attachment_id}`

## Purpose

Download a previously uploaded attachment.

## Query (optional)

- `ext`: string (file extension hint used by the UI)

## Response

- `200 OK`
- Body: attachment bytes

## Notes

- The UI may use direct links or `fetch` depending on the rendering path.
- In mock mode, attachments are resolved to `data:` / `blob:` URLs and do not hit this HTTP endpoint.
