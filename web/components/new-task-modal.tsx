"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  GitPullRequest,
  Loader2,
  CirclePlus,
  Play,
  ChevronRight,
  Bug,
  Lightbulb,
  GitMerge,
  MessageSquare,
  Plus,
  Sparkles,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useLuban } from "@/lib/luban-context"
import type { TaskDraft, TaskExecuteMode, TaskIntentKind } from "@/lib/luban-api"

interface NewTaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function draftKeyForThread(workspaceId: number, threadId: number) {
  return `luban:draft:${workspaceId}:${threadId}`
}

function intentLabel(kind: TaskIntentKind): string {
  switch (kind) {
    case "fix_issue":
      return "Fix issue"
    case "implement_feature":
      return "Implement feature"
    case "review_pull_request":
      return "Review PR"
    case "resolve_pull_request_conflicts":
      return "Resolve PR conflicts"
    case "add_project":
      return "Add project"
    case "other":
      return "Other"
  }
}

export function NewTaskModal({ open, onOpenChange }: NewTaskModalProps) {
  const { previewTask, executeTask, openWorkspace } = useLuban()

  const [input, setInput] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [draft, setDraft] = useState<TaskDraft | null>(null)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [executingMode, setExecutingMode] = useState<TaskExecuteMode | null>(null)
  const seqRef = useRef(0)

  const canExecute = draft != null && draft.project.type !== "unspecified"

  useEffect(() => {
    if (!open) return
    const trimmed = input.trim()
    if (trimmed.length === 0) {
      setDraft(null)
      setPromptExpanded(false)
      setAnalysisError(null)
      return
    }

    const seq = (seqRef.current += 1)
    setIsAnalyzing(true)
    setPromptExpanded(false)
    setAnalysisError(null)

    const t = window.setTimeout(() => {
      previewTask(trimmed)
        .then((d) => {
          if (seqRef.current !== seq) return
          setDraft(d)
          setPromptExpanded(false)
          setAnalysisError(null)
        })
        .catch((err: unknown) => {
          if (seqRef.current !== seq) return
          setDraft(null)
          setAnalysisError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (seqRef.current !== seq) return
          setIsAnalyzing(false)
        })
    }, 650)

    return () => window.clearTimeout(t)
  }, [input, open, previewTask])

  const handleSubmit = async (mode: TaskExecuteMode) => {
    if (!draft) return
    setExecutingMode(mode)
    try {
      const result = await executeTask(draft, mode)
      if (mode === "create") {
        localStorage.setItem(
          draftKeyForThread(result.workspace_id, result.thread_id),
          JSON.stringify({ text: result.prompt }),
        )
      } else {
        // No-op
      }

      await openWorkspace(result.workspace_id)

      toast(mode === "create" ? "Draft created" : "Task started")

      setInput("")
      setDraft(null)
      setAnalysisError(null)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExecutingMode(null)
    }
  }

  const handleClose = () => {
    setInput("")
    setDraft(null)
    setPromptExpanded(false)
    setAnalysisError(null)
    onOpenChange(false)
  }

  const intentIcon = (kind: TaskIntentKind): React.ReactNode => {
    switch (kind) {
      case "fix_issue":
        return <Bug className="w-4 h-4" />
      case "implement_feature":
        return <Lightbulb className="w-4 h-4" />
      case "review_pull_request":
        return <GitPullRequest className="w-4 h-4" />
      case "resolve_pull_request_conflicts":
        return <GitMerge className="w-4 h-4" />
      case "add_project":
        return <CirclePlus className="w-4 h-4" />
      case "other":
        return <MessageSquare className="w-4 h-4" />
    }
  }

  const intentColor = (kind: TaskIntentKind): string => {
    switch (kind) {
      case "fix_issue":
        return "text-red-500"
      case "implement_feature":
        return "text-emerald-500"
      case "review_pull_request":
        return "text-blue-500"
      case "resolve_pull_request_conflicts":
        return "text-orange-500"
      case "add_project":
        return "text-emerald-500"
      case "other":
        return "text-purple-500"
    }
  }

  const projectLabel = (d: TaskDraft): string => {
    if (d.repo?.full_name) return d.repo.full_name
    if (d.project.type === "git_hub_repo") return d.project.full_name
    if (d.project.type === "local_path") {
      const trimmed = d.project.path.replace(/\/$/, "")
      const parts = trimmed.split("/")
      return parts[parts.length - 1] || trimmed
    }
    return "Unspecified"
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 bg-background border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-medium flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            New Task
          </h2>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative rounded-lg border border-border hover:border-muted-foreground/30 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all duration-200">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste an issue/PR link or describe a task..."
              className={cn(
                "w-full min-h-[100px] p-4 pb-12 bg-transparent text-sm resize-none font-mono",
                "placeholder:text-muted-foreground/50 placeholder:font-sans focus:outline-none",
              )}
              disabled={executingMode != null}
              autoFocus
            />
          </div>

          {analysisError && (
            <div className="px-3 py-2.5 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
              {analysisError}
            </div>
          )}

          {(isAnalyzing || draft) && (
            <div className="rounded-lg border border-border bg-card overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
              {isAnalyzing ? (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="h-3 w-16 bg-muted rounded animate-pulse" />
                        <div className="h-5 w-20 bg-muted rounded-full animate-pulse" />
                      </div>
                      <div className="h-4 w-48 bg-muted rounded animate-pulse" />
                    </div>
                  </div>
                  <div className="space-y-2 pt-1">
                    <div className="flex gap-2">
                      <div className="h-3 w-12 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                    </div>
                    <div className="flex gap-2">
                      <div className="h-3 w-10 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-64 bg-muted rounded animate-pulse" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Analyzing intent...</span>
                  </div>
                </div>
              ) : draft ? (
                <div className="animate-in fade-in duration-300">
                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className={cn("flex items-center gap-1.5", intentColor(draft.intent_kind))}>
                        {intentIcon(draft.intent_kind)}
                        {intentLabel(draft.intent_kind).toLowerCase()}
                      </span>
                      {draft.issue ? <span className="font-medium">#{draft.issue.number}</span> : null}
                      {draft.pull_request ? <span className="font-medium">#{draft.pull_request.number}</span> : null}
                      <span className="text-muted-foreground">in</span>
                      <span className="font-medium">{projectLabel(draft)}</span>
                    </div>
                    {draft.issue?.title || draft.pull_request?.title ? (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {draft.issue?.title ?? draft.pull_request?.title}
                      </p>
                    ) : null}
                    {!canExecute ? (
                      <p className="text-xs text-muted-foreground pt-1">
                        Select a local path or a GitHub repo to create a workspace.
                      </p>
                    ) : null}
                  </div>

                  <div className="border-t border-border">
                    <button
                      type="button"
                      onClick={() => setPromptExpanded(!promptExpanded)}
                      className="w-full px-4 py-2.5 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                    >
                      <ChevronRight
                        className={cn("w-3 h-3 transition-transform duration-200", promptExpanded && "rotate-90")}
                      />
                      <span>Suggested prompt</span>
                    </button>
                    <div
                      className={cn(
                        "overflow-hidden transition-all duration-300 ease-in-out",
                        promptExpanded ? "max-h-48" : "max-h-0",
                      )}
                    >
                      <div className="px-4 pb-4">
                        <div className="p-3 rounded-md bg-secondary/50 text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {draft.prompt}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border bg-secondary/30 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSubmit("create")}
            disabled={!canExecute || executingMode != null || isAnalyzing}
          >
            {executingMode === "create" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {executingMode === "create" ? "Creating..." : "Create Only"}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit("start")}
            disabled={!canExecute || executingMode != null || isAnalyzing}
          >
            {executingMode === "start" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {executingMode === "start" ? "Starting..." : "Start Now"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
