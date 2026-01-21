"use client"
import { useState } from "react"
import {
  FolderGit2,
  LayoutGrid,
  ChevronDown,
  X,
  ArrowRight,
  FileCode,
  Brain,
  Wrench,
  Clock,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { AgentStatusIcon, PRBadge } from "./shared/status-indicator"
import { ActivityStream } from "./shared/activity-item"
import type { ChatMessage as Message, MessageAttachment } from "./shared/chat-message"
import { MessageEditor } from "./shared/message-editor"
import type { WorktreeWithProject as Worktree } from "./shared/worktree"

type KanbanColumn = "backlog" | "running" | "pending" | "reviewing" | "done"

const columns: { id: KanbanColumn; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "text-status-idle" },
  { id: "running", label: "Running", color: "text-status-running" },
  { id: "pending", label: "Pending", color: "text-status-warning" },
  { id: "reviewing", label: "Reviewing", color: "text-status-info" },
  { id: "done", label: "Done", color: "text-status-success" },
]

function getColumnForWorktree(worktree: Worktree): KanbanColumn {
  // Agent status takes priority for running/pending
  if (worktree.agentStatus === "running") return "running"
  if (worktree.agentStatus === "pending") return "pending"

  // Then check PR status
  switch (worktree.prStatus) {
    case "ci-running":
    case "ci-passed":
    case "review-pending":
      return "reviewing"
    case "ready-to-merge":
      return "done"
    case "ci-failed":
      return "pending"
    default:
      return "backlog"
  }
}

const allWorktrees: Worktree[] = [
  { id: "lb02", name: "typical-inch", projectName: "luban", agentStatus: "running", prStatus: "none" },
  {
    id: "lb03",
    name: "scroll-fix",
    projectName: "luban",
    agentStatus: "idle",
    prStatus: "ci-running",
    prNumber: 1234,
    prUrl: "https://github.com/user/luban/pull/1234",
  },
  {
    id: "lb04",
    name: "auth-refactor",
    projectName: "luban",
    agentStatus: "idle",
    prStatus: "review-pending",
    prNumber: 1201,
    prUrl: "https://github.com/user/luban/pull/1201",
  },
  {
    id: "ld02",
    name: "perf-opt",
    projectName: "lance-duckdb",
    agentStatus: "idle",
    prStatus: "ci-failed",
    prNumber: 89,
    prUrl: "https://github.com/user/lance-duckdb/pull/89",
    ciUrl: "https://github.com/user/lance-duckdb/actions/runs/123456",
  },
  { id: "bg02", name: "new-post", projectName: "blog", agentStatus: "pending", prStatus: "none" },
  {
    id: "of02",
    name: "mount-impl",
    projectName: "opendalfs",
    agentStatus: "idle",
    prStatus: "ready-to-merge",
    prNumber: 456,
    prUrl: "https://github.com/user/opendalfs/pull/456",
  },
  { id: "od02", name: "feature-x", projectName: "opendal", agentStatus: "idle", prStatus: "none" },
  { id: "gg02", name: "bugfix-123", projectName: "gpui-ghostty", agentStatus: "idle", prStatus: "none" },
]

const samplePreviewMessages: Message[] = [
  {
    id: "1",
    type: "assistant",
    content: `**实现要点**

• 在 chat_target_changed 时强制 follow=true + 安排一次 "scroll to bottom"
• 移除切换时保存/恢复滚动位置的逻辑

**改动位置**`,
    activities: [
      { id: "a1", type: "thinking", title: "Analyzing scroll behavior", status: "done", duration: "12s" },
      { id: "a2", type: "file_edit", title: "crates/luban_ui/src/root.rs", status: "done", duration: "8s" },
    ],
    metadata: { toolCalls: 18, thinkingSteps: 32, duration: "7m36s" },
    codeReferences: [{ file: "crates/luban_ui/src/root.rs", line: 377 }],
  },
  {
    id: "2",
    type: "user",
    content: `图片渲染问题需要修复`,
  },
]

