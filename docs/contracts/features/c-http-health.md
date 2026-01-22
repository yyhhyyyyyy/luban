# C-HTTP-HEALTH

Status: Draft
Verification: Mock=n/a, Provider=yes, CI=no

## Surface

- Method: `GET`
- Path: `/api/health`

## Purpose

Provide a cheap liveness check for local development and tests.

## Response

- `200 OK`
- Body: `ok` (plain text)

## Notes

- This contract is intentionally minimal and stable.

