"use client"

import type { AppSnapshot } from "./luban-api"
import {
  kanbanColumns,
  agentStatusFromWorkspace,
  kanbanColumnForWorktree,
  prStatusFromWorkspace,
  type KanbanColumn,
  type AgentStatus,
  type PRStatus,
} from "./worktree-ui"

export type KanbanWorktreeVm = {
  id: string
  name: string
  projectName: string
  agentStatus: AgentStatus
  prStatus: PRStatus
  prNumber?: number
  prTitle?: string
  workspaceId: number
}

export type KanbanBoardVm = {
  worktrees: KanbanWorktreeVm[]
  worktreesByColumn: Record<KanbanColumn, KanbanWorktreeVm[]>
}

export function buildKanbanWorktrees(app: AppSnapshot | null): KanbanWorktreeVm[] {
  if (!app) return []
  const out: KanbanWorktreeVm[] = []
  for (const p of app.projects) {
    for (const w of p.workspaces) {
      if (w.status !== "active") continue
      const agentStatus = agentStatusFromWorkspace(w)
      const pr = prStatusFromWorkspace(w)
      out.push({
        id: w.short_id,
        name: w.branch_name,
        projectName: p.slug,
        agentStatus,
        prStatus: pr.status,
        prNumber: pr.prNumber,
        prTitle: pr.prState === "merged" ? "Merged" : undefined,
        workspaceId: w.id,
      })
    }
  }
  return out
}

export function groupKanbanWorktreesByColumn(
  worktrees: KanbanWorktreeVm[],
): Record<KanbanColumn, KanbanWorktreeVm[]> {
  return kanbanColumns.reduce(
    (acc, col) => {
      acc[col.id] = worktrees.filter(
        (w) => kanbanColumnForWorktree({ agentStatus: w.agentStatus, prStatus: w.prStatus }) === col.id,
      )
      return acc
    },
    {} as Record<KanbanColumn, KanbanWorktreeVm[]>,
  )
}

export function buildKanbanBoardVm(app: AppSnapshot | null): KanbanBoardVm {
  const worktrees = buildKanbanWorktrees(app)
  return { worktrees, worktreesByColumn: groupKanbanWorktreesByColumn(worktrees) }
}
