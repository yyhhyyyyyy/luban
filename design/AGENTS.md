# Luban Design - AGENTS.md

This repository is a design system demo in the form of a high-fidelity AI IDE mock. The top priority is visual and interaction consistency, not business logic.

## Project Rules

### Scope

- No backend logic.
- No real APIs.
- All data is mocked and hard-coded.
- State is local-only (prefer `useState` / `useMemo` / `useEffect`).
- Prioritize interaction fidelity (hover, expand/collapse, micro motion) over data correctness.

### Source Of Truth

- Global tokens and theme live in `app/globals.css`.
- Do not introduce a second global stylesheet directory.
- Shared cross-panel concepts must be defined once and imported (see `components/shared/`).

### Typography Contract (Do Not Break)

- `app/layout.tsx` must load fonts via `next/font/google` and attach the `.variable` classes on the `<html>` element.
- `app/globals.css` must map `--font-sans`, `--font-mono`, `--font-serif` to those injected variables.
- Font family intent: Inter (sans), Geist Mono (mono), Source Serif 4 (serif).
- Treat this as an implicit dependency chain even if TypeScript imports look unused.

## Component Structure

```
components/
├── agent-ide.tsx       # Root view switch (workspace / kanban)
├── sidebar.tsx         # Left sidebar: projects + worktrees
├── chat-panel.tsx      # Center: chat, tabs, activity stream, diff viewer
├── right-sidebar.tsx   # Right sidebar: terminal/context/changes
└── kanban-board.tsx    # Kanban view + preview panel
components/shared/
├── activity-item.tsx   # Activity stream primitives
├── chat-message.ts     # Shared message type
└── worktree.ts         # Shared worktree types
```

## Design Principles

### Tokens And Theme

- Use CSS variables for tokens (`--primary`, `--background`, `--foreground`, etc.).
- Support light/dark via the `.dark` class.
- Primary tone is blue (`#3b82f6`) unless explicitly redesigning the palette.
- Merge Tailwind classes via `cn()`.

### State Design

- Worktree state: `idle` | `running` | `pending`.
- PR/CI state: `none` | `ci-running` | `ci-passed` | `review-pending` | `ready-to-merge` | `ci-failed`.
- Keep state strings as kebab-case unions and reuse shared types.

### Interaction Modes

- View switch: Workspace ↔ Kanban.
- Sidebar: expandable/collapsible project tree.
- Tabs: multiple tabs, close, restore recently closed.
- Activity stream: expandable history (thinking, tool, file edits, bash, search).
- Kanban: clicking cards shows a preview panel.

### Naming

- Components: PascalCase (e.g. `ChatPanel`, `KanbanBoard`).
- Files: kebab-case (e.g. `chat-panel.tsx`, `kanban-board.tsx`).
- Types: PascalCase (e.g. `Worktree`, `ChatMessage`, `ActivityEvent`).
- State values: kebab-case string unions.

## UI Conventions

- Icons: typically `w-3 h-3` or `w-4 h-4`.
- Text sizes: `text-xs`, `text-[13px]`, `text-sm`.
- Radius: prefer `rounded`, `rounded-lg`, `rounded-full`.
- Motion: prefer `transition-colors` / `transition-all`.
- Hover: use `group` + `group-hover:*` for layered affordances.

## Space Optimization

- Progressive disclosure: keep defaults compact, expand on focus/hover (e.g. show toolbar only when focused).
- Conditional rendering: only show controls when needed (e.g. scroll-to-bottom button only when not at bottom).
- Vertical layering: use negative margins plus `z-*` for stacked affordances where it reduces height.

## Dropdown Menus

- Large menus (e.g. tab list): title area with `text-[10px] uppercase tracking-wider`, grouped sections.
- Small selectors (e.g. model picker): no title, direct list.
- Style: `bg-card`, `rounded-lg`, `shadow-xl`.
- Selected state: `bg-primary/10 text-primary`.
- Use a fixed backdrop to close: `<div className="fixed inset-0 z-40" onClick={close} />`.

## Hover And Layering

- Floating gradients: `bg-gradient-to-t from-background via-background to-transparent`.
- Use shadow tiers to indicate elevation: `shadow-sm` / `shadow-lg` / `shadow-xl`.
- For floating overlays: outer container `pointer-events-none`, inner interactive area `pointer-events-auto`.

## Spacing And Alignment

- Keep idle states vertically symmetric to avoid visual imbalance.
- Prefer removing dividers over keeping misaligned ones.
- Use conditional classes for state-dependent spacing.

## Focus Management

- When clicking controls near inputs, use `onMouseDown={(e) => e.preventDefault()}` to avoid unwanted blur.
- When a dropdown is open, keep related UI visible (e.g. toolbars should not collapse on blur).
- Use `useRef` + `useEffect` to track scroll positions and expand/collapse state when needed.

## Mock Data Guidelines

- Mock data should feel realistic (IDs, timestamps, filenames, PR numbers).
- Keep mock data stable and deterministic unless randomness is intentionally part of the UI.
- Prefer placing shared mock data next to the shared types it exercises.

## Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm start
pnpm exec tsc --noEmit
```

## Maintenance Checklist

- Keep tokens consistent: do not fork or rename CSS variables without updating all usages.
- Avoid duplicating types across panels.
- Keep components locally understandable and independently editable.
- Dependency pruning is allowed, but must keep `pnpm build` and `pnpm exec tsc --noEmit` green.
