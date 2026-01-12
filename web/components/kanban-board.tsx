"use client"

import type React from "react"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LayoutGrid,
  Loader2,
  MessageCircle,
  Pencil,
  Send,
  Settings2,
  Terminal,
  Wrench,
  X,
  XCircle,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useLuban } from "@/lib/luban-context"
import { fetchConversation, fetchThreads } from "@/lib/luban-http"
import { agentModelLabel, buildMessages, thinkingEffortLabel, type ActivityEvent, type Message } from "@/lib/conversation-ui"
import { Markdown } from "@/components/markdown"
import type { ConversationEntry, ConversationSnapshot } from "@/lib/luban-api"

type WorktreeStatus =
  | "idle"
  | "agent-running"
  | "agent-done"
  | "pr-ci-running"
  | "pr-ci-passed-review"
  | "pr-ci-passed-merge"
  | "pr-ci-failed"

type KanbanColumn = "backlog" | "running" | "pending" | "reviewing" | "done"

const columns: { id: KanbanColumn; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "text-muted-foreground" },
  { id: "running", label: "Running", color: "text-blue-400" },
  { id: "pending", label: "Pending", color: "text-amber-400" },
  { id: "reviewing", label: "Reviewing", color: "text-purple-400" },
  { id: "done", label: "Done", color: "text-green-400" },
]

function getColumnForStatus(status: WorktreeStatus): KanbanColumn {
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
    case "pr-ci-failed":
      return "pending"
    default:
      return "backlog"
  }
}

function activeThreadKeyForWorkspace(workspaceId: number): string {
  return `luban:active_thread_id:${workspaceId}`
}

type Worktree = {
  id: string
  name: string
  projectName: string
  status: WorktreeStatus
  prNumber?: number
  workspaceId: number
}

function worktreeStatusFromWorkspace(w: {
  agent_run_status: "idle" | "running"
  has_unread_completion: boolean
  pull_request: { state: "open" | "closed" | "merged"; ci_state: "pending" | "success" | "failure" | null; merge_ready: boolean; number: number } | null
}): { status: WorktreeStatus; prNumber?: number } {
  if (w.agent_run_status === "running") return { status: "agent-running" }
  if (w.has_unread_completion) return { status: "agent-done" }

  const pr = w.pull_request
  if (!pr || pr.state !== "open") return { status: "idle" }
  if (pr.ci_state === "failure") return { status: "pr-ci-failed", prNumber: pr.number }
  if (pr.ci_state === "pending" || pr.ci_state == null) return { status: "pr-ci-running", prNumber: pr.number }
  if (pr.merge_ready) return { status: "pr-ci-passed-merge", prNumber: pr.number }
  return { status: "pr-ci-passed-review", prNumber: pr.number }
}

function StatusBadge({
  status,
  prNumber,
  workspaceId,
  onOpenPullRequest,
  onOpenPullRequestFailedAction,
}: {
  status: WorktreeStatus
  prNumber?: number
  workspaceId: number
  onOpenPullRequest: (workspaceId: number) => void
  onOpenPullRequestFailedAction: (workspaceId: number) => void
}) {
  const handlePrClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onOpenPullRequest(workspaceId)
  }

  const handleCiClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onOpenPullRequestFailedAction(workspaceId)
  }

  switch (status) {
    case "agent-running":
      return (
        <span className="flex items-center gap-1 text-[10px] text-blue-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          Agent running
        </span>
      )
    case "agent-done":
      return (
        <span className="flex items-center gap-1 text-[10px] text-amber-400">
          <MessageCircle className="w-3 h-3" />
          Awaiting review
        </span>
      )
    case "pr-ci-running":
      return (
        <button onClick={handlePrClick} className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300">
          <GitPullRequest className="w-3 h-3" />#{prNumber}
          <Loader2 className="w-2.5 h-2.5 animate-spin ml-1" />
        </button>
      )
    case "pr-ci-passed-review":
      return (
        <button onClick={handlePrClick} className="flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300">
          <GitPullRequest className="w-3 h-3" />#{prNumber}
          <Clock className="w-2.5 h-2.5 ml-1" />
        </button>
      )
    case "pr-ci-passed-merge":
      return (
        <button onClick={handlePrClick} className="flex items-center gap-1 text-[10px] text-green-400 hover:text-green-300">
          <GitPullRequest className="w-3 h-3" />#{prNumber}
          <CheckCircle2 className="w-2.5 h-2.5 ml-1" />
        </button>
      )
    case "pr-ci-failed":
      return (
        <div className="flex items-center gap-2">
          <button onClick={handlePrClick} className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300">
            <GitPullRequest className="w-3 h-3" />#{prNumber}
          </button>
          <button onClick={handleCiClick} className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300">
            <XCircle className="w-3 h-3" />
            CI Failed
          </button>
        </div>
      )
    default:
      return <span className="text-[10px] text-muted-foreground">Idle</span>
  }
}

