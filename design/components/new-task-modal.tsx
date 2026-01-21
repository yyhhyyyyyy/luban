"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Sparkles,
  Loader2,
  Play,
  Plus,
  ChevronRight,
  Bug,
  Lightbulb,
  GitPullRequest,
  MessageSquare,
  CircleDot,
  FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"

type DetectedType = "issue" | "pr" | "description" | null
type IntentType = "fix" | "implement" | "review" | "discuss" | "other" | null

interface DetectionResult {
  type: DetectedType
  label: string
  detail: string
  icon: React.ReactNode
}

interface IntentAnalysis {
  intent: IntentType
  intentLabel: string
  project: string
  issueNumber?: string
  issueTitle?: string
  prNumber?: string
  prTitle?: string
  suggestedPrompt: string
}

function detectInputType(input: string): DetectionResult | null {
  const trimmed = input.trim()
  if (!trimmed) return null

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

  return {
    type: "description",
    label: "Task",
    detail: trimmed.length > 60 ? trimmed.slice(0, 60) + "..." : trimmed,
    icon: <FileText className="w-4 h-4" />,
  }
}

function getMockIntentAnalysis(detection: DetectionResult): IntentAnalysis {
  if (detection.type === "issue") {
    return {
      intent: "fix",
      intentLabel: "fix issue",
      project: "lance-format/lance",
      issueNumber: "#5682",
      issueTitle: "LABEL_LIST index returns incorrect results when list has NULL elements",
      suggestedPrompt: `Investigate and fix issue #5682 in lance-format/lance.

The LABEL_LIST index is returning incorrect results when the list contains NULL elements. 

Steps:
1. Reproduce the issue with a test case
2. Identify the root cause in the indexing logic
3. Implement a fix that handles NULL elements correctly
4. Add regression tests
5. Update documentation if needed`,
    }
  }

  if (detection.type === "pr") {
    return {
      intent: "review",
      intentLabel: "review pr",
      project: detection.detail.split("#")[0],
      prNumber: `#${detection.detail.split("#")[1]}`,
      prTitle: "Add support for nullable list elements in LABEL_LIST index",
      suggestedPrompt: `Review PR ${detection.detail} thoroughly.

Focus on:
1. Code correctness and edge cases
2. Test coverage
3. Performance implications
4. Documentation updates
5. Breaking changes`,
    }
  }

  return {
    intent: "implement",
    intentLabel: "implement feature",
    project: "current-project",
    suggestedPrompt: `Implement the requested feature based on the provided description.

Ensure:
1. Clean, maintainable code
2. Comprehensive test coverage
3. Documentation updates`,
  }
}

const intentIcons: Record<NonNullable<IntentType>, React.ReactNode> = {
  "fix": <Bug className="w-4 h-4" />,
  "implement": <Lightbulb className="w-4 h-4" />,
  "review": <GitPullRequest className="w-4 h-4" />,
  "discuss": <MessageSquare className="w-4 h-4" />,
  "other": <FileText className="w-4 h-4" />,
}

const intentColors: Record<NonNullable<IntentType>, string> = {
  "fix": "text-status-error",
  "implement": "text-status-success",
  "review": "text-status-running",
  "discuss": "text-status-info",
  "other": "text-muted-foreground",
}

interface NewTaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStart?: (data: { type: DetectedType; value: string; startImmediately: boolean }) => void
}

export function NewTaskModal({ open, onOpenChange, onStart }: NewTaskModalProps) {
  const [input, setInput] = useState("")
  const [isStarting, setIsStarting] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [intentAnalysis, setIntentAnalysis] = useState<IntentAnalysis | null>(null)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const analysisTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const detection = detectInputType(input)

  useEffect(() => {
    if (analysisTimeoutRef.current) {
      clearTimeout(analysisTimeoutRef.current)
    }

    if (detection) {
      setIsAnalyzing(true)
      setIntentAnalysis(null)
      setPromptExpanded(false)

      analysisTimeoutRef.current = setTimeout(() => {
        setIntentAnalysis(getMockIntentAnalysis(detection))
        setIsAnalyzing(false)
      }, 1200)
    } else {
      setIsAnalyzing(false)
      setIntentAnalysis(null)
    }

    return () => {
      if (analysisTimeoutRef.current) {
        clearTimeout(analysisTimeoutRef.current)
      }
    }
  }, [detection]) // Updated to use detection directly

  const handleSubmit = async (startImmediately: boolean) => {
    if (!detection) return

    setIsStarting(true)
    await new Promise((resolve) => setTimeout(resolve, 600))

    onStart?.({
      type: detection.type,
      value: input,
      startImmediately,
    })

    setInput("")
    setIsStarting(false)
    setIntentAnalysis(null)
    onOpenChange(false)
  }

  const handleClose = () => {
    setInput("")
    setIntentAnalysis(null)
    setPromptExpanded(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 bg-background border-border overflow-hidden rounded-lg">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-medium flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            New Task
          </h2>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative rounded-lg border border-border hover:border-muted-foreground/30 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all duration-200">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste an issue/PR link or describe a task..."
              className="w-full min-h-[100px] p-4 pb-12 bg-transparent text-sm resize-none font-mono placeholder:text-muted-foreground/50 placeholder:font-sans focus:outline-none"
              disabled={isStarting}
              autoFocus
            />
          </div>

          {/* Intent Analysis Section */}
          {(isAnalyzing || intentAnalysis) && (
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
                  <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Analyzing intent...</span>
                  </div>
                </div>
              ) : intentAnalysis ? (
                <div className="animate-in fade-in duration-300">
                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span
                        className={cn(
                          "flex items-center gap-1.5",
                          intentAnalysis.intent && intentColors[intentAnalysis.intent],
                        )}
                      >
                        {intentAnalysis.intent && intentIcons[intentAnalysis.intent]}
                        {intentAnalysis.intentLabel}
                      </span>
                      {intentAnalysis.issueNumber && <span className="font-medium">{intentAnalysis.issueNumber}</span>}
                      {intentAnalysis.prNumber && <span className="font-medium">{intentAnalysis.prNumber}</span>}
                      <span className="text-muted-foreground">in</span>
                      <span className="font-medium">{intentAnalysis.project}</span>
                    </div>
                    {(intentAnalysis.issueTitle || intentAnalysis.prTitle) && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {intentAnalysis.issueTitle || intentAnalysis.prTitle}
                      </p>
                    )}
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
                      <span>Task prompts</span>
                    </button>
                    <div
                      className={cn(
                        "overflow-hidden transition-all duration-300 ease-in-out",
                        promptExpanded ? "max-h-48" : "max-h-0",
                      )}
                    >
                      <div className="px-4 pb-4">
                        <div className="p-3 rounded bg-secondary/50 text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {intentAnalysis.suggestedPrompt}
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
            onClick={() => handleSubmit(false)}
            disabled={!detection || isStarting || isAnalyzing}
          >
            {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {isStarting ? "Creating..." : "Create Only"}
          </Button>
          <Button size="sm" onClick={() => handleSubmit(true)} disabled={!detection || isStarting || isAnalyzing}>
            {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isStarting ? "Starting..." : "Start Now"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
