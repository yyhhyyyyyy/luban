"use client"

import React, { useState, useRef } from "react"
import {
  Brain,
  Wrench,
  Pencil,
  SquareTerminal,
  Eye,
  CheckCircle2,
  Loader2,
  ChevronRight,
  ChevronDown,
  Clock,
  Pause,
  Play,
  Check,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MessageEditor } from "./message-editor"
import type { MessageAttachment } from "./chat-message"

export type ShellType = "zsh" | "bash" | "sh" | "fish" | "pwsh"

export interface ActivityEvent {
  id: string
  type: "thinking" | "tool_call" | "file_edit" | "shell" | "search" | "complete"
  title: string
  detail?: string
  status: "running" | "done"
  duration?: string
  shellType?: ShellType
}

const eventIcons: Record<ActivityEvent["type"], React.ElementType> = {
  thinking: Brain,
  tool_call: Wrench,
  file_edit: Pencil,
  shell: SquareTerminal,
  search: Eye,
  complete: CheckCircle2,
}

const eventLabels: Record<ActivityEvent["type"], string> = {
  thinking: "Think",
  tool_call: "Tool",
  file_edit: "Edit",
  shell: "Shell",
  search: "Search",
  complete: "Done",
}

interface ActivityEventItemProps {
  event: ActivityEvent
  isExpanded?: boolean
  onToggle?: () => void
  compact?: boolean
  variant?: "default" | "chat"
}

export function ActivityEventItem({
  event,
  isExpanded = false,
  onToggle,
  compact = false,
  variant = "default",
}: ActivityEventItemProps) {
  const Icon = eventIcons[event.type] || Wrench
  const disableWithoutDetail = variant === "default"

  return (
    <div className="group">
      <button
        onClick={onToggle}
        disabled={disableWithoutDetail && !event.detail}
        className={cn(
          "w-full flex items-center gap-2 rounded text-xs transition-colors",
          compact ? "py-0.5 px-1" : "py-1 px-2 -mx-2 hover:bg-muted/50",
          variant === "chat"
            ? event.status === "running"
              ? "text-primary"
              : "text-muted-foreground"
            : event.status === "running"
              ? "text-status-running"
              : "text-muted-foreground",
          disableWithoutDetail && !event.detail && "cursor-default",
        )}
      >
        {event.status === "running" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        ) : (
          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        )}
        <span className="flex-1 text-left truncate">{event.title}</span>
        {event.duration && (
          <span className={cn("text-muted-foreground/70", variant === "chat" ? "text-[10px]" : "text-xs")}>
            {event.duration}
          </span>
        )}
        {event.detail && (
          <ChevronRight
            className={cn("w-3 h-3 text-muted-foreground/50 transition-transform", isExpanded && "rotate-90")}
          />
        )}
      </button>
      {isExpanded && event.detail && (
        <div
          className={cn(
            "ml-5 pl-2 border-l border-border text-muted-foreground py-1 mb-1",
            variant === "chat" ? "text-[11px]" : "text-xs",
          )}
        >
          {event.detail}
        </div>
      )}
    </div>
  )
}

interface ActivityStreamProps {
  activities: ActivityEvent[]
  isStreaming?: boolean
  isCancelled?: boolean
  compact?: boolean
  variant?: "default" | "chat"
}