function WorktreeCard({
  worktree,
  isSelected,
  onClick,
  onOpenPullRequest,
  onOpenPullRequestFailedAction,
}: {
  worktree: Worktree
  isSelected: boolean
  onClick: () => void
  onOpenPullRequest: (workspaceId: number) => void
  onOpenPullRequestFailedAction: (workspaceId: number) => void
}) {
  const statusColors: Record<WorktreeStatus, string> = {
    idle: "border-border",
    "agent-running": "border-blue-500/30 bg-blue-500/5",
    "agent-done": "border-amber-500/30 bg-amber-500/5",
    "pr-ci-running": "border-purple-500/30 bg-purple-500/5",
    "pr-ci-passed-review": "border-purple-500/30 bg-purple-500/5",
    "pr-ci-passed-merge": "border-green-500/30 bg-green-500/5",
    "pr-ci-failed": "border-red-500/30 bg-red-500/5",
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        "group p-3 rounded-lg border cursor-pointer transition-all",
        statusColors[worktree.status],
        isSelected ? "shadow-lg shadow-primary/20 bg-accent/50 border-primary/50" : "hover:bg-accent/50",
      )}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <FolderGit2 className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">{worktree.projectName}</span>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="w-3.5 h-3.5 text-foreground/70" />
        <span className="text-sm font-medium truncate">{worktree.name}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/50 font-mono">{worktree.id}</span>
        <StatusBadge
          status={worktree.status}
          prNumber={worktree.prNumber}
          workspaceId={worktree.workspaceId}
          onOpenPullRequest={onOpenPullRequest}
          onOpenPullRequestFailedAction={onOpenPullRequestFailedAction}
        />
      </div>
    </div>
  )
}

