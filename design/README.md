# Luban Design

High-fidelity AI IDE mock used as a design system demo. The goal is consistent tokens, layout, and interaction patterns, not business logic.

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/xuanwos-projects-7aefa4a2/luban-design)

## What This Is

- A front-end only demo (no backend, no APIs).
- Deterministic mock data and UI state.
- A place to evolve tokens and interaction patterns with minimal churn.

## What This Is Not

- A production app.
- A real agent implementation.
- A data-driven system.

## Tech Stack

- Next.js 16 + React 19
- Tailwind CSS 4 + CSS variables
- shadcn/ui (New York style)
- lucide-react

## Quick Start

```bash
pnpm dev
```

## Workflow (Design-first UI)

- Treat this project as the interaction and visual source of truth.
- Commit `design/` changes first.
- Align `web/` by applying the `design` commit diff as the implementation checklist.

## Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm start
pnpm exec tsc --noEmit
```

## Structure

```
app/
  layout.tsx
  page.tsx
  globals.css
components/
  agent-ide.tsx
  sidebar.tsx
  chat-panel.tsx
  right-sidebar.tsx
  kanban-board.tsx
  shared/
lib/
  utils.ts
```

## Design System Contracts

- Tokens live in `app/globals.css` (single source of truth).
- Fonts are injected via `next/font/google` in `app/layout.tsx` and consumed via CSS variables in `app/globals.css`.
- Shared types for cross-panel concepts live in `components/shared/`.

## Notes

This repository is no longer synced with v0.app.