function WorktreeCard({
  worktree,
  isSelected,
  onClick,
}: { worktree: Worktree; isSelected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group p-3 rounded-lg border border-border cursor-pointer transition-all",
        isSelected ? "shadow-lg shadow-primary/20 bg-accent/50 border-primary/50" : "hover:bg-accent/30",
      )}
    >
      {/* Top row: project name */}
      <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
        <FolderGit2 className="w-3 h-3" />
        <span className="text-xs">{worktree.projectName}</span>
      </div>

      {/* Main row: status icon + branch name */}
      <div className="flex items-center gap-2 mb-2">
        <AgentStatusIcon status={worktree.agentStatus} size="md" />
        <span className="text-sm font-medium truncate flex-1">{worktree.name}</span>
      </div>

      {/* Bottom row: ID + PR badge */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/50 font-mono">{worktree.id}</span>
        <PRBadge
          status={worktree.prStatus}
          prNumber={worktree.prNumber}
          prUrl={worktree.prUrl}
          ciUrl={worktree.ciUrl}
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
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])

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
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-4 px-4 space-y-4">
          {samplePreviewMessages.map((message) => (
            <div key={message.id}>
              {message.type === "assistant" ? (
                <div className="space-y-2">
                  {message.activities && <ActivityStream activities={message.activities} compact />}

                  {message.content && (
                    <div className="text-sm leading-relaxed text-foreground/90 space-y-2">
                      {message.content.split("\n\n").map((paragraph, idx) => (
                        <div key={idx}>
                          {paragraph.startsWith("**") ? (
                            <p className="font-semibold text-foreground text-xs">{paragraph.replace(/\*\*/g, "")}</p>
                          ) : (
                            <div className="space-y-1">
                              {paragraph.split("\n").map((line, lineIdx) => (
                                <p key={lineIdx} className="flex items-start gap-2 text-xs">
                                  {line.startsWith("•") && (
                                    <>
                                      <span className="text-primary mt-0.5">•</span>
                                      <span>{line.slice(2)}</span>
                                    </>
                                  )}
                                  {!line.startsWith("•") && line}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {message.codeReferences && message.codeReferences.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {message.codeReferences.map((ref, idx) => (
                        <button
                          key={idx}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-muted/50 hover:bg-primary/10 hover:text-primary rounded text-xs font-mono text-muted-foreground transition-all"
                        >
                          <FileCode className="w-3 h-3" />
                          {ref.file.split("/").pop()}:{ref.line}
                        </button>
                      ))}
                    </div>
                  )}

                  {message.metadata && (
                    <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground/70">
                      {message.metadata.toolCalls && (
                        <span className="flex items-center gap-1">
                          <Wrench className="w-3 h-3" />
                          {message.metadata.toolCalls}
                        </span>
                      )}
                      {message.metadata.thinkingSteps && (
                        <span className="flex items-center gap-1">
                          <Brain className="w-3 h-3" />
                          {message.metadata.thinkingSteps}
                        </span>
                      )}
                      {message.metadata.duration && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {message.metadata.duration}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex justify-end">
                  <div className="max-w-[90%] border border-border rounded-lg px-2.5 py-2 bg-muted/30">
                    <p className="text-xs text-foreground">{message.content}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <MessageEditor
          value={input}
          onChange={setInput}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onSubmit={() => {
            console.log("Send:", input)
            setInput("")
            setAttachments([])
          }}
        />
      </div>
    </div>
  )
}

interface KanbanBoardProps {
  onViewModeChange: (mode: "workspace" | "kanban") => void
  onNavigateToWorktree?: (projectName: string, worktreeName: string) => void
}

export function KanbanBoard({ onViewModeChange, onNavigateToWorktree }: KanbanBoardProps) {
  const [selectedWorktree, setSelectedWorktree] = useState<Worktree | null>(null)

  const worktreesByColumn = columns.reduce(
    (acc, col) => {
      acc[col.id] = allWorktrees.filter((w) => getColumnForWorktree(w) === col.id)
      return acc
    },
    {} as Record<KanbanColumn, Worktree[]>,
  )

  const handleCardClick = (worktree: Worktree) => {
    setSelectedWorktree(worktree)
  }

  const handleNavigateToWorkspace = () => {
    if (selectedWorktree && onNavigateToWorktree) {
      onNavigateToWorktree(selectedWorktree.projectName, selectedWorktree.name)
    }
    onViewModeChange("workspace")
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

        {/* Kanban columns */}
        <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
          {columns.map((column) => (
            <div key={column.id} className="flex-shrink-0 w-72 flex flex-col">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className={cn("text-sm font-medium", column.color)}>{column.label}</span>
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {worktreesByColumn[column.id].length}
                </span>
              </div>

              <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
                {worktreesByColumn[column.id].map((worktree) => (
                  <WorktreeCard
                    key={worktree.id}
                    worktree={worktree}
                    isSelected={selectedWorktree?.id === worktree.id}
                    onClick={() => handleCardClick(worktree)}
                  />
                ))}
                {worktreesByColumn[column.id].length === 0 && (
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