function ActivityEventItem({ event }: { event: ActivityEvent }) {
  const icon = (() => {
    switch (event.type) {
      case "thinking":
        return <Brain className="w-3.5 h-3.5" />
      case "file_edit":
        return <Pencil className="w-3.5 h-3.5" />
      case "bash":
        return <Terminal className="w-3.5 h-3.5" />
      case "search":
        return <Eye className="w-3.5 h-3.5" />
      case "tool_call":
        return <Wrench className="w-3.5 h-3.5" />
      case "complete":
        return <CheckCircle2 className="w-3.5 h-3.5" />
      default:
        return <Wrench className="w-3.5 h-3.5" />
    }
  })()

  return (
    <div className={cn("flex items-center gap-2 py-1 px-2 rounded text-xs", event.status === "running" ? "text-primary" : "text-muted-foreground")}>
      {event.status === "running" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      <span className="flex-1 truncate">{event.title}</span>
      {event.duration && <span className="text-[10px] text-muted-foreground/70">{event.duration}</span>}
    </div>
  )
}

function WorktreePreviewPanel({
  worktree,
  onClose,
  onNavigate,
}: {
  worktree: Worktree
  onClose: () => void
  onNavigate: () => void
}) {
  const { sendAgentMessageTo } = useLuban()

  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<number | null>(null)
  const [conversation, setConversation] = useState<ConversationSnapshot | null>(null)
  const seqRef = useRef(0)

  const messages: Message[] = useMemo(() => buildMessages(conversation), [conversation])
  const modelLabel = useMemo(() => agentModelLabel(conversation?.agent_model_id), [conversation?.agent_model_id])
  const effortLabel = useMemo(() => thinkingEffortLabel(conversation?.thinking_effort), [conversation?.thinking_effort])

  useEffect(() => {
    const workspaceId = worktree.workspaceId
    const seq = (seqRef.current += 1)

    setIsLoading(true)
    setError(null)
    setConversation(null)
    setThreadId(null)

    fetchThreads(workspaceId)
      .then((snap) => {
        if (seqRef.current !== seq) return null
        const threads = snap.threads ?? []
        if (threads.length === 0) return null

        const stored = Number(localStorage.getItem(activeThreadKeyForWorkspace(workspaceId)) ?? "")
        const storedOk = Number.isFinite(stored) && threads.some((t) => t.thread_id === stored)
        const picked = storedOk
          ? stored
          : threads.slice().sort((a, b) => (b.updated_at_unix_seconds ?? 0) - (a.updated_at_unix_seconds ?? 0))[0]
              ?.thread_id ?? null
        return picked
      })
      .then(async (pickedThreadId) => {
        if (seqRef.current !== seq) return
        if (pickedThreadId == null) {
          setThreadId(null)
          setConversation(null)
          return
        }
        setThreadId(pickedThreadId)
        const convo = await fetchConversation(workspaceId, pickedThreadId)
        if (seqRef.current !== seq) return
        setConversation(convo)
      })
      .catch((err: unknown) => {
        if (seqRef.current !== seq) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (seqRef.current !== seq) return
        setIsLoading(false)
      })
  }, [worktree.workspaceId])

  const canSend = input.trim().length > 0 && threadId != null

  const handleSend = () => {
    if (!canSend || threadId == null) return
    const text = input.trim()
    setInput("")
    sendAgentMessageTo(worktree.workspaceId, threadId, text)
    setConversation((prev) => {
      if (!prev) return prev
      const entry: ConversationEntry = { type: "user_message", text, attachments: [] }
      return { ...prev, entries: [...prev.entries, entry] }
    })
  }

  return (
    <div className="w-[420px] flex flex-col border-l border-border bg-background">
      <div className="h-11 px-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <FolderGit2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium truncate">{worktree.projectName}</span>
          <span className="text-muted-foreground">/</span>
          <div className="flex items-center gap-1 text-muted-foreground">
            <GitBranch className="w-3.5 h-3.5" />
            <span className="text-xs">{worktree.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onNavigate}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            title="Go to workspace"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            Open
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            aria-label="Close preview"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="py-4 px-4 space-y-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading...
            </div>
          )}
          {error && (
            <div className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {!isLoading && !error && messages.length === 0 && (
            <div className="text-xs text-muted-foreground">No conversation yet.</div>
          )}

          {messages.map((message) => (
            <div key={message.id}>
              {message.type === "assistant" ? (
                <div className="space-y-2">
                  {message.activities && (
                    <div className="space-y-0.5">
                      {message.activities.map((event) => (
                        <ActivityEventItem key={event.id} event={event} />
                      ))}
                    </div>
                  )}

                  {message.content && message.content.length > 0 ? (
                    <div className="text-[13px] leading-relaxed text-foreground/90">
                      <Markdown content={message.content} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex justify-end">
                  <div className="max-w-[85%] border border-border rounded-lg px-3 py-2.5 bg-muted/30">
                    <div className="text-[13px] text-foreground space-y-1 break-words overflow-hidden">
                      {message.content.split("\n").map((line, idx) => (
                        <p key={idx} className="flex items-start gap-2 min-w-0">
                          {line.startsWith("•") ? (
                            <>
                              <span className="text-muted-foreground mt-0.5 flex-shrink-0">•</span>
                              <span className="flex-1 min-w-0 break-words">{line.slice(2)}</span>
                            </>
                          ) : (
                            <span className="flex-1 min-w-0 break-words">{line}</span>
                          )}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 mb-2">
          <button className="inline-flex items-center gap-1 px-1.5 py-0.5 hover:bg-muted rounded text-[10px] text-muted-foreground hover:text-foreground transition-colors">
            <Settings2 className="w-3 h-3" />
            {modelLabel}
          </button>
          <button className="inline-flex items-center gap-1 px-1.5 py-0.5 hover:bg-muted rounded text-[10px] text-muted-foreground hover:text-foreground transition-colors">
            <Brain className="w-3 h-3" />
            {effortLabel}
          </button>
        </div>
        <div className="flex items-center gap-2 bg-muted/30 rounded-lg border border-border focus-within:border-primary/50 transition-colors">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message..."
            className="flex-1 bg-transparent px-3 py-2 text-xs outline-none placeholder:text-muted-foreground/50"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleSend()
              }
            }}
            disabled={threadId == null}
          />
          <button
            className={cn("p-2 transition-colors", canSend ? "text-muted-foreground hover:text-primary" : "text-muted-foreground/50")}
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

interface KanbanBoardProps {
  onViewModeChange: (mode: "workspace" | "kanban") => void
}

export function KanbanBoard({ onViewModeChange }: KanbanBoardProps) {
  const { app, openWorkspace, openWorkspacePullRequest, openWorkspacePullRequestFailedAction } = useLuban()
  const [selectedWorktree, setSelectedWorktree] = useState<Worktree | null>(null)

  const allWorktrees = useMemo(() => {
    if (!app) return []
    const out: Worktree[] = []
    for (const p of app.projects) {
      for (const w of p.workspaces) {
        if (w.status !== "active") continue
        const mapped = worktreeStatusFromWorkspace(w)
        out.push({
          id: w.short_id,
          name: w.branch_name,
          projectName: p.slug,
          status: mapped.status,
          prNumber: mapped.prNumber,
          workspaceId: w.id,
        })
      }
    }
    return out
  }, [app])

  const worktreesByColumn = useMemo(() => {
    return columns.reduce(
      (acc, col) => {
        acc[col.id] = allWorktrees.filter((w) => getColumnForStatus(w.status) === col.id)
        return acc
      },
      {} as Record<KanbanColumn, Worktree[]>,
    )
  }, [allWorktrees])

  const handleNavigateToWorkspace = () => {
    const w = selectedWorktree
    if (!w) return
    void (async () => {
      await openWorkspace(w.workspaceId)
      onViewModeChange("workspace")
    })()
  }

  return (
    <div className="flex-1 flex bg-background overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-11 px-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => onViewModeChange("workspace")}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent transition-colors"
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="text-sm font-medium">Kanban</span>
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>
            <span className="text-xs text-muted-foreground">{allWorktrees.length} active worktrees</span>
          </div>
        </div>

        <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
          {columns.map((column) => (
            <div key={column.id} className="flex-shrink-0 w-72 flex flex-col">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className={cn("text-sm font-medium", column.color)}>{column.label}</span>
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {worktreesByColumn[column.id]?.length ?? 0}
                </span>
              </div>

              <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
                {(worktreesByColumn[column.id] ?? []).map((worktree) => (
                  <WorktreeCard
                    key={worktree.workspaceId}
                    worktree={worktree}
                    isSelected={selectedWorktree?.workspaceId === worktree.workspaceId}
                    onClick={() => setSelectedWorktree(worktree)}
                    onOpenPullRequest={openWorkspacePullRequest}
                    onOpenPullRequestFailedAction={openWorkspacePullRequestFailedAction}
                  />
                ))}
                {(worktreesByColumn[column.id] ?? []).length === 0 && (
                  <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border rounded-lg min-h-[100px]">
                    No items
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedWorktree && (
        <WorktreePreviewPanel
          worktree={selectedWorktree}
          onClose={() => setSelectedWorktree(null)}
          onNavigate={handleNavigateToWorkspace}
        />
      )}
    </div>
  )
}
