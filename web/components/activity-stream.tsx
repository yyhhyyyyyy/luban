"use client"

import { useState } from "react"
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  Loader2,
  Pencil,
  Terminal,
  Wrench,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { ActivityEvent } from "@/lib/conversation-ui"

function ActivityEventItem({
  event,
  isExpanded,
  onToggle,
}: { event: ActivityEvent; isExpanded: boolean; onToggle: () => void }) {
  const icon = (() => {
    switch (event.type) {
      case "thinking":
        return <Brain className="w-3.5 h-3.5" />
      case "tool_call":
        return <Wrench className="w-3.5 h-3.5" />
      case "file_edit":
        return <Pencil className="w-3.5 h-3.5" />
      case "bash":
        return <Terminal className="w-3.5 h-3.5" />
      case "search":
        return <Eye className="w-3.5 h-3.5" />
      case "complete":
        return <CheckCircle2 className="w-3.5 h-3.5" />
      default:
        return <Wrench className="w-3.5 h-3.5" />
    }
  })()

  return (
    <div className="group">
      <button
        onClick={onToggle}
        className={cn(
          "w-full flex items-center gap-2 py-1 px-2 -mx-2 rounded text-xs transition-colors",
          "hover:bg-muted/50",
          event.status === "running" ? "text-primary" : "text-muted-foreground",
        )}
      >
        {event.status === "running" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
        <span className="flex-1 text-left truncate">{event.title}</span>
        {event.duration && <span className="text-[10px] text-muted-foreground/70">{event.duration}</span>}
        {event.detail && (
          <ChevronRight
            className={cn("w-3 h-3 text-muted-foreground/50 transition-transform", isExpanded && "rotate-90")}
          />
        )}
      </button>
      {isExpanded && event.detail && (
        <div className="ml-5 pl-2 border-l border-border text-[11px] text-muted-foreground py-1 mb-1">
          {event.detail}
        </div>
      )}
    </div>
  )
}

export function ActivityStream({ activities, isStreaming }: { activities: ActivityEvent[]; isStreaming?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())

  const latestActivity = activities[activities.length - 1]
  const completedCount = activities.filter((a) => a.status === "done").length

  const toggleEvent = (eventId: string) => {
    const nextExpanded = new Set(expandedEvents)
    if (nextExpanded.has(eventId)) {
      nextExpanded.delete(eventId)
    } else {
      nextExpanded.add(eventId)
    }
    setExpandedEvents(nextExpanded)
  }

  if (!activities.length) return null

  return (
    <div className="my-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 -mx-2 rounded text-xs transition-colors w-full",
          "hover:bg-muted/50",
          isStreaming ? "text-primary" : "text-muted-foreground",
        )}
      >
        {isStreaming && latestActivity?.status === "running" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-green-500" />
        )}
        <span className="flex-1 text-left truncate">
          {isStreaming ? latestActivity?.title : `Completed ${completedCount} steps`}
        </span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 text-muted-foreground/50 transition-transform", isExpanded && "rotate-180")}
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

