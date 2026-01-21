import type { ActivityEvent } from "./activity-item"

export interface CodeReference {
  file: string
  line: number
}

export interface MessageAttachment {
  id: string
  type: "image" | "file"
  name: string
  size: number
  preview?: string
}

export interface ChatMessage {
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
  codeReferences?: CodeReference[]
  isQueued?: boolean
  queuePosition?: number
  attachments?: MessageAttachment[]
}

