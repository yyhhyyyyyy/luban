"use client"

import type { WorkspaceSnapshot } from "./luban-api"

export type WorktreeStatus =
  | "idle"
  | "agent-running"
  | "agent-done"
  | "pr-ci-running"
  | "pr-ci-passed-review"
  | "pr-ci-passed-merge"
  | "pr-merged"
  | "pr-ci-failed"

export type KanbanColumn = "backlog" | "running" | "pending" | "reviewing" | "done"

export const kanbanColumns: { id: KanbanColumn; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "text-status-idle" },
  { id: "running", label: "Running", color: "text-status-running" },
  { id: "pending", label: "Pending", color: "text-status-warning" },
  { id: "reviewing", label: "Reviewing", color: "text-status-info" },
  { id: "done", label: "Done", color: "text-status-success" },
]

export function kanbanColumnForStatus(status: WorktreeStatus): KanbanColumn {
  switch (status) {
    case "idle":
      return "backlog"
    case "agent-running":
      return "running"
    case "agent-done":
      return "pending"
    case "pr-ci-running":
      return "reviewing"
    case "pr-ci-passed-review":
      return "reviewing"
    case "pr-ci-passed-merge":
      return "done"
    case "pr-merged":
      return "done"
    case "pr-ci-failed":
      return "pending"
    default:
      return "backlog"
  }
}

export function worktreeStatusFromWorkspace(workspace: WorkspaceSnapshot): {
  status: WorktreeStatus
  prNumber?: number
} {
  if (workspace.agent_run_status === "running") return { status: "agent-running" }
  if (workspace.has_unread_completion) return { status: "agent-done" }

  const pr = workspace.pull_request
  if (!pr) return { status: "idle" }
  if (pr.state === "merged") return { status: "pr-merged", prNumber: pr.number }
  if (pr.state !== "open") return { status: "idle" }
  if (pr.ci_state === "failure") return { status: "pr-ci-failed", prNumber: pr.number }
  if (pr.ci_state === "pending" || pr.ci_state == null) return { status: "pr-ci-running", prNumber: pr.number }
  if (pr.merge_ready) return { status: "pr-ci-passed-merge", prNumber: pr.number }
  return { status: "pr-ci-passed-review", prNumber: pr.number }
}
