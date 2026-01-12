"use client"

import type { AppSnapshot, OperationStatus } from "./luban-api"
import { worktreeStatusFromWorkspace, type WorktreeStatus } from "./worktree-ui"

export type SidebarWorktreeVm = {
  id: string
  name: string
  isHome: boolean
  status: WorktreeStatus
  prNumber?: number
  workspaceId: number
}

export type SidebarProjectVm = {
  id: number
  name: string
  expanded: boolean
  createWorkspaceStatus: OperationStatus
  worktrees: SidebarWorktreeVm[]
}

export function buildSidebarProjects(app: AppSnapshot | null): SidebarProjectVm[] {
  if (!app) return []
  return app.projects.map((p) => ({
    id: p.id,
    name: p.slug,
    expanded: p.expanded,
    createWorkspaceStatus: p.create_workspace_status,
    worktrees: p.workspaces
      .filter((w) => w.status === "active")
      .map((w) => {
        const mapped = worktreeStatusFromWorkspace(w)
        return {
          id: w.short_id,
          name: w.branch_name,
          isHome: w.workspace_name === "main",
          status: mapped.status,
          prNumber: mapped.prNumber,
          workspaceId: w.id,
        }
      }),
  }))
}