export function ActivityStream({ activities, isStreaming, isCancelled = false, compact = false, variant = "default" }: ActivityStreamProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())

  const latestActivity = activities[activities.length - 1]
  const completedCount = activities.filter((a) => a.status === "done").length

  const toggleEvent = (eventId: string) => {
    const newExpanded = new Set(expandedEvents)
    if (newExpanded.has(eventId)) {
      newExpanded.delete(eventId)
    } else {
      newExpanded.add(eventId)
    }
    setExpandedEvents(newExpanded)
  }

  if (!activities.length) return null

  const ExpandIcon = variant === "chat" ? ChevronDown : ChevronRight

  // Determine icon and label based on state
  const renderStatusIcon = () => {
    if (isStreaming && latestActivity?.status === "running") {
      return <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
    }
    if (isCancelled) {
      return (
        <div className="relative flex items-center justify-center w-3.5 h-3.5 flex-shrink-0">
          <div className="absolute inset-0 rounded-full bg-status-warning/20" />
          <X className="w-2.5 h-2.5 text-status-warning" />
        </div>
      )
    }
    return (
      <CheckCircle2
        className={cn("w-3.5 h-3.5 flex-shrink-0", variant === "chat" ? "text-status-success" : "text-status-success")}
      />
    )
  }

  const getStatusLabel = () => {
    if (isStreaming) return latestActivity?.title
    if (isCancelled) return `Cancelled after ${completedCount} steps`
    return `Completed ${completedCount} steps`
  }

  return (
    <div className={compact ? "my-2" : "my-3"}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 rounded text-xs transition-colors w-full",
          compact ? "py-1 px-1.5" : "py-1.5 px-2 -mx-2 hover:bg-muted/50",
          variant === "chat"
            ? isStreaming
              ? "text-primary"
              : "text-muted-foreground"
            : isStreaming
              ? "text-status-running"
              : "text-muted-foreground",
        )}
      >
        {renderStatusIcon()}
        <span className="flex-1 text-left truncate">
          {getStatusLabel()}
        </span>
        <ExpandIcon
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground/50 transition-transform",
            variant === "chat" ? isExpanded && "rotate-180" : isExpanded && "rotate-90",
          )}
        />
      </button>

      {isExpanded && (
        <div className="mt-1 ml-1 pl-3 border-l-2 border-border/50 space-y-0.5">
          {activities.map((event) => (
            <ActivityEventItem
              key={event.id}
              event={event}
              isExpanded={expandedEvents.has(event.id)}
              onToggle={() => toggleEvent(event.id)}
              compact={compact}
              variant={variant}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Agent Running Card status
export type AgentRunningStatus = "running" | "cancelling" | "cancelled" | "paused" | "resuming"

// Agent Running Card - collapsible card for streaming state
interface AgentRunningCardProps {
  activities: ActivityEvent[]
  elapsedTime?: string
  status?: AgentRunningStatus
  hasQueuedMessages?: boolean
  // Editor state (controlled from parent)
  editorValue: string
  editorAttachments: MessageAttachment[]
  onEditorChange: (value: string) => void
  onEditorAttachmentsChange: (attachments: MessageAttachment[]) => void
  // Actions
  onCancel?: () => void
  onResume?: () => void
  onSubmit?: () => void
  onDismiss?: () => void
}

export function AgentRunningCard({
  activities,
  elapsedTime = "00:00",
  status = "running",
  hasQueuedMessages = false,
  editorValue,
  editorAttachments,
  onEditorChange,
  onEditorAttachmentsChange,
  onCancel,
  onResume,
  onSubmit,
  onDismiss,
}: AgentRunningCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())
  const headerRef = React.useRef<HTMLDivElement>(null)
  const editorContainerRef = React.useRef<HTMLDivElement>(null)

  const toggleExpand = () => {
    if (headerRef.current) {
      // Remember header position before toggling
      const headerRect = headerRef.current.getBoundingClientRect()
      const headerTop = headerRect.top

      setIsExpanded(!isExpanded)

      // After render, scroll to keep header at same visual position
      requestAnimationFrame(() => {
        if (headerRef.current) {
          const newHeaderRect = headerRef.current.getBoundingClientRect()
          const delta = newHeaderRect.top - headerTop
          if (delta !== 0) {
            const scrollContainer = headerRef.current.closest('.overflow-y-auto')
            if (scrollContainer) {
              scrollContainer.scrollTop += delta
            }
          }
        }
      })
    } else {
      setIsExpanded(!isExpanded)
    }
  }

  const toggleEvent = (eventId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newExpanded = new Set(expandedEvents)
    if (newExpanded.has(eventId)) {
      newExpanded.delete(eventId)
    } else {
      newExpanded.add(eventId)
    }
    setExpandedEvents(newExpanded)
  }

  const showEditor = status === "cancelling" || status === "resuming"

  // Handle click outside to dismiss
  React.useEffect(() => {
    if (!showEditor) return
    
    const handleClickOutside = (e: MouseEvent) => {
      if (editorContainerRef.current && !editorContainerRef.current.contains(e.target as Node)) {
        onDismiss?.()
      }
    }
    
    // Delay adding listener to avoid immediate trigger
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside)
    }, 0)
    
    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [showEditor, onDismiss])

  if (!activities.length) return null

  // Latest activity shown in header, history shown above
  const latestActivity = activities[activities.length - 1]
  const historyActivities = activities.slice(0, -1)
  const currentLabel = latestActivity ? eventLabels[latestActivity.type] : "Processing"
  const LatestIcon = latestActivity ? eventIcons[latestActivity.type] : Wrench

  const isPaused = status === "paused"
  const isCancelling = status === "cancelling"
  const isResuming = status === "resuming"
  const isCancelled = status === "cancelled"
  const isRunning = status === "running"
  
  // Show paused indicator when not actively running
  const showPausedIndicator = !isRunning

  // Helper to render expandable history steps
  const renderHistorySteps = () => (
    <>
      {isExpanded && historyActivities.length > 0 && (
        <div className="px-3 py-2 space-y-0.5 border border-b-0 border-border rounded-t-lg bg-card">
          {historyActivities.map((event) => {
            const Icon = eventIcons[event.type] || Wrench
            const isEventExpanded = expandedEvents.has(event.id)
            const hasDetail = !!event.detail

            return (
              <div key={event.id} className="group">
                <button
                  onClick={(e) => hasDetail && toggleEvent(event.id, e)}
                  className={cn(
                    "w-full flex items-center gap-2 text-xs py-1 px-1 -mx-1 rounded transition-colors text-muted-foreground",
                    hasDetail && "hover:bg-muted/50 cursor-pointer",
                    !hasDetail && "cursor-default"
                  )}
                >
                  {/* Status icon */}
                  <Check className="w-3.5 h-3.5 text-status-success flex-shrink-0" />

                  {/* Type badge - fixed width, left aligned */}
                  <span className="flex items-center gap-1 w-16 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 bg-muted text-muted-foreground">
                    <Icon className="w-3 h-3" />
                    {eventLabels[event.type]}
                  </span>
                  {/* Shell sub-type badge */}
                  {event.type === "shell" && event.shellType && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground flex-shrink-0">
                      {event.shellType}
                    </span>
                  )}

                  {/* Title */}
                  <span className="flex-1 text-left truncate">{event.title}</span>

                  {/* Duration */}
                  {event.duration && (
                    <span className="text-[10px] text-muted-foreground/60 font-mono w-8 text-right flex-shrink-0">
                      {event.duration}
                    </span>
                  )}

                  {/* Expand indicator */}
                  {hasDetail && (
                    <ChevronRight
                      className={cn(
                        "w-3 h-3 text-muted-foreground/40 transition-transform flex-shrink-0",
                        isEventExpanded && "rotate-90"
                      )}
                    />
                  )}
                </button>

                {/* Detail panel */}
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
    </>
  )

  // Cancelled state: don't render, let parent render ActivityStream instead
  if (isCancelled) {
    return null
  }

  return (
    <div className="my-3">
      {renderHistorySteps()}

      {/* Header - always visible, shows current/latest step */}
      <div
        ref={headerRef}
        className={cn(
          "flex items-center justify-between px-3 py-2 bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors border border-border",
          isExpanded && historyActivities.length > 0 ? "rounded-t-none border-t-0" : "rounded-lg",
          isExpanded && historyActivities.length > 0 && !showEditor && "rounded-b-lg",
          !isExpanded && !showEditor && "rounded-lg",
          !isExpanded && showEditor && "rounded-b-none border-b-0",
          isExpanded && showEditor && "rounded-b-none border-b-0"
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
          
          {/* Type badge for current step */}
          <span className={cn(
            "flex items-center gap-1 w-16 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 transition-colors",
            showPausedIndicator 
              ? "bg-status-warning/10 text-status-warning" 
              : "bg-primary/10 text-primary"
          )}>
            <LatestIcon className="w-3 h-3" />
            {showPausedIndicator ? (isPaused ? "Paused" : isResuming ? "Resume" : "Cancel") : currentLabel}
          </span>

          <span className={cn(
            "text-xs truncate transition-colors",
            showPausedIndicator ? "text-muted-foreground" : "text-foreground"
          )}>
            {latestActivity?.title}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {elapsedTime}
          </span>

          {/* Action button - always show to maintain layout, stop propagation to prevent collapse toggle */}
          <div className="flex items-center justify-center ml-1 w-7" onClick={(e) => e.stopPropagation()}>
            {isPaused ? (
              <button
                onClick={onResume}
                className="p-1.5 text-status-warning hover:text-status-warning hover:bg-status-warning/10 rounded-md transition-all"
                title="Resume"
              >
                <Play className="w-3.5 h-3.5" />
              </button>
            ) : showEditor ? (
              <div 
                className="p-1.5 text-status-warning"
                title={isResuming ? "Resuming..." : "Cancelling..."}
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              </div>
            ) : (
              <button
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

      {/* Editor - shown when cancelling or resuming */}
      {showEditor && (
        <div 
          ref={editorContainerRef}
          className="border border-t-0 border-border rounded-b-lg bg-card"
        >
          <MessageEditor
            value={editorValue}
            onChange={onEditorChange}
            attachments={editorAttachments}
            onAttachmentsChange={onEditorAttachmentsChange}
            onSubmit={() => onSubmit?.()}
            onCancel={() => onDismiss?.()}
            placeholder={
              status === "resuming"
                ? "Type a message to resume with new instructions..."
                : hasQueuedMessages
                  ? "Type a message to interrupt, or press Esc to pause..."
                  : "Type a message to interrupt, or press Esc to cancel..."
            }
            autoFocus
          />
        </div>
      )}
    </div>
  )
}
