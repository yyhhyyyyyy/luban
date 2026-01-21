import type { AgentStatus, PRStatus } from "./status-indicator"

export interface Worktree {
  id: string
  name: string
  isHome?: boolean
  agentStatus: AgentStatus
  prStatus: PRStatus
  prNumber?: number
  prUrl?: string
  ciUrl?: string
}

export interface WorktreeWithProject extends Worktree {
  projectName: string
}

