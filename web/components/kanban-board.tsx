"use client"

import type React from "react"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRight,
  Brain,
  ChevronDown,
  FolderGit2,
  LayoutGrid,
  Loader2,
  Send,
  Settings2,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useLuban } from "@/lib/luban-context"
import { fetchConversation, fetchThreads } from "@/lib/luban-http"
import { agentModelLabel, buildMessages, thinkingEffortLabel, type Message } from "@/lib/conversation-ui"
import type { ConversationEntry, ConversationSnapshot } from "@/lib/luban-api"
import { ConversationView } from "@/components/conversation-view"
import { AgentStatusIcon, PRBadge } from "@/components/shared/status-indicator"
import { buildKanbanBoardVm, type KanbanWorktreeVm } from "@/lib/kanban-view-model"
import { kanbanColumns, type KanbanColumn } from "@/lib/worktree-ui"
import { pickThreadId } from "@/lib/thread-ui"

type Worktree = KanbanWorktreeVm

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
  return (
    <div
      onClick={onClick}
      className={cn(
        "group p-3 rounded-lg border border-border cursor-pointer transition-all",
        isSelected ? "shadow-lg shadow-primary/20 bg-accent/50 border-primary/50" : "hover:bg-accent/50",
      )}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <FolderGit2 className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">{worktree.projectName}</span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <AgentStatusIcon status={worktree.agentStatus} size="md" />
        <span className="text-sm font-medium truncate flex-1">{worktree.name}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/50 font-mono">{worktree.id}</span>
        <PRBadge
          status={worktree.prStatus}
          prNumber={worktree.prNumber}
          workspaceId={worktree.workspaceId}
          onOpenPullRequest={onOpenPullRequest}
          onOpenPullRequestFailedAction={onOpenPullRequestFailedAction}
          titleOverride={worktree.prTitle}
        />
      </div>
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
        const preferred = snap.tabs?.active_tab ?? null
        return pickThreadId({ threads, preferredThreadId: preferred })
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
          <AgentStatusIcon status={worktree.agentStatus} size="md" />
          <span className="text-sm font-medium truncate">{worktree.projectName}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-xs text-muted-foreground">{worktree.name}</span>
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
        <div className="py-4 px-4">
          <div className="space-y-4">
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

            <ConversationView
              messages={messages}
              workspaceId={worktree.workspaceId}
              emptyState={
                !isLoading && !error ? (
                  <div className="text-xs text-muted-foreground">No conversation yet.</div>
                ) : null
              }
            />

            {worktree.agentStatus === "running" && (
              <div className="flex items-center gap-2 py-2 px-2 rounded text-xs text-primary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Agent is working...</span>
              </div>
            )}
          </div>
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

  const board = useMemo(() => buildKanbanBoardVm(app), [app])
  const allWorktrees = board.worktrees
  const worktreesByColumn = board.worktreesByColumn as Record<KanbanColumn, Worktree[]>

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
          {kanbanColumns.map((column) => (
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
