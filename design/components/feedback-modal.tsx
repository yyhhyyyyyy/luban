"use client"

import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Bug,
  Lightbulb,
  HelpCircle,
  ChevronLeft,
  Loader2,
  Send,
  CheckCircle2,
  Sparkles,
  ImagePlus,
  X,
  Play,
} from "lucide-react"
import { cn } from "@/lib/utils"

type FeedbackType = "bug" | "feature" | "question"
type Stage = "input" | "review"

interface SystemInfo {
  version: string
  os: string
  runtime: string
  currentProject?: string
  currentWorktree?: string
}

interface AnalyzedIssue {
  title: string
  type: FeedbackType
  labels: string[]
  body: string
}

interface Attachment {
  id: string
  name: string
  url: string
  type: "image"
}

function getMockSystemInfo(): SystemInfo {
  return {
    version: "0.1.2",
    os: "macOS 15.2 (Darwin arm64)",
    runtime: "Tauri WebView",
    currentProject: "xuanwo/luban",
    currentWorktree: "main",
  }
}

function detectFeedbackType(input: string): FeedbackType {
  const lower = input.toLowerCase()
  const bugKeywords = ["bug", "error", "crash", "broken", "not working", "fail", "issue", "problem", "wrong", "stuck", "freeze", "doesn't work", "can't", "cannot"]
  const featureKeywords = ["feature", "add", "support", "would be nice", "request", "suggest", "improve", "enhancement", "wish", "希望", "建议", "能否", "可以"]
  
  const hasBugKeyword = bugKeywords.some(k => lower.includes(k))
  const hasFeatureKeyword = featureKeywords.some(k => lower.includes(k))
  
  if (hasBugKeyword && !hasFeatureKeyword) return "bug"
  if (hasFeatureKeyword && !hasBugKeyword) return "feature"
  if (hasBugKeyword && hasFeatureKeyword) return "bug"
  return "question"
}

function getMockAnalyzedIssue(input: string, systemInfo: SystemInfo): AnalyzedIssue {
  const detectedType = detectFeedbackType(input)
  
  if (detectedType === "bug") {
    return {
      title: "Worktree status not updating after agent completes task",
      type: "bug",
      labels: ["bug", "agent", "ui"],
      body: `## Description
The worktree status indicator in the sidebar does not update automatically when an agent completes its task.

## Steps to Reproduce
1. Create a new worktree and start an agent task
2. Wait for the agent to complete the task
3. Observe the sidebar status indicator

## Expected Behavior
The worktree status should change from 'running' to 'idle' when the agent completes.

## Actual Behavior
The status remains 'running' even after the agent has finished. Refreshing the page fixes the issue.

## System Information
- Version: ${systemInfo.version}
- OS: ${systemInfo.os}
- Project: ${systemInfo.currentProject}
- Worktree: ${systemInfo.currentWorktree}`,
    }
  }

  if (detectedType === "feature") {
    return {
      title: "Add keyboard shortcuts for common actions",
      type: "feature",
      labels: ["enhancement", "ux"],
      body: `## Feature Request
Add keyboard shortcuts for frequently used actions to improve productivity.

## Motivation
Power users would benefit from being able to perform common actions without reaching for the mouse.

## Proposed Solution
- \`Cmd+N\` - New Task
- \`Cmd+K\` - Quick search / command palette
- \`Cmd+Shift+W\` - Create new worktree

## System Information
- Version: ${systemInfo.version}
- OS: ${systemInfo.os}
- Project: ${systemInfo.currentProject}`,
    }
  }

  return {
    title: "Question about worktree workflow",
    type: "question",
    labels: ["question"],
    body: `## Question
${input}

## System Information
- Version: ${systemInfo.version}
- OS: ${systemInfo.os}
- Project: ${systemInfo.currentProject}`,
  }
}

const typeConfig = {
  bug: {
    icon: Bug,
    label: "Bug Report",
    color: "text-status-error",
    bgColor: "bg-status-error/10",
  },
  feature: {
    icon: Lightbulb,
    label: "Feature Request",
    color: "text-status-success",
    bgColor: "bg-status-success/10",
  },
  question: {
    icon: HelpCircle,
    label: "Question",
    color: "text-status-info",
    bgColor: "bg-status-info/10",
  },
}

