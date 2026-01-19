"use client"

import type React from "react"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRight,
  ChevronDown,
  FolderGit2,
  LayoutGrid,
  Loader2,
  Send,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useLuban } from "@/lib/luban-context"
import { fetchCodexCustomPrompts, fetchConversation, fetchThreads, uploadAttachment } from "@/lib/luban-http"
import { buildMessages, type Message } from "@/lib/conversation-ui"
import type { CodexCustomPromptSnapshot, ConversationEntry, ConversationSnapshot } from "@/lib/luban-api"
import { ConversationView } from "@/components/conversation-view"
import { AgentStatusIcon, PRBadge } from "@/components/shared/status-indicator"
import { CodexAgentSelector } from "@/components/shared/agent-selector"
import { openSettingsPanel } from "@/lib/open-settings"
import { buildKanbanBoardVm, type KanbanWorktreeVm } from "@/lib/kanban-view-model"
import { kanbanColumns, type KanbanColumn } from "@/lib/worktree-ui"
import { pickThreadId } from "@/lib/thread-ui"
import { MessageEditor, type ComposerAttachment } from "@/components/shared/message-editor"

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
        isSelected ? "shadow-lg shadow-primary/20 bg-accent/50 border-primary/50" : "hover:bg-accent/30",
      )}
    >
      <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
        <FolderGit2 className="w-3 h-3" />
        <span className="text-xs">{worktree.projectName}</span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <AgentStatusIcon status={worktree.agentStatus} size="md" />
        <span className="text-sm font-medium truncate flex-1">{worktree.name}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/50 font-mono">{worktree.id}</span>
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
  const { app, sendAgentMessageTo, setChatModel, setThinkingEffort } = useLuban()

  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<number | null>(null)
  const [conversation, setConversation] = useState<ConversationSnapshot | null>(null)
  const [codexCustomPrompts, setCodexCustomPrompts] = useState<CodexCustomPromptSnapshot[]>([])
  const seqRef = useRef(0)

  const messages: Message[] = useMemo(() => buildMessages(conversation), [conversation])
  const messageHistory = useMemo(() => {
    const entries = conversation?.entries ?? []
    const isUserMessage = (
      entry: (typeof entries)[number],
    ): entry is Extract<(typeof entries)[number], { type: "user_message" }> => entry.type === "user_message"
    const items = entries
      .filter(isUserMessage)
      .map((entry) => entry.text)
      .filter((text) => text.trim().length > 0)
    return items.slice(-50)
  }, [conversation?.entries])

  useEffect(() => {
    void fetchCodexCustomPrompts()
      .then((prompts) => setCodexCustomPrompts(prompts))
      .catch((err) => {
        console.warn("failed to load codex prompts:", err)
        setCodexCustomPrompts([])
      })
  }, [])

  useEffect(() => {
    const workspaceId = worktree.workspaceId
    const seq = (seqRef.current += 1)

    setIsLoading(true)
    setError(null)
    setConversation(null)
    setThreadId(null)
    setInput("")
    setAttachments([])

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

  const canSend = useMemo(() => {
    if (threadId == null) return false
    const hasUploading = attachments.some((a) => a.status === "uploading")
    if (hasUploading) return false
    const hasReady = attachments.some((a) => a.status === "ready" && a.attachment != null)
    return input.trim().length > 0 || hasReady
  }, [attachments, input, threadId])

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return
    if (threadId == null) return

    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith("image/")
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const initial: ComposerAttachment = {
        id,
        type: isImage ? "image" : "file",
        name: file.name,
        size: file.size,
        status: "uploading",
      }

      if (isImage) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const preview = typeof e.target?.result === "string" ? e.target.result : undefined
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, preview } : a)))
        }
        reader.readAsDataURL(file)
      }

      setAttachments((prev) => [...prev, initial])

      void uploadAttachment({ workspaceId: worktree.workspaceId, file, kind: isImage ? "image" : "file" })
        .then((attachment) => {
          const previewUrl =
            isImage
              ? `/api/workspaces/${worktree.workspaceId}/attachments/${attachment.id}?ext=${encodeURIComponent(attachment.extension)}`
              : undefined
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === id ? { ...a, status: "ready", attachment, name: attachment.name, previewUrl } : a,
            ),
          )
        })
        .catch(() => {
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "failed" } : a)))
        })
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (threadId == null) return
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems = Array.from(items).filter((item) => item.type.startsWith("image/"))
    if (imageItems.length === 0) return

    e.preventDefault()
    const dt = new DataTransfer()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (file) dt.items.add(file)
    }
    handleFileSelect(dt.files)
  }

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleCommand = (commandId: string) => {
    const match = codexCustomPrompts.find((p) => p.id === commandId) ?? null
    if (!match) return
    setInput(match.contents)
  }

  const handleSend = () => {
    if (!canSend || threadId == null) return
    const text = input.trim()
    const ready = attachments
      .filter((a) => a.status === "ready" && a.attachment != null)
      .map((a) => a.attachment!)
    setInput("")
    setAttachments([])
    sendAgentMessageTo(worktree.workspaceId, threadId, text, ready)
    setConversation((prev) => {
      if (!prev) return prev
      const entry: ConversationEntry = { type: "user_message", text, attachments: ready }
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
            <ArrowRight className="w-4 h-4" />
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
        <MessageEditor
          value={input}
          onChange={setInput}
          attachments={attachments}
          onRemoveAttachment={handleRemoveAttachment}
          onFileSelect={handleFileSelect}
          onPaste={handlePaste}
          workspaceId={worktree.workspaceId}
          commands={codexCustomPrompts}
          messageHistory={messageHistory}
          onCommand={handleCommand}
          placeholder="Let's chart the cosmos of ideas..."
          disabled={threadId == null}
          agentSelector={
            <CodexAgentSelector
              dropdownPosition="top"
              disabled={threadId == null}
              modelId={conversation?.agent_model_id}
              thinkingEffort={conversation?.thinking_effort}
              defaultModelId={app?.agent.default_model_id ?? null}
              defaultThinkingEffort={app?.agent.default_thinking_effort ?? null}
              onOpenAgentSettings={(agentId, agentFilePath) =>
                openSettingsPanel("agent", { agentId, agentFilePath })
              }
              onChangeModelId={(modelId) => {
                if (threadId == null) return
                setChatModel(worktree.workspaceId, threadId, modelId)
              }}
              onChangeThinkingEffort={(effort) => {
                if (threadId == null) return
                setThinkingEffort(worktree.workspaceId, threadId, effort)
              }}
            />
          }
          primaryAction={{
            onClick: handleSend,
            disabled: !canSend,
            ariaLabel: "Send message",
            icon: <Send className="w-3.5 h-3.5" />,
          }}
          testIds={{
            textInput: "kanban-preview-input",
            attachInput: "kanban-preview-attach-input",
            attachButton: "kanban-preview-attach",
            attachmentTile: "kanban-preview-attachment-tile",
          }}
        />
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
    <div data-testid="kanban-board" className="flex-1 flex bg-background overflow-hidden">
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
            <span data-testid="kanban-active-count" className="text-xs text-muted-foreground">
              {allWorktrees.length} active worktrees
            </span>
          </div>
        </div>

        <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
          {kanbanColumns.map((column) => (
            <div key={column.id} data-testid={`kanban-column-${column.id}`} className="flex-shrink-0 w-72 flex flex-col">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className={cn("text-sm font-medium", column.color)}>{column.label}</span>
                <span
                  data-testid={`kanban-column-count-${column.id}`}
                  className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                >
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
