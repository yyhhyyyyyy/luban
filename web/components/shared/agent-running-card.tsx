"use client"

import React, { useState } from "react"
import {
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  Loader2,
  Send,
  Pause,
  Pencil,
  Play,
  Terminal,
  Wrench,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { ActivityEvent } from "@/lib/conversation-ui"
import type { AttachmentRef, CodexCustomPromptSnapshot } from "@/lib/luban-api"
import { MessageEditor, type ComposerAttachment } from "@/components/shared/message-editor"

const eventIcons: Record<ActivityEvent["type"], React.ElementType> = {
  thinking: Brain,
  tool_call: Wrench,
  file_edit: Pencil,
  bash: Terminal,
  search: Eye,
  complete: CheckCircle2,
}

const eventLabels: Record<ActivityEvent["type"], string> = {
  thinking: "Think",
  tool_call: "Tool",
  file_edit: "Edit",
  bash: "Bash",
  search: "Search",
  complete: "Done",
}

export type AgentRunningStatus = "running" | "cancelling" | "paused" | "resuming"

function formatStepClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const mm = Math.min(minutes, 99)
  return `${String(mm).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export function AgentRunningCard({
  activities,
  elapsedTime = "00:00",
  status,
  hasQueuedMessages,
  editorValue,
  editorAttachments,
  onEditorChange,
  onEditorAttachmentsChange,
  onRemoveEditorAttachment,
  onEditorFileSelect,
  onEditorPaste,
  onAddEditorAttachmentRef,
  workspaceId,
  commands,
  messageHistory,
  onCommand,
  onCancel,
  onResume,
  onSubmit,
  onDismiss,
}: {
  activities: ActivityEvent[]
  elapsedTime?: string
  status: AgentRunningStatus
  hasQueuedMessages: boolean
  editorValue: string
  editorAttachments: ComposerAttachment[]
  onEditorChange: (value: string) => void
  onEditorAttachmentsChange: (attachments: ComposerAttachment[]) => void
  onRemoveEditorAttachment: (id: string) => void
  onEditorFileSelect: (files: FileList | null) => void
  onEditorPaste: (e: React.ClipboardEvent) => void
  onAddEditorAttachmentRef?: (attachment: AttachmentRef) => void
  workspaceId?: number | null
  commands?: CodexCustomPromptSnapshot[]
  messageHistory?: string[]
  onCommand?: (commandId: string) => void
  onCancel: () => void
  onResume: () => void
  onSubmit: () => void
  onDismiss: () => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())
  const headerRef = React.useRef<HTMLDivElement>(null)
  const editorContainerRef = React.useRef<HTMLDivElement>(null)
  const anchorTopRef = React.useRef<number | null>(null)
  const isCompensatingScrollRef = React.useRef(false)
  const activityTimingRef = React.useRef<Map<string, { startedAtMs: number; doneAtMs: number | null; status: ActivityEvent["status"] }>>(
    new Map(),
  )
  const [timingTick, setTimingTick] = useState(0)

  const showEditor = status === "cancelling" || status === "resuming"
  const isPaused = status === "paused"
  const isCancelling = status === "cancelling"
  const isResuming = status === "resuming"
  const isRunning = status === "running"

  const showPausedIndicator = !isRunning

  const latestActivity = activities[activities.length - 1]
  const historyActivities = activities.slice(0, -1)
  const labelForActivity = (event: ActivityEvent): string => {
    if (event.type === "thinking" && (!event.detail || event.detail.trim().length === 0)) {
      return "Reasoning"
    }
    return eventLabels[event.type] ?? "Tool"
  }
  const currentLabel = latestActivity ? labelForActivity(latestActivity) : "Processing"
  const LatestIcon = latestActivity ? eventIcons[latestActivity.type] : Wrench

  React.useEffect(() => {
    const now = Date.now()
    for (const event of activities) {
      const existing = activityTimingRef.current.get(event.id) ?? null
      if (!existing) {
        activityTimingRef.current.set(event.id, { startedAtMs: now, doneAtMs: event.status === "done" ? now : null, status: event.status })
        continue
      }
      if (existing.status !== event.status) {
        existing.status = event.status
        if (event.status === "done" && existing.doneAtMs == null) {
          existing.doneAtMs = now
        }
      }
    }
  }, [activities])

  const hasRunningSteps = activities.some((e) => e.status === "running")
  React.useEffect(() => {
    if (!hasRunningSteps) return
    const timer = window.setInterval(() => setTimingTick((n) => (n + 1) % 1_000_000), 250)
    return () => window.clearInterval(timer)
  }, [hasRunningSteps])

  const activityDurationLabel = (event: ActivityEvent): string | null => {
    void timingTick
    const meta = activityTimingRef.current.get(event.id) ?? null
    if (!meta) return null
    const end = meta.doneAtMs ?? Date.now()
    return formatStepClock(end - meta.startedAtMs)
  }

  const findScrollContainer = (): HTMLElement | null => {
    const header = headerRef.current
    if (!header) return null

    const byTestId = header.closest('[data-testid="chat-scroll-container"]') as HTMLElement | null
    if (byTestId) return byTestId

    return header.closest(".overflow-y-auto") as HTMLElement | null
  }

  const anchorHeaderTop = () => {
    const header = headerRef.current
    if (!header) return
    anchorTopRef.current = header.getBoundingClientRect().top
  }

  const compensateScrollToKeepHeaderAnchored = () => {
    const header = headerRef.current
    if (!header) return
    const anchor = anchorTopRef.current
    if (anchor == null) return

    const scrollContainer = findScrollContainer()
    if (!scrollContainer) return

    const currentTop = header.getBoundingClientRect().top
    const delta = currentTop - anchor
    if (Math.abs(delta) < 0.5) return

    isCompensatingScrollRef.current = true
    scrollContainer.scrollTop += delta
    requestAnimationFrame(() => {
      isCompensatingScrollRef.current = false
    })
  }

  const toggleExpand = () => {
    if (headerRef.current) {
      const headerRect = headerRef.current.getBoundingClientRect()
      const headerTop = headerRect.top

      anchorTopRef.current = headerTop
      setIsExpanded(!isExpanded)

      requestAnimationFrame(() => {
        if (!headerRef.current) return
        const newHeaderRect = headerRef.current.getBoundingClientRect()
        const delta = newHeaderRect.top - headerTop
        if (delta === 0) return
        const scrollContainer = findScrollContainer()
        if (!scrollContainer) return
        isCompensatingScrollRef.current = true
        scrollContainer.scrollTop += delta
        requestAnimationFrame(() => {
          isCompensatingScrollRef.current = false
        })
      })
      return
    }
    setIsExpanded(!isExpanded)
  }

  const toggleEvent = (eventId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const nextExpanded = new Set(expandedEvents)
    if (nextExpanded.has(eventId)) {
      nextExpanded.delete(eventId)
    } else {
      nextExpanded.add(eventId)
    }
    setExpandedEvents(nextExpanded)
  }

  React.useEffect(() => {
    if (!showEditor) return
    const handleClickOutside = (e: MouseEvent) => {
      if (editorContainerRef.current && !editorContainerRef.current.contains(e.target as Node)) {
        onDismiss()
      }
    }

    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside)
    }, 0)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [onDismiss, showEditor])

  React.useEffect(() => {
    if (!isExpanded) {
      anchorTopRef.current = null
      return
    }

    anchorHeaderTop()
    const scrollContainer = findScrollContainer()
    if (!scrollContainer) return

    const onScroll = () => {
      if (isCompensatingScrollRef.current) return
      anchorHeaderTop()
    }

    scrollContainer.addEventListener("scroll", onScroll, { passive: true })
    return () => scrollContainer.removeEventListener("scroll", onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded])

  React.useLayoutEffect(() => {
    if (!isExpanded) return
    compensateScrollToKeepHeaderAnchored()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, historyActivities.length, expandedEvents.size])

  if (!activities.length) return null

  const canSubmit = (() => {
    const hasUploading = editorAttachments.some((a) => a.status === "uploading")
    if (hasUploading) return false
    const hasReady = editorAttachments.some((a) => a.status === "ready" && a.attachment != null)
    return editorValue.trim().length > 0 || hasReady
  })()

  return (
    <div className="my-3">
      {isExpanded && historyActivities.length > 0 && (
        <div
          data-testid="agent-running-history"
          className="px-3 py-2 space-y-0.5 border border-b-0 border-border rounded-t-lg bg-card"
        >
          {historyActivities.map((event) => {
            const Icon = eventIcons[event.type] || Wrench
            const isEventExpanded = expandedEvents.has(event.id)
            const hasDetail = Boolean(event.detail)
            const durationLabel = activityDurationLabel(event)

            return (
              <div key={event.id} className="group">
                <button
                  onClick={(e) => hasDetail && toggleEvent(event.id, e)}
                  className={cn(
                    "relative w-full flex items-center gap-2 text-xs py-1 px-1 -mx-1 rounded transition-colors text-muted-foreground overflow-hidden",
                    hasDetail && "hover:bg-muted/50 cursor-pointer",
                    !hasDetail && "cursor-default",
                  )}
                >
                  <Check className="w-3.5 h-3.5 text-status-success flex-shrink-0" />
                  <span className="flex items-center gap-1 w-16 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 bg-muted text-muted-foreground">
                    <Icon className="w-3 h-3" />
                    {labelForActivity(event)}
                  </span>
                  <span className="flex-1 text-left truncate">{event.title}</span>
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 pl-3">
                    <div className="pointer-events-none absolute inset-y-0 -left-6 w-6 bg-gradient-to-l from-card via-card to-transparent group-hover:from-muted/50 group-hover:via-muted/50" />
                    <span className="relative z-10 text-[10px] text-muted-foreground/60 font-mono w-10 text-right flex-shrink-0 bg-card group-hover:bg-muted/50">
                      {durationLabel ?? "00:00"}
                    </span>
                    {hasDetail && (
                      <ChevronRight
                        className={cn(
                          "relative z-10 w-3 h-3 text-muted-foreground/40 transition-transform flex-shrink-0",
                          isEventExpanded && "rotate-90",
                        )}
                      />
                    )}
                  </div>
                </button>

                {isEventExpanded && event.detail && (
                  <div className="ml-6 mt-1 mb-2 p-2 rounded bg-muted/30 border border-border/50">
                    <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap font-mono">
                      {event.detail}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div
        ref={headerRef}
        data-testid="agent-running-header"
        className={cn(
          "flex items-center justify-between px-3 py-2 bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors border border-border",
          isExpanded && historyActivities.length > 0 ? "rounded-t-none border-t-0" : "rounded-lg",
          isExpanded && historyActivities.length > 0 && !showEditor && "rounded-b-lg",
          !isExpanded && !showEditor && "rounded-lg",
          !isExpanded && showEditor && "rounded-b-none border-b-0",
          isExpanded && showEditor && "rounded-b-none border-b-0",
        )}
        onClick={toggleExpand}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {showPausedIndicator ? (
            <div className="relative flex items-center justify-center w-3.5 h-3.5 flex-shrink-0">
              <div className="w-2 h-2 rounded-full bg-status-warning animate-pulse" />
            </div>
          ) : (
            <Loader2 className="w-3.5 h-3.5 text-status-running animate-spin flex-shrink-0" />
          )}

          <span
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 transition-colors",
              showPausedIndicator ? "bg-status-warning/10 text-status-warning" : "bg-primary/10 text-primary",
            )}
          >
            <LatestIcon className="w-3 h-3" />
            {showPausedIndicator ? (isPaused ? "Paused" : isResuming ? "Resume" : "Cancel") : currentLabel}
          </span>

          <span
            className={cn(
              "text-xs truncate transition-colors",
              showPausedIndicator ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {latestActivity?.title}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span data-testid="agent-running-timer">{elapsedTime}</span>
          </span>

          <div className="flex items-center justify-center ml-1 w-7" onClick={(e) => e.stopPropagation()}>
            {isPaused ? (
              <button
                data-testid="agent-running-resume"
                onClick={onResume}
                className="p-1.5 text-status-warning hover:text-status-warning hover:bg-status-warning/10 rounded-md transition-all"
                title="Resume"
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            ) : showEditor ? (
              <div className="p-1.5 text-status-warning" title={isResuming ? "Resuming..." : "Cancelling..."}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              </div>
            ) : (
              <button
                data-testid="agent-running-cancel"
                onClick={onCancel}
                className="p-1.5 text-muted-foreground hover:text-status-warning hover:bg-status-warning/10 rounded-md transition-all"
                title="Cancel"
              >
                <Pause className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {showEditor && (
        <div ref={editorContainerRef} className="border border-t-0 border-border rounded-b-lg bg-card">
          <MessageEditor
            value={editorValue}
            onChange={onEditorChange}
            attachments={editorAttachments}
            onRemoveAttachment={onRemoveEditorAttachment}
            onFileSelect={onEditorFileSelect}
            onPaste={onEditorPaste}
            onAddAttachmentRef={onAddEditorAttachmentRef}
            workspaceId={workspaceId ?? null}
            commands={commands}
            messageHistory={messageHistory}
            onCommand={onCommand}
            placeholder={
              status === "resuming"
                ? "Type a message to resume with new instructions..."
                : hasQueuedMessages
                  ? "Type a message to interrupt, or press Esc to pause..."
                  : "Type a message to interrupt, or press Esc to cancel..."
            }
            disabled={false}
            autoFocus
            primaryAction={{
              onClick: () => {
                if (!canSubmit) return
                onSubmit()
              },
              disabled: !canSubmit,
              icon: <Send className="w-3.5 h-3.5" />,
              ariaLabel: isResuming ? "Resume" : "Cancel",
              testId: "agent-running-submit",
            }}
            secondaryAction={{
              onClick: onDismiss,
              ariaLabel: "Dismiss",
              icon: <X className="w-3.5 h-3.5" />,
              testId: "agent-running-dismiss",
            }}
            testIds={{
              textInput: "agent-running-input",
              attachInput: "agent-running-attach-input",
              attachButton: "agent-running-attach",
              attachmentTile: "agent-running-attachment-tile",
            }}
          />
        </div>
      )}
    </div>
  )
}
