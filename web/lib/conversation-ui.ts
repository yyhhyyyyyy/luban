"use client"

import type {
  ConversationEntry,
  ConversationSnapshot,
  ThinkingEffort,
} from "./luban-api"

export interface ActivityEvent {
  id: string
  type: "thinking" | "tool_call" | "file_edit" | "bash" | "search" | "complete"
  title: string
  detail?: string
  status: "running" | "done"
  duration?: string
}

export interface Message {
  id: string
  type: "user" | "assistant"
  content: string
  timestamp?: string
  isStreaming?: boolean
  activities?: ActivityEvent[]
  metadata?: {
    toolCalls?: number
    thinkingSteps?: number
    duration?: string
  }
  codeReferences?: { file: string; line: number }[]
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
  if (modelId === "gpt-5.2") return "GPT-5.2"
  if (modelId === "gpt-5.2-codex") return "GPT-5.2-Codex"
  if (modelId === "gpt-5.1-codex-max") return "GPT-5.1-Codex-Max"
  return modelId
}

export function thinkingEffortLabel(effort: ThinkingEffort | null | undefined): string {
  if (!effort) return "Effort"
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

  if (kind === "command_execution") {
    const status = forcedStatus ?? (payload?.status === "in_progress" ? "running" : "done")
    return {
      id: args.id,
      type: "bash",
      title: payload?.command ?? "Command",
      detail: payload?.aggregated_output ?? "",
      status,
    }
  }

  if (kind === "file_change") {
    const status = forcedStatus ?? "done"
    const changes = Array.isArray(payload?.changes) ? payload.changes : []
    const detail = changes.map((c: any) => `${c.kind ?? "update"} ${c.path ?? ""}`).join("\n")
    return {
      id: args.id,
      type: "file_edit",
      title: `File changes (${changes.length})`,
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
    return {
      id: args.id,
      type: "thinking",
      title: "Reasoning",
      detail: payload?.text ?? "",
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
      activities: assistantActivities.length > 0 ? assistantActivities : undefined,
      metadata,
    })
    assistantContent = ""
    assistantActivities = []
    assistantToolCalls = 0
    assistantThinkingSteps = 0
    assistantDurationMs = null
  }

  for (const entry of conversation.entries) {
    if (entry.type === "user_message") {
      flushAssistant()
      out.push({
        id: `u_${out.length}`,
        type: "user",
        content: entry.text,
      })
      continue
    }

    if (entry.type === "agent_item") {
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
  return out
}

