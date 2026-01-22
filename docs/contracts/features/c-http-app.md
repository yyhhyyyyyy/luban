# C-HTTP-APP

Status: Draft
Verification: Mock=yes, Provider=yes, CI=no

## Surface

- Method: `GET`
- Path: `/api/app`

## Purpose

Hydrate the UI with the latest `AppSnapshot`.

## Response

- `200 OK`
- JSON body: `AppSnapshot` (see `crates/luban_api::AppSnapshot`)

## Invariants

- The response must be valid JSON and deserializable into `AppSnapshot`.
- `rev` must be monotonically increasing over time (within a single server instance).

## Web usage

- `web/lib/luban-http.ts` `fetchApp()`
- Playwright E2E uses it as a readiness/hydration primitive.
