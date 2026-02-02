"use client"

import type React from "react"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLuban } from "@/lib/luban-context"
import { buildMessages, type Message } from "@/lib/conversation-ui"
import { TaskActivityView } from "@/components/task-activity-view"
import { fetchCodexCustomPrompts, uploadAttachment } from "@/lib/luban-http"
import type {
  AttachmentRef,
  CodexCustomPromptSnapshot,
  ThinkingEffort,
} from "@/lib/luban-api"
import { attachmentHref } from "@/lib/attachment-href"
import { onAddChatAttachments } from "@/lib/chat-attachment-events"
import {
  draftKey,
  followTailKey,
  loadJson,
  saveJson,
} from "@/lib/ui-prefs"
import type { ChangedFile } from "./right-sidebar"
import { type ComposerAttachment as EditorComposerAttachment } from "@/components/shared/message-editor"
import { openSettingsPanel } from "@/lib/open-settings"
import { focusChatInput } from "@/lib/focus-chat-input"
import { useAgentCancelHotkey } from "@/lib/use-agent-cancel-hotkey"
import { EscCancelHint } from "@/components/esc-cancel-hint"
import { ChatComposer } from "@/components/chat-composer"
import { getActiveProjectInfo } from "@/lib/active-project-info"

type ComposerAttachment = EditorComposerAttachment

type PersistedChatDraft = {
  text: string
  attachments?: AttachmentRef[]
}