interface FeedbackModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FeedbackModal({ open, onOpenChange }: FeedbackModalProps) {
  const [stage, setStage] = useState<Stage>("input")
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isPolishing, setIsPolishing] = useState(false)
  const [analyzedIssue, setAnalyzedIssue] = useState<AnalyzedIssue | null>(null)
  const [editedTitle, setEditedTitle] = useState("")
  const [editedBody, setEditedBody] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitAction, setSubmitAction] = useState<"fix" | "create" | null>(null)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [systemInfo] = useState<SystemInfo>(getMockSystemInfo)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const inputTrimmed = input.trim()
  const hasInput = inputTrimmed.length > 5

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStage("input")
        setInput("")
        setAttachments([])
        setAnalyzedIssue(null)
        setEditedTitle("")
        setEditedBody("")
        setIsSubmitted(false)
        setSubmitAction(null)
      }, 200)
    }
  }, [open])

  const handlePolish = async () => {
    if (!hasInput) return

    setIsPolishing(true)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    
    const issue = getMockAnalyzedIssue(inputTrimmed, systemInfo)
    setAnalyzedIssue(issue)
    setEditedTitle(issue.title)
    setEditedBody(issue.body)
    setIsPolishing(false)
    setStage("review")
  }

  const handleBack = () => {
    setStage("input")
  }

  const handleSubmit = async (action: "fix" | "create") => {
    if (!analyzedIssue) return

    setSubmitAction(action)
    setIsSubmitting(true)
    await new Promise((resolve) => setTimeout(resolve, 600))
    setIsSubmitting(false)
    setIsSubmitted(true)

    setTimeout(() => {
      onOpenChange(false)
    }, 1500)
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          const url = URL.createObjectURL(file)
          setAttachments((prev) => [
            ...prev,
            { id: crypto.randomUUID(), name: file.name || "screenshot.png", url, type: "image" },
          ])
        }
      }
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const detectedType = analyzedIssue ? typeConfig[analyzedIssue.type] : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 bg-background border-border overflow-hidden rounded-lg">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          {stage === "review" && (
            <button
              onClick={handleBack}
              className="p-1 -ml-1 text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <h2 className="text-base font-medium flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            {stage === "input" ? "Send Feedback" : "Review Issue"}
          </h2>
        </div>

        {isSubmitted ? (
          <div className="p-8 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-status-success/10 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-6 h-6 text-status-success" />
            </div>
            <h3 className="text-sm font-medium mb-1">
              {submitAction === "fix" ? "Task Started!" : "Issue Created!"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {submitAction === "fix"
                ? "Agent is working on fixing this issue."
                : <>Issue <span className="font-mono text-primary">#1234</span> has been created.</>
              }
            </p>
          </div>
        ) : stage === "input" ? (
          <>
            {/* Input Stage */}
            <div className="p-5 space-y-4">
              <div className="relative rounded-lg border border-border hover:border-muted-foreground/30 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all duration-200">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="Describe the bug or feature you'd like..."
                  className="w-full min-h-[100px] p-4 bg-transparent text-sm resize-none placeholder:text-muted-foreground/50 focus:outline-none"
                  disabled={isPolishing}
                  autoFocus
                />
                
                {/* Attachments Preview */}
                {attachments.length > 0 && (
                  <div className="px-4 pb-3 flex flex-wrap gap-2">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="relative group w-16 h-16 rounded-lg overflow-hidden border border-border"
                      >
                        <img
                          src={att.url}
                          alt={att.name}
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() => removeAttachment(att.id)}
                          className="absolute top-0.5 right-0.5 p-0.5 bg-background/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer - Input Stage */}
            <div className="px-5 py-4 border-t border-border bg-secondary/30 flex items-center justify-end gap-2">
              <Button
                size="sm"
                onClick={handlePolish}
                disabled={!hasInput || isPolishing}
              >
                {isPolishing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {isPolishing ? "Polishing..." : "Polish"}
              </Button>
            </div>
          </>
        ) : (
          /* Review Stage */
          <div className="flex flex-col max-h-[70vh]">
            {/* Type Badge */}
            {detectedType && (
              <div className="px-5 pt-4 pb-2">
                <div className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                  detectedType.bgColor,
                  detectedType.color
                )}>
                  <detectedType.icon className="w-3.5 h-3.5" />
                  {detectedType.label}
                </div>
              </div>
            )}

            {/* Editable Title */}
            <div className="px-5 pb-3">
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="w-full text-base font-medium bg-transparent border-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
                placeholder="Issue title..."
              />
              {/* Labels */}
              {analyzedIssue && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {analyzedIssue.labels.map((label) => (
                    <span
                      key={label}
                      className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-secondary text-muted-foreground"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Editable Body */}
            <div className="flex-1 overflow-hidden border-t border-border">
              <div className="h-full max-h-[300px] overflow-y-auto">
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  className="w-full h-full min-h-[200px] p-5 bg-transparent text-sm font-mono resize-none placeholder:text-muted-foreground/50 focus:outline-none"
                  placeholder="Issue body..."
                />
              </div>
            </div>

            {/* Attachments in review */}
            {attachments.length > 0 && (
              <div className="px-5 py-3 border-t border-border">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <ImagePlus className="w-3 h-3" />
                  {attachments.length} attachment{attachments.length > 1 ? "s" : ""}
                </div>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="w-12 h-12 rounded overflow-hidden border border-border"
                    >
                      <img
                        src={att.url}
                        alt={att.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer - Review Stage */}
            <div className="px-5 py-4 border-t border-border bg-secondary/30 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSubmit("create")}
                disabled={isSubmitting || !editedTitle.trim()}
              >
                {isSubmitting && submitAction === "create" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {isSubmitting && submitAction === "create" ? "Creating..." : "Create Issue"}
              </Button>
              <Button
                size="sm"
                onClick={() => handleSubmit("fix")}
                disabled={isSubmitting || !editedTitle.trim()}
              >
                {isSubmitting && submitAction === "fix" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {isSubmitting && submitAction === "fix" ? "Starting..." : "Fix it"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
