"use client"

import type React from "react"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { FileText, FolderOpen, GitBranch, GitPullRequest, CircleDot, Link2, Loader2, CirclePlus, Play } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useLuban } from "@/lib/luban-context"
import type { TaskDraft, TaskExecuteMode, TaskIntentKind } from "@/lib/luban-api"

type DetectedType = "repo" | "issue" | "pr" | "local_path" | "description" | null

interface DetectionResult {
  type: DetectedType
  label: string
  detail: string
  icon: React.ReactNode
}

function detectInputType(input: string): DetectionResult | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const isLocalPath =
    trimmed.startsWith("/") ||
    trimmed.startsWith("~/") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  if (isLocalPath) {
    const name = trimmed.replace(/\/$/, "").split(/[\\/]/).pop() || trimmed
    return {
      type: "local_path",
      label: "Local Path",
      detail: name,
      icon: <FolderOpen className="w-4 h-4" />,
    }
  }

  const repoMatch = trimmed.match(/^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w-]+\/[\w.-]+\/?$/i)
  if (repoMatch) {
    const urlParts = trimmed.replace(/\/$/, "").split("/")
    const repoName = urlParts.slice(-2).join("/")
    return {
      type: "repo",
      label: "Repository",
      detail: repoName,
      icon: <GitBranch className="w-4 h-4" />,
    }
  }

  const issueMatch = trimmed.match(/^https?:\/\/(github\.com|gitlab\.com)\/[\w-]+\/[\w.-]+\/issues\/(\d+)/i)
  if (issueMatch) {
    const urlParts = trimmed.split("/")
    const repoIndex = urlParts.findIndex((p) => p === "github.com" || p === "gitlab.com") + 1
    const repoName = urlParts.slice(repoIndex, repoIndex + 2).join("/")
    return {
      type: "issue",
      label: "Issue",
      detail: `${repoName}#${issueMatch[2]}`,
      icon: <CircleDot className="w-4 h-4" />,
    }
  }

  const prMatch = trimmed.match(/^https?:\/\/(github\.com|gitlab\.com)\/[\w-]+\/[\w.-]+\/pull\/(\d+)/i)
  if (prMatch) {
    const urlParts = trimmed.split("/")
    const repoIndex = urlParts.findIndex((p) => p === "github.com" || p === "gitlab.com") + 1
    const repoName = urlParts.slice(repoIndex, repoIndex + 2).join("/")
    return {
      type: "pr",
      label: "Pull Request",
      detail: `${repoName}#${prMatch[2]}`,
      icon: <GitPullRequest className="w-4 h-4" />,
    }
  }

  const urlMatch = trimmed.match(/^https?:\/\//i)
  if (urlMatch) {
    try {
      const url = new URL(trimmed)
      return {
        type: "repo",
        label: "Link",
        detail: `${url.hostname}${url.pathname.slice(0, 24)}`,
        icon: <Link2 className="w-4 h-4" />,
      }
    } catch {
      // fallthrough
    }
  }

  return {
    type: "description",
    label: "Task",
    detail: trimmed.length > 60 ? `${trimmed.slice(0, 60)}...` : trimmed,
    icon: <FileText className="w-4 h-4" />,
  }
}

