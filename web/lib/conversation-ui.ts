"use client"

import type {
  AttachmentRef,
  ConversationEntry,
  ConversationSnapshot,
  ThinkingEffort,
} from "./luban-api"
import { AGENT_MODELS } from "./agent-settings"

export interface ActivityEvent {
  id: string
  type: "thinking" | "tool_call" | "file_edit" | "bash" | "search" | "complete"
  title: string
  detail?: string
  status: "running" | "done"
  duration?: string
  badge?: string
}

export interface SystemEvent {
  id: string
  type: "event"
  eventType: "task_created" | "task_started" | "task_completed" | "task_cancelled" | "status_changed"
  title: string
  timestamp?: string
}

export interface Message {
  id: string
  type: "user" | "assistant" | "event"
  content: string
  attachments?: AttachmentRef[]
  timestamp?: string
  isStreaming?: boolean
  isCancelled?: boolean
  activities?: ActivityEvent[]
  metadata?: {
    toolCalls?: number
    thinkingSteps?: number
    duration?: string
  }
  codeReferences?: { file: string; line: number }[]
  eventType?: "task_created" | "task_started" | "task_completed" | "task_cancelled" | "status_changed"
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function formatDurationMs(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const s = seconds % 60
  const minutes = Math.floor(seconds / 60)
  const m = minutes % 60
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h${m}m${s}s`
  if (minutes > 0) return `${minutes}m${s}s`
  return `${s}s`
}

export function agentModelLabel(modelId: string | null | undefined): string {
  if (!modelId) return "Model"
  return AGENT_MODELS.find((m) => m.id === modelId)?.label ?? modelId
}

export function thinkingEffortLabel(effort: ThinkingEffort | null | undefined): string {
  if (!effort) return "Effort"
  if (effort === "minimal") return "Minimal"
  if (effort === "low") return "Low"
  if (effort === "medium") return "Medium"
  if (effort === "high") return "High"
  if (effort === "xhigh") return "XHigh"
  return effort
}

export function activityFromAgentItemLike(args: {
  id: string
  kind: string
  payload: unknown
  forcedStatus?: "running" | "done"
}): ActivityEvent {
  const payload = args.payload as any
  const kind = args.kind
  const forcedStatus = args.forcedStatus

  const firstSentence = (text: string): string => {
    const trimmed = text.trim()
    if (!trimmed) return ""

    const stripSummaryMarkdown = (value: string): string => {
      // Strip simple markdown emphasis markers from short summaries so the UI
      // displays plain text (e.g. "**Plan**" -> "Plan").
      let out = value
      out = out.replaceAll(/\*\*([^*]+?)\*\*/g, "$1")
      out = out.replaceAll(/__([^_]+?)__/g, "$1")
      out = out.replaceAll(/\*\*/g, "")
      out = out.replaceAll(/__/g, "")
      return out.trim()
    }

    const firstLine = trimmed.split(/\r?\n/)[0] ?? trimmed
    const match = firstLine.match(/^(.+?[.!?])(\s|$)/)
    const sentence = stripSummaryMarkdown((match?.[1] ?? firstLine).trim())
    const fallback = stripSummaryMarkdown(firstLine.trim())
    return sentence.length > 0 ? sentence : fallback
  }

  const normalizeShellCommand = (
    rawCommand: string,
  ): { displayCommand: string; badge?: "zsh" | "bash" } => {
    const trimmed = rawCommand.trim()
    const match = trimmed.match(/^(?:\/bin\/)?(zsh|bash)\s+-lc\s+(.+)$/)
    if (!match) return { displayCommand: trimmed }

    const shell = (match[1] ?? "").toLowerCase() as "zsh" | "bash"
    let inner = (match[2] ?? "").trim()
    if (
      (inner.startsWith('"') && inner.endsWith('"')) ||
      (inner.startsWith("'") && inner.endsWith("'"))
    ) {
      inner = inner.slice(1, -1).trim()
    }
    return { displayCommand: inner.length > 0 ? inner : trimmed, badge: shell }
  }

  if (kind === "command_execution") {
    const status = forcedStatus ?? (payload?.status === "in_progress" ? "running" : "done")
    const normalized = normalizeShellCommand(payload?.command ?? "Command")
    return {
      id: args.id,
      type: "bash",
      title: normalized.displayCommand,
      detail: payload?.aggregated_output ?? "",
      status,
      badge: normalized.badge,
    }
  }

  if (kind === "file_change") {
    const status = forcedStatus ?? "done"
    const changes = Array.isArray(payload?.changes) ? payload.changes : []

    const normalizePathForSummary = (raw: unknown): string => {
      const value = String(raw ?? "").trim()
      if (!value) return ""
      return value.replace(/^(\.\/|\.\\)+/, "")
    }

    const paths = (() => {
      const out: string[] = []
      for (const change of changes) {
        const path = normalizePathForSummary(change?.path)
        if (!path) continue
        if (out.includes(path)) continue
        out.push(path)
      }
      return out
    })()

    const title = (() => {
      if (paths.length === 0) return `File changes (${changes.length})`
      const limit = 3
      const shown = paths.slice(0, limit)
      const remaining = paths.length - shown.length
      const suffix = remaining > 0 ? `, +${remaining}` : ""
      return `File changes: ${shown.join(", ")}${suffix}`
    })()

    const detail = changes.map((c: any) => `${c.kind ?? "update"} ${normalizePathForSummary(c.path)}`).join("\n")
    return {
      id: args.id,
      type: "file_edit",
      title,
      detail,
      status,
    }
  }

  if (kind === "mcp_tool_call") {
    const status = forcedStatus ?? (payload?.status === "in_progress" ? "running" : "done")
    const title = `${payload?.server ?? "mcp"}.${payload?.tool ?? "tool"}`
    const detail = safeStringify({
      arguments: payload?.arguments ?? null,
      result: payload?.result ?? null,
      error: payload?.error ?? null,
      status: payload?.status ?? null,
    })
    return { id: args.id, type: "tool_call", title, detail, status }
  }

  if (kind === "web_search") {
    return {
      id: args.id,
      type: "search",
      title: payload?.query ?? "Web search",
      status: forcedStatus ?? "done",
    }
  }

  if (kind === "todo_list") {
    const items = Array.isArray(payload?.items) ? payload.items : []
    const detail = items.map((i: any) => `${i.completed ? "[x]" : "[ ]"} ${i.text ?? ""}`).join("\n")
    return { id: args.id, type: "tool_call", title: "Todo list", detail, status: forcedStatus ?? "done" }
  }

  if (kind === "reasoning") {
    const full = payload?.text ?? ""
    const summary = firstSentence(full)
    return {
      id: args.id,
      type: "thinking",
      title: summary.length > 0 ? summary : "Think",
      detail: full,
      status: forcedStatus ?? "done",
    }
  }

  if (kind === "error") {
    return {
      id: args.id,
      type: "tool_call",
      title: "Error",
      detail: payload?.message ?? "",
      status: forcedStatus ?? "done",
    }
  }

  return {
    id: args.id,
    type: "complete",
    title: kind,
    detail: safeStringify(args.payload),
    status: forcedStatus ?? "done",
  }
}

export function activityFromAgentItem(entry: Extract<ConversationEntry, { type: "agent_item" }>): ActivityEvent {
  return activityFromAgentItemLike({ id: entry.id, kind: entry.kind, payload: entry.payload })
}

export function buildMessages(conversation: ConversationSnapshot | null): Message[] {
  if (!conversation) return []

  const out: Message[] = []
  

  
  let assistantContent = ""
  let assistantActivities: ActivityEvent[] = []
  let assistantToolCalls = 0
  let assistantThinkingSteps = 0
  let assistantDurationMs: number | null = null
  let assistantCancelled = false
  const seenAgentItemIds = new Set<string>()

  function flushAssistant() {
    if (assistantContent.trim().length === 0 && assistantActivities.length === 0) return
    const metadata =
      assistantToolCalls > 0 || assistantThinkingSteps > 0 || assistantDurationMs != null
        ? {
            toolCalls: assistantToolCalls > 0 ? assistantToolCalls : undefined,
            thinkingSteps: assistantThinkingSteps > 0 ? assistantThinkingSteps : undefined,
            duration:
              assistantDurationMs != null ? formatDurationMs(assistantDurationMs) : undefined,
          }
        : undefined
    out.push({
      id: `a_${out.length}`,
      type: "assistant",
      content: assistantContent.trim(),
      timestamp: new Date().toISOString(),
      isCancelled: assistantCancelled || undefined,
      activities: assistantActivities.length > 0 ? assistantActivities : undefined,
      metadata,
    })
    assistantContent = ""
    assistantActivities = []
    assistantToolCalls = 0
    assistantThinkingSteps = 0
    assistantDurationMs = null
    assistantCancelled = false
  }

  for (const entry of conversation.entries) {
    if (entry.type === "user_message") {
      flushAssistant()
      out.push({
        id: `u_${out.length}`,
        type: "user",
        content: entry.text,
        attachments: entry.attachments,
        timestamp: new Date().toISOString(),
      })
      continue
    }

    if (entry.type === "agent_item") {
      seenAgentItemIds.add(entry.id)
      if (entry.kind === "agent_message") {
        const payload = entry.payload as any
        const text = typeof payload?.text === "string" ? payload.text : ""
        assistantContent = assistantContent.length === 0 ? text : `${assistantContent}\n\n${text}`
      } else {
        assistantActivities.push(activityFromAgentItem(entry))
        if (entry.kind === "reasoning") {
          assistantThinkingSteps += 1
        } else if (entry.kind !== "error") {
          assistantToolCalls += 1
        }
      }
      continue
    }

    if (entry.type === "turn_duration") {
      assistantDurationMs = entry.duration_ms
      continue
    }

    if (entry.type === "turn_usage") {
      continue
    }

    if (entry.type === "turn_error") {
      assistantActivities.push({
        id: `turn_error_${out.length}`,
        type: "tool_call",
        title: "Turn error",
        detail: entry.message,
        status: "done",
      })
      continue
    }

    if (entry.type === "turn_canceled") {
      assistantCancelled = true
      assistantActivities.push({
        id: `turn_canceled_${out.length}`,
        type: "tool_call",
        title: "Turn canceled",
        status: "done",
      })
      continue
    }
  }

  if (conversation.run_status === "running" && conversation.in_progress_items.length > 0) {
    for (const item of conversation.in_progress_items) {
      if (seenAgentItemIds.has(item.id)) continue

      if (item.kind === "agent_message") {
        const payload = item.payload as any
        const text = typeof payload?.text === "string" ? payload.text : ""
        if (text.length > 0) {
          assistantContent = assistantContent.length === 0 ? text : `${assistantContent}\n\n${text}`
        }
        continue
      }

      assistantActivities.push(
        activityFromAgentItemLike({
          id: item.id,
          kind: item.kind,
          payload: item.payload,
          forcedStatus: "running",
        }),
      )
    }
  }

  if (conversation.run_status === "running" && !assistantActivities.some((a) => a.status === "running")) {
    assistantActivities.push({
      id: "synthetic_running",
      type: "thinking",
      title: "Running...",
      status: "running",
    })
  }

  flushAssistant()

  if (conversation.run_status === "running") {
    const last = out[out.length - 1]
    if (last && last.type === "assistant") {
      last.isStreaming = true
    }
  }
  
  // Prepend system events for demo/review purposes
  // Use a sample timestamp for demo (e.g., 2 hours ago)
  const demoTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const systemEvents: Message[] = [
    {
      id: "event_task_created",
      type: "event",
      eventType: "task_created",
      content: "created the task",
      timestamp: demoTimestamp,
    },
    {
      id: "event_status_todo",
      type: "event",
      eventType: "status_changed",
      content: "moved from Backlog to Todo",
      timestamp: demoTimestamp,
    },
    {
      id: "event_status_in_progress",
      type: "event",
      eventType: "status_changed", 
      content: "changed status to In Progress",
      timestamp: demoTimestamp,
    },
  ]
  
  // Insert events at the beginning
  out.unshift(...systemEvents)
  
  return out
}