export function TaskActivityPanel({
  pendingDiffFile,
  onDiffFileOpened,
}: {
  pendingDiffFile?: ChangedFile | null
  onDiffFileOpened?: () => void
}) {
  const [codexCustomPrompts, setCodexCustomPrompts] = useState<CodexCustomPromptSnapshot[]>([])

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const {
    app,
    activeWorkdirId: activeWorkspaceId,
    activeWorkdir: activeWorkspace,
    activeTaskId: activeThreadId,
    tasks: threads,
    conversation,
    sendAgentMessage,
    queueAgentMessage,
    cancelAgentTurn,
    cancelAndSendAgentMessage,
    setChatModel,
    setThinkingEffort,
    setChatRunner,
    setChatAmpMode,
  } = useLuban()

  const [draftText, setDraftText] = useState("")
  const [followTail, setFollowTail] = useState(true)
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const attachmentScopeRef = useRef<string>("")
  const attachmentScope = `${activeWorkspaceId ?? "none"}:${activeThreadId ?? "none"}`

  const attachmentsFromRefs = useCallback(
    (workspaceId: number | null, refs: AttachmentRef[]): ComposerAttachment[] => {
      return refs.map((attachment) => {
        const isImage = attachment.kind === "image"
        const previewUrl =
          isImage && workspaceId != null ? attachmentHref({ workspaceId, attachment }) ?? undefined : undefined
        return {
          id: `ref-${attachment.id}`,
          type: isImage ? "image" : "file",
          name: attachment.name,
          size: attachment.byte_len,
          status: "ready",
          attachment,
          previewUrl,
        }
      })
    },
    [],
  )

  const messages = useMemo(() => buildMessages(conversation), [conversation])

  const messageHistory = useMemo(() => {
    return messages.filter((m) => m.type === "user").map((m) => m.content)
  }, [messages])

  const isAgentRunning = conversation?.run_status === "running"

  const ESC_TIMEOUT_MS = 3000
  const { escHintVisible } = useAgentCancelHotkey({
    enabled: isAgentRunning,
    blocked: false,
    onCancel: () => {
      if (activeWorkspaceId == null || activeThreadId == null) return
      cancelAgentTurn()
    },
    timeoutMs: ESC_TIMEOUT_MS,
  })

  useEffect(() => {
    return onAddChatAttachments((incoming) => {
      if (activeWorkspaceId == null || activeThreadId == null) return
      const scopeAtStart = attachmentScopeRef.current
      const items: ComposerAttachment[] = incoming.map((attachment) => {
        const isImage = attachment.kind === "image"
        const previewUrl = isImage ? attachmentHref({ workspaceId: activeWorkspaceId, attachment }) ?? undefined : undefined
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: isImage ? "image" : "file",
          name: attachment.name,
          size: attachment.byte_len,
          previewUrl,
          status: "ready",
          attachment,
        }
      })

      if (attachmentScopeRef.current !== scopeAtStart) return
      setAttachments((prev) => [...prev, ...items])
    })
  }, [activeWorkspaceId, activeThreadId])

  useEffect(() => {
    if (attachmentScope === attachmentScopeRef.current) return
    attachmentScopeRef.current = attachmentScope

    if (activeWorkspaceId == null || activeThreadId == null) {
      setDraftText("")
      setAttachments([])
      return
    }

    const saved = loadJson<PersistedChatDraft>(draftKey(activeWorkspaceId, activeThreadId))
    setDraftText(saved?.text ?? "")
    setAttachments(attachmentsFromRefs(activeWorkspaceId, saved?.attachments ?? []))
    setFollowTail(localStorage.getItem(followTailKey(activeWorkspaceId, activeThreadId)) !== "false")
  }, [attachmentScope, activeWorkspaceId, activeThreadId, attachmentsFromRefs])

  useEffect(() => {
    if (activeWorkspaceId == null || activeThreadId == null) return
    const readyAttachments = attachments.filter((a) => a.status === "ready" && a.attachment)
    const refs = readyAttachments.map((a) => a.attachment as AttachmentRef)
    saveJson(draftKey(activeWorkspaceId, activeThreadId), { text: draftText, attachments: refs })
  }, [draftText, attachments, activeWorkspaceId, activeThreadId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const prompts = await fetchCodexCustomPrompts()
        if (cancelled) return
        setCodexCustomPrompts(prompts)
      } catch (err) {
        console.warn("fetchCodexCustomPrompts failed", err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [app?.rev])

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (activeWorkspaceId == null) return

    const scopeAtStart = attachmentScopeRef.current
    const workspaceId = activeWorkspaceId

    Array.from(files).forEach((file) => {
      const tempId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const isImage = file.type.startsWith("image/")
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined

      const item: ComposerAttachment = {
        id: tempId,
        type: isImage ? "image" : "file",
        name: file.name,
        size: file.size,
        previewUrl,
        status: "uploading",
      }
      setAttachments((prev) => [...prev, item])

      void (async () => {
        try {
          const kind = file.type.startsWith("image/") ? "image" : "file"
          const uploaded = await uploadAttachment({ workspaceId, file, kind })
          if (attachmentScopeRef.current !== scopeAtStart) return
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId ? { ...a, status: "ready", attachment: uploaded } : a
            )
          )
        } catch (err) {
          console.error("upload failed", err)
          if (attachmentScopeRef.current !== scopeAtStart) return
          setAttachments((prev) => prev.filter((a) => a.id !== tempId))
        }
      })()
    })
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === "file") {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      const dt = new DataTransfer()
      files.forEach((f) => dt.items.add(f))
      handleFileSelect(dt.files)
    }
  }

  const handleCommand = (commandId: string) => {
    const cmd = codexCustomPrompts.find((c) => c.id === commandId)
    if (!cmd) return
    setDraftText(cmd.contents)
    focusChatInput()
  }

  const handleSend = () => {
    if (activeWorkspaceId == null || activeThreadId == null) return
    const text = draftText.trim()
    const readyAttachments = attachments.filter((a) => a.status === "ready" && a.attachment)
    const refs = readyAttachments.map((a) => a.attachment as AttachmentRef)
    if (text.length === 0 && refs.length === 0) return

    if (isAgentRunning) {
      queueAgentMessage(text, refs.length > 0 ? refs : undefined)
    } else {
      sendAgentMessage(text, refs.length > 0 ? refs : undefined)
    }
    setDraftText("")
    setAttachments([])
  }

  const taskTitle = useMemo(() => {
    if (activeThreadId == null) return "Untitled Task"
    const thread = threads.find((t) => t.task_id === activeThreadId)
    return thread?.title ?? "Untitled Task"
  }, [threads, activeThreadId])

  const canSend = useMemo(() => {
    if (activeWorkspaceId == null || activeThreadId == null) return false
    const hasUploading = attachments.some((a) => a.status === "uploading")
    if (hasUploading) return false
    const hasReady = attachments.some((a) => a.status === "ready" && a.attachment != null)
    return draftText.trim().length > 0 || hasReady
  }, [activeWorkspaceId, activeThreadId, attachments, draftText])

  const inputComponent = (
    <div className="relative">
      <EscCancelHint visible={escHintVisible} timeoutMs={ESC_TIMEOUT_MS} />
      <ChatComposer
        value={draftText}
        onChange={setDraftText}
        attachments={attachments}
        onRemoveAttachment={removeAttachment}
        onFileSelect={handleFileSelect}
        onPaste={handlePaste}
        onAddAttachmentRef={(attachment) => {
          const isImage = attachment.kind === "image"
          const previewUrl =
            isImage && activeWorkspaceId != null
              ? attachmentHref({ workspaceId: activeWorkspaceId, attachment }) ?? undefined
              : undefined
          setAttachments((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              type: isImage ? "image" : "file",
              name: attachment.name,
              size: attachment.byte_len,
              previewUrl,
              status: "ready",
              attachment,
            },
          ])
        }}
        workspaceId={activeWorkspaceId}
        commands={codexCustomPrompts}
        messageHistory={messageHistory}
        onCommand={handleCommand}
        disabled={activeWorkspaceId == null || activeThreadId == null}
        agentModelId={conversation?.agent_model_id}
        agentThinkingEffort={conversation?.thinking_effort}
        defaultModelId={app?.agent.default_model_id ?? null}
        defaultThinkingEffort={app?.agent.default_thinking_effort ?? null}
        defaultAmpMode={app?.agent.amp_mode ?? null}
        defaultRunner={app?.agent.default_runner ?? null}
        runner={conversation?.agent_runner ?? null}
        ampMode={conversation?.amp_mode ?? null}
        onChangeRunner={(runner) => {
          if (activeWorkspaceId == null || activeThreadId == null) return
          setChatRunner(activeWorkspaceId, activeThreadId, runner)
        }}
        onChangeAmpMode={(mode) => {
          if (activeWorkspaceId == null || activeThreadId == null) return
          if (mode == null) return
          setChatAmpMode(activeWorkspaceId, activeThreadId, mode)
        }}
        onOpenAgentSettings={(agentId, agentFilePath) => openSettingsPanel("agent", { agentId, agentFilePath })}
        onChangeModelId={(modelId) => {
          if (activeWorkspaceId == null || activeThreadId == null) return
          setChatModel(activeWorkspaceId, activeThreadId, modelId)
        }}
        onChangeThinkingEffort={(effort) => {
          if (activeWorkspaceId == null || activeThreadId == null) return
          setThinkingEffort(activeWorkspaceId, activeThreadId, effort)
        }}
        onSend={handleSend}
        canSend={canSend}
        codexEnabled={app?.agent.codex_enabled ?? true}
        ampEnabled={app?.agent.amp_enabled ?? true}
        compact
      />
    </div>
  )

  const taskDescription = useMemo(() => {
    if (activeThreadId == null) return undefined
    // TODO: Replace with actual task summary from API when available
    return "This task was created to help you accomplish your goal. The agent will analyze your request and provide assistance through a series of steps shown in the activity feed below."
  }, [activeThreadId])

  return (
    <TaskActivityView
      title={taskTitle}
      description={taskDescription}
      messages={messages}
      isLoading={isAgentRunning}
      inputComponent={inputComponent}
      className="flex-1 min-w-0"
    />
  )
}