interface AddProjectModalProps {
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

export function AddProjectModal({ open, onOpenChange }: AddProjectModalProps) {
  const { pickProjectPath, previewTask, executeTask, openWorkspace } = useLuban()

  const [input, setInput] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [draft, setDraft] = useState<TaskDraft | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [executingMode, setExecutingMode] = useState<TaskExecuteMode | null>(null)
  const seqRef = useRef(0)

  const detection = useMemo(() => detectInputType(input), [input])
  const canExecute = draft != null && draft.project.type !== "unspecified"

  useEffect(() => {
    if (!open) return
    const trimmed = input.trim()
    if (trimmed.length === 0) {
      setDraft(null)
      setAnalysisError(null)
      return
    }

    const seq = (seqRef.current += 1)
    setIsAnalyzing(true)
    setAnalysisError(null)

    const t = window.setTimeout(() => {
      previewTask(trimmed)
        .then((d) => {
          if (seqRef.current !== seq) return
          setDraft(d)
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

  const handleBrowse = async () => {
    try {
      const picked = await pickProjectPath()
      if (!picked) return
      setInput(picked)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      handleBrowse()
    },
    [handleBrowse],
  )

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
    setAnalysisError(null)
    onOpenChange(false)
  }

  const getIconColor = (type: DetectedType) => {
    switch (type) {
      case "repo":
        return "text-emerald-500"
      case "issue":
        return "text-amber-500"
      case "pr":
        return "text-blue-500"
      case "local_path":
        return "text-orange-500"
      default:
        return "text-primary"
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px] p-0 gap-0 bg-background border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-medium flex items-center gap-2">
            <CirclePlus className="w-4 h-4 text-primary" />
            New
          </h2>
        </div>

        <div className="p-5 space-y-4">
          <div
            className={cn(
              "relative rounded-lg border transition-all duration-200",
              isDragging
                ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                : "border-border hover:border-muted-foreground/30 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste a local path, a link, or describe your task..."
              className={cn(
                "w-full min-h-[100px] p-4 pb-12 bg-transparent text-sm resize-none font-mono",
                "placeholder:text-muted-foreground/50 placeholder:font-sans focus:outline-none",
              )}
              disabled={executingMode != null}
              autoFocus
            />

            <div className="absolute bottom-3 right-3">
              <button
                type="button"
                onClick={handleBrowse}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5",
                  "text-xs text-muted-foreground hover:text-foreground",
                  "bg-secondary/80 hover:bg-secondary rounded-md transition-colors",
                )}
                disabled={executingMode != null}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Browse</span>
              </button>
            </div>

            {isDragging && (
              <div className="absolute inset-0 flex items-center justify-center bg-primary/5 backdrop-blur-[1px] rounded-lg">
                <div className="flex flex-col items-center gap-2 text-primary">
                  <FolderOpen className="w-8 h-8" />
                  <span className="text-sm font-medium">Drop folder here</span>
                </div>
              </div>
            )}
          </div>

          {analysisError && (
            <div className="px-3 py-2.5 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
              {analysisError}
            </div>
          )}

          {draft ? (
            <div className="space-y-2">
              <div className="flex items-start gap-3 px-3 py-2.5 bg-secondary/50 rounded-lg">
                <div className={cn("p-1.5 rounded-md bg-background", getIconColor(detection?.type ?? null))}>
                  {(detection?.icon ?? <FileText className="w-4 h-4" />) as React.ReactNode}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Intent</span>
                    <span className="text-[11px] text-muted-foreground">{intentLabel(draft.intent_kind)}</span>
                  </div>
                  <p className="text-sm font-medium whitespace-pre-line">{draft.summary}</p>
                </div>
              </div>

              {!canExecute ? (
                <div className="px-3 py-2.5 bg-muted/30 border border-border rounded-lg text-xs text-muted-foreground">
                  Select a local path or a GitHub repo to create a workspace.
                </div>
              ) : null}

              <details className="group">
                <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Suggested prompt
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted/30 border border-border rounded-lg p-3 font-mono text-foreground/90">
                  {draft.prompt}
                </pre>
              </details>
            </div>
          ) : null}

          {!draft && detection && (
            <div className="flex items-center gap-3 px-3 py-2.5 bg-secondary/50 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200">
              <div className={cn("p-1.5 rounded-md bg-background", getIconColor(detection.type))}>{detection.icon}</div>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-muted-foreground">{detection.label}</span>
                <p className="text-sm font-medium truncate">{detection.detail}</p>
              </div>
            </div>
          )}

          {isAnalyzing ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Analyzing intent…
            </div>
          ) : null}
        </div>

        <div className="px-5 py-4 border-t border-border bg-secondary/30 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={executingMode != null}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSubmit("create")}
            disabled={!canExecute || executingMode != null}
          >
            {executingMode === "create" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Creating...
              </>
            ) : (
              "Create"
            )}
          </Button>
          <Button size="sm" onClick={() => void handleSubmit("start")} disabled={!canExecute || executingMode != null}>
            {executingMode === "start" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 mr-1.5" />
                Start
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
