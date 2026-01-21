"use client"

import type React from "react"
import { Circle, Loader2, MessageCircle, CheckCircle2, XCircle, Clock, GitMerge } from "lucide-react"
import { cn } from "@/lib/utils"

export type AgentStatus = "idle" | "running" | "pending"
export type PRStatus = "none" | "ci-running" | "ci-passed" | "review-pending" | "ready-to-merge" | "ci-failed"

// Agent status config (left side - worktree work state)
export const agentStatusConfig: Record<
  AgentStatus,
  {
    icon: React.ElementType
    color: string
    label: string
    animate?: boolean
  }
> = {
  idle: {
    icon: Circle,
    color: "text-status-idle",
    label: "Idle",
  },
  running: {
    icon: Loader2,
    color: "text-status-running",
    label: "Running",
    animate: true,
  },
  pending: {
    icon: MessageCircle,
    color: "text-status-warning",
    label: "Awaiting read",
  },
}

// PR/CI status config (right side - code flow state)
export const prStatusConfig: Record<
  PRStatus,
  {
    icon: React.ElementType
    color: string
    label: string
    animate?: boolean
  }
> = {
  none: {
    icon: Circle,
    color: "text-transparent",
    label: "",
  },
  "ci-running": {
    icon: Loader2,
    color: "text-status-warning",
    label: "CI Running",
    animate: true,
  },
  "ci-passed": {
    icon: CheckCircle2,
    color: "text-status-success",
    label: "CI Passed",
  },
  "review-pending": {
    icon: Clock,
    color: "text-status-info",
    label: "In Review",
  },
  "ready-to-merge": {
    icon: GitMerge,
    color: "text-status-success",
    label: "Ready to merge",
  },
  "ci-failed": {
    icon: XCircle,
    color: "text-status-error",
    label: "CI Failed",
  },
}

interface AgentStatusIconProps {
  status: AgentStatus
  size?: "xs" | "sm" | "md"
  className?: string
}

export function AgentStatusIcon({ status, size = "sm", className }: AgentStatusIconProps) {
  const config = agentStatusConfig[status]
  const Icon = config.icon
  const iconSize = size === "xs" ? "w-3 h-3" : size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"

  return (
    <span className={cn("relative flex items-center justify-center flex-shrink-0", config.color, className)}>
      <Icon className={cn(iconSize, config.animate && "animate-spin")} />
      {status === "pending" && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-status-warning rounded-full" />
      )}
    </span>
  )
}

interface PRBadgeProps {
  status: PRStatus
  prNumber?: number
  prUrl?: string
  ciUrl?: string
  size?: "sm" | "md"
}

export function PRBadge({ status, prNumber, prUrl, ciUrl, size = "sm" }: PRBadgeProps) {
  if (status === "none" || !prNumber) {
    return null
  }

  const config = prStatusConfig[status]
  const Icon = config.icon
  const iconSize = size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3"

  const handlePrClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (prUrl) window.open(prUrl, "_blank")
  }

  const handleCiClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (ciUrl) window.open(ciUrl, "_blank")
  }

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <button
        onClick={handlePrClick}
        className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
        title={`Open PR #${prNumber}`}
      >
        #{prNumber}
      </button>
      {status === "ci-failed" ? (
        <button onClick={handleCiClick} title="CI failed - Click to view">
          <Icon className={cn(iconSize, config.color, "hover:opacity-80 transition-opacity")} />
        </button>
      ) : (
        <Icon className={cn(iconSize, config.color, config.animate && "animate-spin")} title={config.label} />
      )}
    </div>
  )
}
