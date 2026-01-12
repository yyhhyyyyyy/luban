"use client"

import type React from "react"

import { CheckCircle2, Circle, Clock, GitPullRequest, Loader2, MessageCircle, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import type { WorktreeStatus } from "@/lib/worktree-ui"

export function statusLabel(status: WorktreeStatus): string {
  switch (status) {
    case "idle":
      return "Idle"
    case "agent-running":
      return "Running"
    case "agent-done":
      return "Awaiting review"
    case "pr-ci-running":
      return "CI running"
    case "pr-ci-passed-review":
      return "In review"
    case "pr-ci-passed-merge":
      return "Ready to merge"
    case "pr-merged":
      return "Merged"
    case "pr-ci-failed":
      return "CI failed"
  }
}

const statusConfig: Record<
  WorktreeStatus,
  {
    icon: React.ElementType
    color: string
    bgColor: string
    label: string
    animate?: boolean
  }
> = {
  idle: {
    icon: Circle,
    color: "text-status-idle",
    bgColor: "",
    label: "Idle",
  },
  "agent-running": {
    icon: Loader2,
    color: "text-status-running",
    bgColor: "bg-status-running/10",
    label: "Running",
    animate: true,
  },
  "agent-done": {
    icon: MessageCircle,
    color: "text-status-warning",
    bgColor: "bg-status-warning/10",
    label: "Awaiting review",
  },
  "pr-ci-running": {
    icon: GitPullRequest,
    color: "text-status-running",
    bgColor: "bg-status-info/10",
    label: "CI Running",
  },
  "pr-ci-passed-review": {
    icon: GitPullRequest,
    color: "text-status-info",
    bgColor: "bg-status-info/10",
    label: "In Review",
  },
  "pr-ci-passed-merge": {
    icon: GitPullRequest,
    color: "text-status-success",
    bgColor: "bg-status-success/10",
    label: "Ready to merge",
  },
  "pr-merged": {
    icon: GitPullRequest,
    color: "text-status-success",
    bgColor: "bg-status-success/10",
    label: "Merged",
  },
  "pr-ci-failed": {
    icon: GitPullRequest,
    color: "text-status-error",
    bgColor: "bg-status-error/10",
    label: "CI Failed",
  },
}

export function getStatusBgColor(status: WorktreeStatus): string {
  return statusConfig[status].bgColor
}

export function StatusIndicator({
  status,
  prNumber,
  workspaceId,
  size = "sm",
  showLabel = false,
  onOpenPullRequest,
  onOpenPullRequestFailedAction,
}: {
  status: WorktreeStatus
  prNumber?: number
  workspaceId?: number
  size?: "sm" | "md"
  showLabel?: boolean
  onOpenPullRequest?: (workspaceId: number) => void
  onOpenPullRequestFailedAction?: (workspaceId: number) => void
}) {
  const config = statusConfig[status]
  const Icon = config.icon
  const iconSize = size === "sm" ? "w-3 h-3" : "w-4 h-4"
  const smallIconSize = size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3"

  const canOpenPr = workspaceId != null && onOpenPullRequest != null
  const canOpenCi = workspaceId != null && onOpenPullRequestFailedAction != null

  const handlePrClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!canOpenPr || workspaceId == null) return
    onOpenPullRequest(workspaceId)
  }

  const handleCiClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!canOpenCi || workspaceId == null) return
    onOpenPullRequestFailedAction(workspaceId)
  }

  if (status === "idle" || status === "agent-running" || status === "agent-done") {
    return (
      <span className={cn("flex items-center gap-1.5 flex-shrink-0", config.color)}>
        <span className="relative">
          <Icon className={cn(smallIconSize, config.animate && "animate-spin")} />
          {status === "agent-done" && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-status-warning rounded-full" />
          )}
        </span>
        {showLabel && <span className="text-xs">{config.label}</span>}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <button
        onClick={handlePrClick}
        disabled={!canOpenPr}
        className={cn(
          "flex items-center gap-1 text-xs hover:opacity-80 transition-opacity",
          config.color,
          !canOpenPr && "opacity-70 cursor-default hover:opacity-70",
        )}
        title={prNumber != null ? `Open PR #${prNumber}` : "Open PR"}
      >
        <GitPullRequest className={iconSize} />
        <span>#{prNumber}</span>
      </button>

      {status === "pr-ci-running" && <Loader2 className={cn(smallIconSize, "text-status-warning animate-spin")} />}
      {status === "pr-ci-passed-review" && (
        <span title="Waiting for review">
          <Clock className={cn(smallIconSize, "text-status-warning")} />
        </span>
      )}
      {status === "pr-ci-passed-merge" && (
        <span title="Ready to merge">
          <CheckCircle2 className={cn(smallIconSize, "text-status-success")} />
        </span>
      )}
      {status === "pr-merged" && (
        <span title="Merged">
          <CheckCircle2 className={cn(smallIconSize, "text-status-success")} />
        </span>
      )}
      {status === "pr-ci-failed" && (
        <button
          onClick={handleCiClick}
          disabled={!canOpenCi}
          className={cn(!canOpenCi && "opacity-70 cursor-default")}
          title="CI failed - Click to view"
        >
          <XCircle className={cn(smallIconSize, "text-status-error hover:opacity-80 transition-opacity")} />
        </button>
      )}
    </div>
  )
}
