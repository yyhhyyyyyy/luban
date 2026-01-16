"use client"

import type React from "react"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Send,
  ChevronDown,
  ChevronRight,
  Copy,
  ArrowDown,
  MessageSquare,
  Plus,
  Clock,
  X,
  GitBranch,
  GitCompareArrows,
  RotateCcw,
  Pencil,
  Sparkles,
  Check,
  Loader2,
  Paperclip,
  Columns2,
  AlignJustify,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useLuban } from "@/lib/luban-context"
import { buildMessages } from "@/lib/conversation-ui"
import { ConversationView } from "@/components/conversation-view"
import { fetchCodexCustomPrompts, fetchWorkspaceDiff, uploadAttachment } from "@/lib/luban-http"
import type {
  AttachmentRef,
  CodexCustomPromptSnapshot,
  QueuedPromptSnapshot,
  ThinkingEffort,
} from "@/lib/luban-api"
import { onAddChatAttachments } from "@/lib/chat-attachment-events"
import { emitContextChanged } from "@/lib/context-events"
import {
  draftKey,
  followTailKey,
  loadJson,
  saveJson,
} from "@/lib/ui-prefs"
import type { ChangedFile } from "./right-sidebar"
import { MultiFileDiff, type FileContents } from "@pierre/diffs/react"
import { CodexAgentSelector } from "@/components/shared/agent-selector"
import { OpenButton } from "@/components/shared/open-button"
import { MessageEditor, type ComposerAttachment as EditorComposerAttachment } from "@/components/shared/message-editor"
import { AgentRunningCard, type AgentRunningStatus } from "@/components/shared/agent-running-card"
import { openSettingsPanel } from "@/lib/open-settings"
import { computeProjectDisplayNames } from "@/lib/project-display-names"

interface ChatTab {
  id: string
  title: string
  isActive: boolean
}

interface ArchivedTab {
  id: string
  title: string
}

type ComposerAttachment = EditorComposerAttachment
interface DiffFileData {
  file: ChangedFile
  oldFile: FileContents
  newFile: FileContents
}

export function ChatPanel({
  pendingDiffFile,
  onDiffFileOpened,
}: {
  pendingDiffFile?: ChangedFile | null
  onDiffFileOpened?: () => void
}) {
  const [showTabDropdown, setShowTabDropdown] = useState(false)
  const [codexCustomPrompts, setCodexCustomPrompts] = useState<CodexCustomPromptSnapshot[]>([])

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const {
    app,
    activeWorkspaceId,
    activeWorkspace,
    activeThreadId,
    threads,
    workspaceTabs,
    conversation,
    selectThread,
    createThread,
    closeThreadTab,
    restoreThreadTab,
    sendAgentMessage,
    cancelAgentTurn,
    renameWorkspaceBranch,
    aiRenameWorkspaceBranch,
    removeQueuedPrompt,
    reorderQueuedPrompt,
    updateQueuedPrompt,
    setChatModel,
    setThinkingEffort,
  } = useLuban()

  const [draftText, setDraftText] = useState("")
  const [followTail, setFollowTail] = useState(true)
  const programmaticScrollRef = useRef(false)

  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const attachmentScopeRef = useRef<string>("")
  const attachmentScope = `${activeWorkspaceId ?? "none"}:${activeThreadId ?? "none"}`

  const queuedPrompts = conversation?.pending_prompts ?? []
  const queuePaused = conversation?.queue_paused ?? false
  const [editingQueuedPromptId, setEditingQueuedPromptId] = useState<number | null>(null)
  const [draggingQueuedPromptId, setDraggingQueuedPromptId] = useState<number | null>(null)
  const [queuedDraftText, setQueuedDraftText] = useState("")
  const [queuedDraftAttachments, setQueuedDraftAttachments] = useState<ComposerAttachment[]>([])
  const [queuedDraftModelId, setQueuedDraftModelId] = useState<string | null>(null)
  const [queuedDraftThinkingEffort, setQueuedDraftThinkingEffort] = useState<ThinkingEffort | null>(null)
  const queuedAttachmentScopeRef = useRef<string>("")

  const [agentOverrideStatus, setAgentOverrideStatus] = useState<AgentRunningStatus | null>(null)
  const [agentEditorValue, setAgentEditorValue] = useState("")
  const [agentEditorAttachments, setAgentEditorAttachments] = useState<ComposerAttachment[]>([])
  const agentAttachmentScopeRef = useRef<string>("")

  const [activePanel, setActivePanel] = useState<"thread" | "diff">("thread")
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">("split")
  const [diffFiles, setDiffFiles] = useState<DiffFileData[]>([])
  const [diffActiveFileId, setDiffActiveFileId] = useState<string | undefined>(undefined)
  const [isDiffTabOpen, setIsDiffTabOpen] = useState(false)
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  const [isRenamingBranch, setIsRenamingBranch] = useState(false)
  const [branchRenameValue, setBranchRenameValue] = useState("")
  const branchInputRef = useRef<HTMLInputElement | null>(null)
  const branchRenameCanceledRef = useRef(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [branchRenamePending, setBranchRenamePending] = useState<{ initialBranch: string; startedAt: number } | null>(
    null,
  )
  const branchRenameSawRunningRef = useRef(false)
  const branchRenameTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return onAddChatAttachments((incoming) => {
      if (activeWorkspaceId == null || activeThreadId == null) return
      const scopeAtStart = attachmentScopeRef.current
      const items: ComposerAttachment[] = incoming.map((attachment) => {
        const isImage = attachment.kind === "image"
        const previewUrl =
          isImage ? `/api/workspaces/${activeWorkspaceId}/attachments/${attachment.id}?ext=${encodeURIComponent(attachment.extension)}` : undefined
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
    agentAttachmentScopeRef.current = `${attachmentScope}:agent:${Date.now()}`
    setAgentOverrideStatus(null)
    setAgentEditorValue("")
    setAgentEditorAttachments([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, activeThreadId])

  const messages = useMemo(() => buildMessages(conversation), [conversation])
  const agentCardMessageId = useMemo(() => {
    for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
      const msg = messages[idx]
      if (!msg) continue
      if (msg.type === "assistant" && msg.activities && msg.activities.length > 0) return msg.id
    }
    return null
  }, [messages])
  const messageHistory = useMemo(() => {
    const entries = conversation?.entries ?? []
    const items = entries
      .filter((entry) => entry.type === "user_message")
      .map((entry) => entry.text)
      .filter((text) => text.trim().length > 0)
    return items.slice(-50)
  }, [conversation?.rev])

  useEffect(() => {
    void fetchCodexCustomPrompts()
      .then((prompts) => setCodexCustomPrompts(prompts))
      .catch((err) => {
        console.warn("failed to load codex prompts:", err)
        setCodexCustomPrompts([])
      })
  }, [])

  const handleCommand = useCallback(
    (commandId: string) => {
      const match = codexCustomPrompts.find((p) => p.id === commandId) ?? null
      if (!match) return
      setDraftText(match.contents)
      persistDraft(match.contents)
      focusChatInput()
    },
    [codexCustomPrompts, persistDraft],
  )

  const handleAgentCommand = useCallback(
    (commandId: string) => {
      const match = codexCustomPrompts.find((p) => p.id === commandId) ?? null
      if (!match) return
      setAgentEditorValue(match.contents)
    },
    [codexCustomPrompts],
  )

  const projectInfo = useMemo(() => {
    if (app == null || activeWorkspaceId == null) {
      return { name: "Luban", branch: "", isGit: false, isMainBranch: false }
    }
    const displayNames = computeProjectDisplayNames(app.projects.map((p) => ({ path: p.path, name: p.name })))
    for (const p of app.projects) {
      for (const w of p.workspaces) {
        if (w.id !== activeWorkspaceId) continue
        return {
          name: displayNames.get(p.path) ?? p.slug,
          branch: w.branch_name,
          isGit: p.is_git,
          isMainBranch: w.workspace_name === "main",
        }
      }
    }
    return { name: "Luban", branch: "", isGit: false, isMainBranch: false }
  }, [app, activeWorkspaceId])

  const isBranchRenaming = activeWorkspace?.branch_rename_status === "running" || branchRenamePending != null

  useEffect(() => {
    if (branchRenamePending == null) {
      branchRenameSawRunningRef.current = false
      if (branchRenameTimeoutRef.current != null) {
        window.clearTimeout(branchRenameTimeoutRef.current)
        branchRenameTimeoutRef.current = null
      }
      return
    }

    if (projectInfo.branch !== branchRenamePending.initialBranch) {
      setBranchRenamePending(null)
      return
    }

    if (activeWorkspace?.branch_rename_status === "running") {
      branchRenameSawRunningRef.current = true
      return
    }

    if (branchRenameSawRunningRef.current) {
      setBranchRenamePending(null)
      return
    }

    if (branchRenameTimeoutRef.current == null) {
      branchRenameTimeoutRef.current = window.setTimeout(() => {
        branchRenameTimeoutRef.current = null
        setBranchRenamePending(null)
      }, 2000)
    }
  }, [activeWorkspace?.branch_rename_status, branchRenamePending, projectInfo.branch])

  useEffect(() => {
    if (!isRenamingBranch) return
    const el = branchInputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [isRenamingBranch])

  const threadsById = useMemo(() => {
    const out = new Map<number, (typeof threads)[number]>()
    for (const t of threads) out.set(t.thread_id, t)
    return out
  }, [threads])

  const openThreadIds = useMemo(() => {
    if (threads.length === 0) return []
    const ordered = workspaceTabs?.open_tabs ?? []
    const fromTabs = ordered.filter((id) => threadsById.has(id))
    if (fromTabs.length > 0) return fromTabs
    return threads.map((t) => t.thread_id)
  }, [threads, threadsById, workspaceTabs?.open_tabs])

  const openThreads = useMemo(() => {
    const out: (typeof threads)[number][] = []
    for (const id of openThreadIds) {
      const t = threadsById.get(id)
      if (t) out.push(t)
    }
    return out
  }, [openThreadIds, threadsById])

  const archivedTabs: ArchivedTab[] = useMemo(() => {
    const archived = workspaceTabs?.archived_tabs ?? []
    const out: ArchivedTab[] = []
    for (const id of [...archived].reverse()) {
      const t = threadsById.get(id)
      if (t) {
        out.push({ id: String(id), title: t.title })
      } else {
        out.push({ id: String(id), title: `Thread ${id}` })
      }
      if (out.length >= 20) break
    }
    return out
  }, [threadsById, workspaceTabs?.archived_tabs])

  const tabs: ChatTab[] = useMemo(
    () =>
      openThreads.map((t) => ({
        id: String(t.thread_id),
        title: t.title,
        isActive: t.thread_id === activeThreadId,
      })),
    [openThreads, activeThreadId],
  )

  const activeTabId = activeThreadId != null ? String(activeThreadId) : ""

  useEffect(() => {
    if (activeWorkspaceId == null || activeThreadId == null) {
      setDraftText("")
      setAttachments([])
      setEditingQueuedPromptId(null)
      setQueuedDraftText("")
      setQueuedDraftAttachments([])
      setQueuedDraftModelId(null)
      setQueuedDraftThinkingEffort(null)
      return
    }

    setFollowTail(true)
    localStorage.setItem(followTailKey(activeWorkspaceId, activeThreadId), "true")

    const saved = loadJson<{ text: string }>(draftKey(activeWorkspaceId, activeThreadId))
    setDraftText(saved?.text ?? "")
    setAttachments([])
    attachmentScopeRef.current = attachmentScope
    setEditingQueuedPromptId(null)
    setQueuedDraftText("")
    setQueuedDraftAttachments([])
    setQueuedDraftModelId(null)
    setQueuedDraftThinkingEffort(null)
  }, [activeWorkspaceId, activeThreadId])

  useEffect(() => {
    setIsDiffTabOpen(false)
    setActivePanel("thread")
    setDiffFiles([])
    setDiffActiveFileId(undefined)
    setIsDiffLoading(false)
    setDiffError(null)
  }, [activeWorkspaceId])

  const openDiffTab = useCallback(
    async (targetFile: ChangedFile) => {
      if (activeWorkspaceId == null) return
      setIsDiffTabOpen(true)
      setActivePanel("diff")
      setDiffActiveFileId(targetFile.id)
      setIsDiffLoading(true)
      setDiffError(null)

      try {
        const snap = await fetchWorkspaceDiff(activeWorkspaceId)
        const files: DiffFileData[] = (snap.files ?? []).map((file) => ({
          file: file.file,
          oldFile: { name: file.old_file.name, contents: file.old_file.contents },
          newFile: { name: file.new_file.name, contents: file.new_file.contents },
        }))
        setDiffFiles(files)
      } catch (err) {
        setDiffError(err instanceof Error ? err.message : String(err))
        setDiffFiles([])
      } finally {
        setIsDiffLoading(false)
      }
    },
    [activeWorkspaceId],
  )

  useEffect(() => {
    if (!pendingDiffFile) return
    void (async () => {
      await openDiffTab(pendingDiffFile)
      onDiffFileOpened?.()
    })()
  }, [onDiffFileOpened, openDiffTab, pendingDiffFile])

  function scheduleScrollToBottom() {
    const el = scrollContainerRef.current
    if (!el) return

    programmaticScrollRef.current = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
        programmaticScrollRef.current = false
      })
    })
  }

  useEffect(() => {
    if (!followTail) return
    if (messages.length === 0) return
    scheduleScrollToBottom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, followTail, activeWorkspaceId, activeThreadId])

  function persistDraft(nextText: string) {
    if (activeWorkspaceId == null || activeThreadId == null) return
    saveJson(draftKey(activeWorkspaceId, activeThreadId), {
      text: nextText,
    })
  }

  const handleTabClick = (tabId: string) => {
    const id = Number(tabId)
    if (!Number.isFinite(id)) return
    setActivePanel("thread")
    void selectThread(id)
  }

  const handleDiffTabClick = () => {
    if (!isDiffTabOpen) return
    setActivePanel("diff")
  }

  const handleCloseDiffTab = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDiffTabOpen(false)
    setActivePanel("thread")
    setDiffActiveFileId(undefined)
  }

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const id = Number(tabId)
    if (!Number.isFinite(id)) return
    if (openThreadIds.length <= 1) return
    void closeThreadTab(id)
  }

  const handleAddTab = () => {
    if (activeWorkspaceId == null) return
    createThread()
  }

  const handleRestoreTab = (tab: ArchivedTab) => {
    if (activeWorkspaceId == null) return
    const id = Number(tab.id)
    if (!Number.isFinite(id)) return
    setShowTabDropdown(false)
    void restoreThreadTab(id)
  }

  const handleSend = () => {
    if (activeWorkspaceId == null || activeThreadId == null) return
    const text = draftText.trim()
    const ready = attachments
      .filter((a) => a.status === "ready" && a.attachment != null)
      .map((a) => a.attachment!)
    const hasUploading = attachments.some((a) => a.status === "uploading")
    if (hasUploading) return
    if (text.length === 0 && ready.length === 0) return
    sendAgentMessage(text, ready)
    setDraftText("")
    persistDraft("")
    setAttachments([])
    setFollowTail(true)
    localStorage.setItem(followTailKey(activeWorkspaceId, activeThreadId), "true")
    scheduleScrollToBottom()
  }

  const attachmentsFromRefs = (refs: AttachmentRef[]): ComposerAttachment[] => {
    const workspaceId = activeWorkspaceId
    return refs.map((attachment) => {
      const isImage = attachment.kind === "image"
      const previewUrl =
        isImage && workspaceId != null
          ? `/api/workspaces/${workspaceId}/attachments/${attachment.id}?ext=${encodeURIComponent(attachment.extension)}`
          : undefined
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
  }

  const baseAgentStatus = useMemo<AgentRunningStatus | null>(() => {
    if (!conversation) return null
    if (conversation.run_status === "running") return "running"
    if (queuePaused && queuedPrompts.length > 0) return "paused"
    return null
  }, [conversation, queuePaused, queuedPrompts.length])

  const agentStatus = agentOverrideStatus ?? baseAgentStatus

  useEffect(() => {
    if (baseAgentStatus == null && agentOverrideStatus != null) {
      setAgentOverrideStatus(null)
    }
  }, [agentOverrideStatus, baseAgentStatus])

  const handleAgentCancel = () => {
    if (!agentStatus) return
    setAgentOverrideStatus("cancelling")
  }

  const handleAgentResume = () => {
    if (!agentStatus) return
    setAgentOverrideStatus("resuming")
  }

  const clearAgentEditor = () => {
    setAgentEditorValue("")
    setAgentEditorAttachments([])
  }

  const handleAgentDismiss = () => {
    if (agentOverrideStatus === "cancelling") {
      cancelAgentTurn()
    }
    setAgentOverrideStatus(null)
    clearAgentEditor()
  }

  const handleAgentSubmit = () => {
    if (activeWorkspaceId == null || activeThreadId == null) return
    const text = agentEditorValue.trim()
    const hasUploading = agentEditorAttachments.some((a) => a.status === "uploading")
    if (hasUploading) return
    const ready = agentEditorAttachments
      .filter((a) => a.status === "ready" && a.attachment != null)
      .map((a) => a.attachment!)
    if (text.length === 0 && ready.length === 0) return

    if (agentOverrideStatus === "cancelling") {
      cancelAgentTurn()
      sendAgentMessage(text, ready)
    } else if (agentOverrideStatus === "resuming") {
      sendAgentMessage(text, ready)
    }

    setAgentOverrideStatus(null)
    clearAgentEditor()
    setFollowTail(true)
    if (activeWorkspaceId != null && activeThreadId != null) {
      localStorage.setItem(followTailKey(activeWorkspaceId, activeThreadId), "true")
      scheduleScrollToBottom()
    }
  }

  const handleStartQueuedEdit = (promptId: number) => {
    if (activeWorkspaceId == null || activeThreadId == null) return
    const prompt = queuedPrompts.find((p) => p.id === promptId) ?? null
    if (!prompt) return

    setEditingQueuedPromptId(promptId)
    setQueuedDraftText(prompt.text)
    setQueuedDraftAttachments(attachmentsFromRefs(prompt.attachments ?? []))
    setQueuedDraftModelId(prompt.run_config?.model_id ?? null)
    setQueuedDraftThinkingEffort(prompt.run_config?.thinking_effort ?? null)
    queuedAttachmentScopeRef.current = `${attachmentScope}:queued:${promptId}:${Date.now()}`
  }

  const handleCancelQueuedEdit = () => {
    setEditingQueuedPromptId(null)
    setQueuedDraftText("")
    setQueuedDraftAttachments([])
    setQueuedDraftModelId(null)
    setQueuedDraftThinkingEffort(null)
  }

  const handleSaveQueuedEdit = () => {
    if (activeWorkspaceId == null || activeThreadId == null) return
    if (editingQueuedPromptId == null) return

    const text = queuedDraftText.trim()
    const hasUploading = queuedDraftAttachments.some((a) => a.status === "uploading")
    if (hasUploading) return
    const ready = queuedDraftAttachments
      .filter((a) => a.status === "ready" && a.attachment != null)
      .map((a) => a.attachment!)

    if (text.length === 0 && ready.length === 0) {
      handleCancelQueuedEdit()
      return
    }

    const modelId = queuedDraftModelId ?? conversation?.agent_model_id ?? ""
    const effort = queuedDraftThinkingEffort ?? conversation?.thinking_effort ?? "minimal"
    updateQueuedPrompt(activeWorkspaceId, activeThreadId, editingQueuedPromptId, {
      text,
      attachments: ready,
      runConfig: { model_id: modelId, thinking_effort: effort },
    })
    handleCancelQueuedEdit()
  }

  const handleCancelQueuedPrompt = (promptId: number) => {
    if (activeWorkspaceId == null || activeThreadId == null) return
    if (editingQueuedPromptId === promptId) {
      handleCancelQueuedEdit()
    }
    removeQueuedPrompt(activeWorkspaceId, activeThreadId, promptId)
  }

  useEffect(() => {
    if (editingQueuedPromptId == null) return
    if (!queuedPrompts.some((p) => p.id === editingQueuedPromptId)) {
      handleCancelQueuedEdit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedPrompts, editingQueuedPromptId])
  const handleQueueDrop = (activeId: number, overId: number) => {
    if (activeWorkspaceId == null || activeThreadId == null) return
    if (editingQueuedPromptId != null) return
    if (activeId === overId) return
    setDraggingQueuedPromptId(null)
    reorderQueuedPrompt(activeWorkspaceId, activeThreadId, activeId, overId)
  }

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return
    if (activeWorkspaceId == null || activeThreadId == null) return

    const scopeAtStart = attachmentScopeRef.current

    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith("image/")
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const initial: ComposerAttachment = {
        id,
        type: isImage ? "image" : "file",
        name: file.name,
        size: file.size,
        status: "uploading",
      }

      if (isImage) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const preview = typeof e.target?.result === "string" ? e.target.result : undefined
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, preview } : a)))
        }
        reader.readAsDataURL(file)
      }

      setAttachments((prev) => [...prev, initial])

      void uploadAttachment({ workspaceId: activeWorkspaceId, file, kind: isImage ? "image" : "file" })
        .then((attachment) => {
          if (attachmentScopeRef.current !== scopeAtStart) return
          setAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: "ready", attachment, name: attachment.name } : a)),
          )
          emitContextChanged(activeWorkspaceId)
        })
        .catch(() => {
          if (attachmentScopeRef.current !== scopeAtStart) return
          setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "failed" } : a)))
        })
    }
  }

  const handleQueuedFileSelect = (files: FileList | null) => {
    if (!files) return
    if (activeWorkspaceId == null || activeThreadId == null) return
    if (editingQueuedPromptId == null) return

    const scopeAtStart = queuedAttachmentScopeRef.current

    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith("image/")
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const initial: ComposerAttachment = {
        id,
        type: isImage ? "image" : "file",
        name: file.name,
        size: file.size,
        status: "uploading",
      }

      if (isImage) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const preview = typeof e.target?.result === "string" ? e.target.result : undefined
          setQueuedDraftAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, preview } : a)))
        }
        reader.readAsDataURL(file)
      }

      setQueuedDraftAttachments((prev) => [...prev, initial])

      void uploadAttachment({ workspaceId: activeWorkspaceId, file, kind: isImage ? "image" : "file" })
        .then((attachment) => {
          if (queuedAttachmentScopeRef.current !== scopeAtStart) return
          setQueuedDraftAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: "ready", attachment, name: attachment.name } : a)),
          )
          emitContextChanged(activeWorkspaceId)
        })
        .catch(() => {
          if (queuedAttachmentScopeRef.current !== scopeAtStart) return
          setQueuedDraftAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "failed" } : a)))
        })
    }
  }

  const handleAgentFileSelect = (files: FileList | null) => {
    if (!files) return
    if (activeWorkspaceId == null || activeThreadId == null) return

    const scopeAtStart = agentAttachmentScopeRef.current

    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith("image/")
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const initial: ComposerAttachment = {
        id,
        type: isImage ? "image" : "file",
        name: file.name,
        size: file.size,
        status: "uploading",
      }

      if (isImage) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const preview = typeof e.target?.result === "string" ? e.target.result : undefined
          setAgentEditorAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, preview } : a)))
        }
        reader.readAsDataURL(file)
      }

      setAgentEditorAttachments((prev) => [...prev, initial])

      void uploadAttachment({ workspaceId: activeWorkspaceId, file, kind: isImage ? "image" : "file" })
        .then((attachment) => {
          if (agentAttachmentScopeRef.current !== scopeAtStart) return
          setAgentEditorAttachments((prev) =>
            prev.map((a) => (a.id === id ? { ...a, status: "ready", attachment, name: attachment.name } : a)),
          )
          emitContextChanged(activeWorkspaceId)
        })
        .catch(() => {
          if (agentAttachmentScopeRef.current !== scopeAtStart) return
          setAgentEditorAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "failed" } : a)))
        })
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (activeWorkspaceId == null || activeThreadId == null) return
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems = Array.from(items).filter((item) => item.type.startsWith("image/"))
    if (imageItems.length === 0) return

    e.preventDefault()
    const dt = new DataTransfer()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (file) dt.items.add(file)
    }
    handleFileSelect(dt.files)
  }

  const handleAgentPaste = (e: React.ClipboardEvent) => {
    if (activeWorkspaceId == null || activeThreadId == null) return
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems = Array.from(items).filter((item) => item.type.startsWith("image/"))
    if (imageItems.length === 0) return

    e.preventDefault()
    const dt = new DataTransfer()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (file) dt.items.add(file)
    }
    handleAgentFileSelect(dt.files)
  }

  const handleQueuedPaste = (e: React.ClipboardEvent) => {
    if (activeWorkspaceId == null || activeThreadId == null) return
    if (editingQueuedPromptId == null) return
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems = Array.from(items).filter((item) => item.type.startsWith("image/"))
    if (imageItems.length === 0) return

    e.preventDefault()
    const dt = new DataTransfer()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (file) dt.items.add(file)
    }
    handleQueuedFileSelect(dt.files)
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const removeAgentEditorAttachment = (id: string) => {
    setAgentEditorAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const removeQueuedDraftAttachment = (id: string) => {
    setQueuedDraftAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const canSend = useMemo(() => {
    if (activeWorkspaceId == null || activeThreadId == null) return false
    const hasUploading = attachments.some((a) => a.status === "uploading")
    if (hasUploading) return false
    const hasReady = attachments.some((a) => a.status === "ready" && a.attachment != null)
    return draftText.trim().length > 0 || hasReady
  }, [activeWorkspaceId, activeThreadId, attachments, draftText])

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      <div className="flex items-center h-11 border-b border-border bg-card px-4">
        <div className="flex items-center gap-2 min-w-0">
          <span data-testid="active-project-name" className="text-sm font-medium text-foreground truncate">
            {projectInfo.name}
          </span>
          <div className="group/branch relative flex items-center gap-1 text-muted-foreground">
            <GitBranch className="w-3.5 h-3.5" />
            {isRenamingBranch ? (
              <div className="flex items-center gap-1">
                    <input
                      ref={branchInputRef}
                      type="text"
                      value={branchRenameValue}
                      onChange={(e) => setBranchRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (activeWorkspaceId == null) return
                          setIsRenamingBranch(false)
                          setBranchRenamePending({ initialBranch: projectInfo.branch, startedAt: Date.now() })
                          renameWorkspaceBranch(activeWorkspaceId, branchRenameValue)
                        }
                        if (e.key === "Escape") {
                          branchRenameCanceledRef.current = true
                          setBranchRenameValue(projectInfo.branch)
                          setIsRenamingBranch(false)
                        }
                      }}
                      onBlur={() => {
                        if (activeWorkspaceId == null) return
                        setIsRenamingBranch(false)
                        if (branchRenameCanceledRef.current) {
                          branchRenameCanceledRef.current = false
                          return
                        }
                        setBranchRenamePending({ initialBranch: projectInfo.branch, startedAt: Date.now() })
                        renameWorkspaceBranch(activeWorkspaceId, branchRenameValue)
                      }}
                      className="text-xs bg-muted border border-border rounded px-1.5 py-0.5 w-40 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (activeWorkspaceId == null) return
                        setIsRenamingBranch(false)
                        setBranchRenamePending({ initialBranch: projectInfo.branch, startedAt: Date.now() })
                        renameWorkspaceBranch(activeWorkspaceId, branchRenameValue)
                      }}
                      className="p-0.5 text-muted-foreground hover:text-primary transition-colors"
                      title="Confirm"
                    >
                  <Check className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <>
                <span data-testid="active-workspace-branch" className="text-xs">
                  {projectInfo.branch}
                </span>
                {isBranchRenaming ? (
                  <Loader2 className="w-3 h-3 animate-spin text-primary ml-1" />
                ) : (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex items-center gap-0.5 opacity-0 group-hover/branch:opacity-100 transition-opacity bg-card px-0.5">
                    {projectInfo.isGit && !projectInfo.isMainBranch && (
                      <>
                        <button
                          onClick={() => {
                            setBranchRenameValue(projectInfo.branch)
                            setIsRenamingBranch(true)
                          }}
                          className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                          title="Rename branch"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => {
                            if (activeWorkspaceId == null || activeThreadId == null) return
                            setBranchRenamePending({ initialBranch: projectInfo.branch, startedAt: Date.now() })
                            aiRenameWorkspaceBranch(activeWorkspaceId, activeThreadId)
                          }}
                          className="p-0.5 text-muted-foreground hover:text-primary transition-colors"
                          title="AI rename"
                        >
                          <Sparkles className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    <button
                      onClick={async () => {
                        if (!projectInfo.branch) return
                        try {
                          await navigator.clipboard.writeText(projectInfo.branch)
                          setCopySuccess(true)
                          window.setTimeout(() => setCopySuccess(false), 1200)
                        } catch {
                          setCopySuccess(false)
                        }
                      }}
                      className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                      title={copySuccess ? "Copied!" : "Copy branch name"}
                    >
                      {copySuccess ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          <OpenButton />
        </div>
      </div>

      <div className="flex items-center h-10 border-b border-border bg-muted/30">
        <div className="flex-1 flex items-center min-w-0 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "group relative flex items-center gap-2 h-10 px-3 cursor-pointer transition-colors min-w-0 max-w-[180px]",
                activePanel === "thread" && tab.id === activeTabId
                  ? "text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
              <span data-testid="thread-tab-title" className="text-xs truncate flex-1">
                {tab.title}
              </span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted rounded transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              {activePanel === "thread" && tab.id === activeTabId && (
                <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
              )}
            </div>
          ))}

          {isDiffTabOpen && (
            <div
              key="diff-tab"
              onClick={handleDiffTabClick}
              className={cn(
                "group relative flex items-center gap-2 h-10 px-3 cursor-pointer transition-colors min-w-0 max-w-[180px]",
                activePanel === "diff"
                  ? "text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <GitCompareArrows className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-xs truncate flex-1">Changes</span>
              <button
                onClick={handleCloseDiffTab}
                className="p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted rounded transition-all"
                title="Close changes tab"
              >
                <X className="w-3 h-3" />
              </button>
              {activePanel === "diff" && (
                <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full" />
              )}
            </div>
          )}

          <button
            onClick={handleAddTab}
            className="flex items-center justify-center w-8 h-10 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0"
            title="New tab"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center px-1">
          <div className="relative">
            <button
              onClick={() => setShowTabDropdown(!showTabDropdown)}
              className={cn(
                "flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors",
                showTabDropdown && "bg-muted text-foreground",
              )}
              title="All tabs"
            >
              <ChevronDown className="w-4 h-4" />
            </button>

            {showTabDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowTabDropdown(false)} />
                <div className="absolute right-0 top-full mt-1 w-64 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                  <div className="p-2 border-b border-border">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-2">
                      Open Tabs
                    </span>
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {isDiffTabOpen && (
                      <button
                        onClick={() => {
                          handleDiffTabClick()
                          setShowTabDropdown(false)
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted transition-colors",
                          activePanel === "diff" && "bg-primary/10 text-primary",
                        )}
                      >
                        <GitCompareArrows className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">Changes</span>
                      </button>
                    )}
                    {tabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => {
                          handleTabClick(tab.id)
                          setShowTabDropdown(false)
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted transition-colors",
                          activePanel === "thread" && tab.id === activeTabId && "bg-primary/10 text-primary",
                        )}
                      >
                        <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{tab.title}</span>
                      </button>
                    ))}
                  </div>

                  {archivedTabs.length > 0 && (
                    <>
                      <div className="p-2 border-t border-border">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-2">
                          Recently Closed
                        </span>
                      </div>
                      <div className="max-h-32 overflow-y-auto">
                        {archivedTabs.map((tab) => (
                          <button
                            key={tab.id}
                            onClick={() => handleRestoreTab(tab)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          >
                            <RotateCcw className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate flex-1">{tab.title}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {activePanel === "diff" ? (
        <div className="flex-1 overflow-hidden">
          {isDiffLoading ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">Loading…</div>
          ) : diffError ? (
            <div className="px-4 py-3 text-xs text-destructive">{diffError}</div>
          ) : diffFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <GitCompareArrows className="w-8 h-8 mb-2 opacity-50" />
              <span className="text-xs">No changes</span>
            </div>
          ) : (
            <AllFilesDiffViewer
              files={diffFiles}
              activeFileId={diffActiveFileId}
              diffStyle={diffStyle}
              onStyleChange={setDiffStyle}
            />
          )}
        </div>
      ) : (
        <>
          <div
            data-testid="chat-scroll-container"
            className="flex-1 overflow-y-auto relative"
            ref={scrollContainerRef}
            onScroll={(e) => {
              if (activeWorkspaceId == null || activeThreadId == null) return
              const el = e.target as HTMLDivElement
              const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
              const isNearBottom = distanceToBottom < 50
              if (!programmaticScrollRef.current) {
                setFollowTail(isNearBottom)
                localStorage.setItem(
                  followTailKey(activeWorkspaceId, activeThreadId),
                  isNearBottom ? "true" : "false",
                )
              }
            }}
          >
            <div className="max-w-3xl mx-auto py-4 px-4 pb-20">
              <ConversationView
                messages={messages}
                workspaceId={activeWorkspaceId ?? undefined}
                className=""
                renderAgentRunningCard={(message) => {
                  if (!agentStatus) return null
                  if (!agentCardMessageId || message.id !== agentCardMessageId) return null
                  if (!message.activities || message.activities.length === 0) return null
                  const filtered = message.activities.filter((event) => event.title !== "Turn canceled")
                  const activities = filtered.length > 0 ? filtered : message.activities
                  return (
                    <AgentRunningCard
                      activities={activities}
                      status={agentStatus}
                      hasQueuedMessages={queuedPrompts.length > 0}
                      editorValue={agentEditorValue}
                      editorAttachments={agentEditorAttachments}
                      onEditorChange={setAgentEditorValue}
                      onEditorAttachmentsChange={setAgentEditorAttachments}
                      onRemoveEditorAttachment={removeAgentEditorAttachment}
                      onEditorFileSelect={handleAgentFileSelect}
                      onEditorPaste={handleAgentPaste}
                      onAddEditorAttachmentRef={(attachment) => {
                        setAgentEditorAttachments((prev) => [...prev, ...attachmentsFromRefs([attachment])])
                      }}
                      workspaceId={activeWorkspaceId ?? null}
                      commands={codexCustomPrompts}
                      messageHistory={messageHistory}
                      onCommand={handleAgentCommand}
                      onCancel={handleAgentCancel}
                      onResume={handleAgentResume}
                      onSubmit={handleAgentSubmit}
                      onDismiss={handleAgentDismiss}
                    />
                  )
                }}
                emptyState={
                  <div className="text-sm text-muted-foreground">
                    {activeWorkspaceId == null
                      ? "Select a workspace to start."
                      : "Select a thread to load conversation."}
                  </div>
                }
              />

              {queuedPrompts.length > 0 && (
                <div className="mt-6 space-y-2" data-testid="queued-prompts">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-px flex-1 bg-border" />
                    <span className="flex items-center gap-1.5 px-2">
                      <Clock className="w-3 h-3" />
                      {queuedPrompts.length} queued
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  {queuedPrompts.map((prompt) => (
                    <QueuedPromptRow
                      key={prompt.id}
                      prompt={prompt}
                      isEditing={editingQueuedPromptId === prompt.id}
                      isDragging={draggingQueuedPromptId === prompt.id}
                      workspaceId={activeWorkspaceId}
                      commands={codexCustomPrompts}
                      messageHistory={messageHistory}
                      editingText={queuedDraftText}
                      editingAttachments={queuedDraftAttachments}
                      editingModelId={queuedDraftModelId}
                      editingThinkingEffort={queuedDraftThinkingEffort}
                      defaultModelId={app?.agent?.default_model_id ?? null}
                      defaultThinkingEffort={app?.agent?.default_thinking_effort ?? null}
                      onStartEdit={() => handleStartQueuedEdit(prompt.id)}
                      onSaveEdit={handleSaveQueuedEdit}
                      onCancelEdit={handleCancelQueuedEdit}
                      onCancelPrompt={() => handleCancelQueuedPrompt(prompt.id)}
                      onEditingTextChange={setQueuedDraftText}
                      onEditingModelIdChange={setQueuedDraftModelId}
                      onEditingThinkingEffortChange={setQueuedDraftThinkingEffort}
                      onQueuedFileSelect={handleQueuedFileSelect}
                      onQueuedPaste={handleQueuedPaste}
                      onRemoveEditingAttachment={removeQueuedDraftAttachment}
                      onAddEditingAttachmentRef={(attachment) => {
                        setQueuedDraftAttachments((prev) => [...prev, ...attachmentsFromRefs([attachment])])
                      }}
                      onOpenAgentSettings={(agentId, agentFilePath) =>
                        openSettingsPanel("agent", { agentId, agentFilePath })
                      }
                      onQueueDragStart={() => setDraggingQueuedPromptId(prompt.id)}
                      onQueueDragEnd={() => setDraggingQueuedPromptId(null)}
                      onQueueDrop={handleQueueDrop}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="relative z-10 -mt-16 pt-8 bg-gradient-to-t from-background via-background to-transparent pointer-events-none">
            <div className="pointer-events-auto">
              {!followTail && messages.length > 0 && editingQueuedPromptId == null ? (
                <div className="flex justify-center pb-2">
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-full text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all shadow-sm hover:shadow-md"
                    onClick={() => {
                      if (activeWorkspaceId == null || activeThreadId == null) return
                      setFollowTail(true)
                      localStorage.setItem(followTailKey(activeWorkspaceId, activeThreadId), "true")
                      scheduleScrollToBottom()
                    }}
                  >
                    <ArrowDown className="w-3 h-3" />
                    Scroll to bottom
                  </button>
                </div>
              ) : null}

              {editingQueuedPromptId == null && (
              <div className="px-4 pb-4">
                <div className="max-w-3xl mx-auto">
                  <MessageEditor
                    value={draftText}
                    onChange={(value) => {
                      setDraftText(value)
                      persistDraft(value)
                    }}
                    attachments={attachments}
                    onRemoveAttachment={removeAttachment}
                    onFileSelect={handleFileSelect}
                    onPaste={handlePaste}
                    onAddAttachmentRef={(attachment) => {
                      const isImage = attachment.kind === "image"
                      const previewUrl =
                        isImage && activeWorkspaceId != null
                          ? `/api/workspaces/${activeWorkspaceId}/attachments/${attachment.id}?ext=${encodeURIComponent(attachment.extension)}`
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
                    placeholder="Let's chart the cosmos of ideas..."
                    disabled={activeWorkspaceId == null || activeThreadId == null}
                    agentSelector={
                      <CodexAgentSelector
                        dropdownPosition="top"
                        disabled={activeWorkspaceId == null || activeThreadId == null}
                        modelId={conversation?.agent_model_id}
                        thinkingEffort={conversation?.thinking_effort}
                        defaultModelId={app?.agent.default_model_id ?? null}
                        defaultThinkingEffort={app?.agent.default_thinking_effort ?? null}
                        onOpenAgentSettings={(agentId, agentFilePath) =>
                          openSettingsPanel("agent", { agentId, agentFilePath })
                        }
                        onChangeModelId={(modelId) => {
                          if (activeWorkspaceId == null || activeThreadId == null) return
                          setChatModel(activeWorkspaceId, activeThreadId, modelId)
                        }}
                        onChangeThinkingEffort={(effort) => {
                          if (activeWorkspaceId == null || activeThreadId == null) return
                          setThinkingEffort(activeWorkspaceId, activeThreadId, effort)
                        }}
                      />
                    }
                    primaryAction={{
                      onClick: handleSend,
                      disabled: !canSend,
                      ariaLabel: "Send message",
                      icon: <Send className="w-3.5 h-3.5" />,
                      testId: "chat-send",
                    }}
                    testIds={{
                      textInput: "chat-input",
                      attachInput: "chat-attach-input",
                      attachButton: "chat-attach",
                      attachmentTile: "chat-attachment-tile",
                    }}
                  />
                </div>
              </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function QueuedPromptRow({
  prompt,
  isEditing,
  isDragging,
  workspaceId,
  commands,
  messageHistory,
  editingText,
  editingAttachments,
  editingModelId,
  editingThinkingEffort,
  defaultModelId,
  defaultThinkingEffort,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onCancelPrompt,
  onEditingTextChange,
  onEditingModelIdChange,
  onEditingThinkingEffortChange,
  onQueuedFileSelect,
  onQueuedPaste,
  onRemoveEditingAttachment,
  onAddEditingAttachmentRef,
  onOpenAgentSettings,
  onQueueDragStart,
  onQueueDragEnd,
  onQueueDrop,
}: {
  prompt: QueuedPromptSnapshot
  isEditing: boolean
  isDragging: boolean
  workspaceId: number | null
  commands: CodexCustomPromptSnapshot[]
  messageHistory: string[]
  editingText: string
  editingAttachments: ComposerAttachment[]
  editingModelId: string | null
  editingThinkingEffort: ThinkingEffort | null
  defaultModelId: string | null
  defaultThinkingEffort: ThinkingEffort | null
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onCancelPrompt: () => void
  onEditingTextChange: (text: string) => void
  onEditingModelIdChange: (modelId: string) => void
  onEditingThinkingEffortChange: (effort: ThinkingEffort) => void
  onQueuedFileSelect: (files: FileList | null) => void
  onQueuedPaste: (e: React.ClipboardEvent) => void
  onRemoveEditingAttachment: (id: string) => void
  onAddEditingAttachmentRef: (attachment: AttachmentRef) => void
  onOpenAgentSettings: (agentId: string, agentFilePath?: string) => void
  onQueueDragStart: () => void
  onQueueDragEnd: () => void
  onQueueDrop: (activeId: number, overId: number) => void
}) {
  if (isEditing) {
    const hasUploading = editingAttachments.some((a) => a.status === "uploading")
    const hasReady = editingAttachments.some((a) => a.status === "ready" && a.attachment != null)
    const canSave = !hasUploading && (editingText.trim().length > 0 || hasReady)

    return (
      <div className="transition-all duration-200 ease-out">
        <MessageEditor
          value={editingText}
          onChange={onEditingTextChange}
          attachments={editingAttachments}
          onRemoveAttachment={onRemoveEditingAttachment}
          onFileSelect={onQueuedFileSelect}
          onPaste={onQueuedPaste}
          onAddAttachmentRef={onAddEditingAttachmentRef}
          workspaceId={workspaceId}
          commands={commands}
          messageHistory={messageHistory}
          onCommand={(commandId) => {
            const match = commands.find((p) => p.id === commandId) ?? null
            if (!match) return
            onEditingTextChange(match.contents)
          }}
          placeholder="Edit message..."
          disabled={false}
          autoFocus
          agentSelector={
            <CodexAgentSelector
              testId="queued-codex-agent-selector"
              dropdownPosition="top"
              modelId={editingModelId}
              thinkingEffort={editingThinkingEffort}
              defaultModelId={defaultModelId}
              defaultThinkingEffort={defaultThinkingEffort}
              onOpenAgentSettings={onOpenAgentSettings}
              onChangeModelId={onEditingModelIdChange}
              onChangeThinkingEffort={onEditingThinkingEffortChange}
            />
          }
          secondaryAction={{
            onClick: onCancelEdit,
            ariaLabel: "Cancel edit",
            icon: <X className="w-3.5 h-3.5" />,
          }}
          primaryAction={{
            onClick: () => {
              if (!canSave) return
              onSaveEdit()
            },
            disabled: !canSave,
            ariaLabel: "Save message",
            icon: <Check className="w-3.5 h-3.5" />,
            testId: "queued-save",
          }}
          testIds={{
            textInput: "queued-prompt-input",
            attachInput: "queued-attach-input",
            attachButton: "queued-attach",
            attachmentTile: "queued-attachment-tile",
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={cn("group flex justify-end transition-all duration-200", isDragging && "z-50 opacity-90")}
      data-testid="queued-prompt-item"
      data-prompt-id={prompt.id}
    >
      <div
        className={cn(
          "relative max-w-[85%] rounded-lg px-3 py-2.5 transition-all duration-200",
          "border border-dashed border-border bg-muted/20 opacity-60 hover:opacity-80",
          isDragging && "shadow-lg border-primary/30 opacity-100 bg-background",
        )}
        onDoubleClick={() => onStartEdit()}
        data-testid="queued-prompt-bubble"
        draggable={!isEditing}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", String(prompt.id))
          e.dataTransfer.effectAllowed = "move"
          onQueueDragStart()
        }}
        onDragEnd={() => onQueueDragEnd()}
        onDragOver={(e) => {
          e.preventDefault()
        }}
        onDrop={(e) => {
          e.preventDefault()
          const raw = e.dataTransfer.getData("text/plain")
          const activeId = Number(raw)
          if (!Number.isFinite(activeId)) return
          onQueueDrop(activeId, prompt.id)
        }}
      >
        {!isDragging && (
          <div className="absolute -top-1.5 -right-1.5 flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onStartEdit()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 bg-background border border-border rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted hover:border-border hover:text-foreground"
              aria-label="Edit queued message"
              data-testid="queued-prompt-edit"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onCancelPrompt()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 bg-background border border-border rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:border-destructive hover:text-destructive-foreground"
              aria-label="Remove queued message"
              data-testid="queued-prompt-cancel"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {prompt.attachments && prompt.attachments.length > 0 && (
          <div className="flex items-center gap-1 mb-1 text-[10px] text-muted-foreground">
            <Paperclip className="w-3 h-3" />
            {prompt.attachments.length} file{prompt.attachments.length > 1 ? "s" : ""}
          </div>
        )}

        <div className="text-[13px] text-foreground/80 line-clamp-2 cursor-grab active:cursor-grabbing">
          {prompt.text}
        </div>
      </div>
    </div>
  )
}

function AllFilesDiffViewer({
  files,
  activeFileId,
  diffStyle,
  onStyleChange,
}: {
  files: DiffFileData[]
  activeFileId?: string
  diffStyle: "split" | "unified"
  onStyleChange: (style: "split" | "unified") => void
}) {
  const fileRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const prevActiveFileIdRef = useRef<string | undefined>(undefined)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set())

  const toggleCollapse = (fileId: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  useEffect(() => {
    if (!activeFileId) return
    if (activeFileId === prevActiveFileIdRef.current) return

    const el = fileRefs.current[activeFileId]
    if (!el) return

    if (collapsedFiles.has(activeFileId)) {
      setCollapsedFiles((prev) => {
        const next = new Set(prev)
        next.delete(activeFileId)
        return next
      })
    }

    el.scrollIntoView({ behavior: "smooth", block: "start" })
    prevActiveFileIdRef.current = activeFileId
  }, [activeFileId, collapsedFiles])

  const getStatusColor = (status: ChangedFile["status"]) => {
    switch (status) {
      case "modified":
        return "text-status-warning"
      case "added":
        return "text-status-success"
      case "deleted":
        return "text-status-error"
      case "renamed":
        return "text-status-info"
      default:
        return "text-muted-foreground"
    }
  }

  const getStatusLabel = (status: ChangedFile["status"]) => {
    switch (status) {
      case "modified":
        return "M"
      case "added":
        return "A"
      case "deleted":
        return "D"
      case "renamed":
        return "R"
      default:
        return "?"
    }
  }

  const totalAdditions = files.reduce((sum, f) => sum + (f.file.additions ?? 0), 0)
  const totalDeletions = files.reduce((sum, f) => sum + (f.file.deletions ?? 0), 0)

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background" data-testid="diff-viewer">
      <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 border-b border-border text-xs">
        <span className="text-foreground font-medium">{files.length} files changed</span>
        <span className="text-muted-foreground">
          {totalAdditions > 0 && <span className="text-status-success">+{totalAdditions}</span>}
          {totalAdditions > 0 && totalDeletions > 0 && <span className="mx-1">/</span>}
          {totalDeletions > 0 && <span className="text-status-error">-{totalDeletions}</span>}
        </span>
        <div className="ml-auto flex items-center gap-0.5 p-0.5 bg-muted rounded">
          <button
            onClick={() => onStyleChange("split")}
            className={cn(
              "p-1 rounded transition-colors",
              diffStyle === "split"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            title="Split view"
          >
            <Columns2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onStyleChange("unified")}
            className={cn(
              "p-1 rounded transition-colors",
              diffStyle === "unified"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            title="Unified view"
          >
            <AlignJustify className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {files.map((fileData) => {
          const isCollapsed = collapsedFiles.has(fileData.file.id)
          return (
            <div
              key={fileData.file.id}
              ref={(el) => {
                fileRefs.current[fileData.file.id] = el
              }}
              className="border-b border-border last:border-b-0"
            >
              <button
                onClick={() => toggleCollapse(fileData.file.id)}
                className="sticky top-0 z-[5] w-full flex items-center gap-2 px-4 py-2 bg-muted/80 backdrop-blur-sm border-b border-border/50 text-xs hover:bg-muted transition-colors text-left"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                )}
                <span className={cn("font-mono font-semibold", getStatusColor(fileData.file.status))}>
                  {getStatusLabel(fileData.file.status)}
                </span>
                <span className="font-mono text-foreground">{fileData.file.path}</span>
                {fileData.file.additions != null && fileData.file.additions > 0 && (
                  <span className="text-status-success">+{fileData.file.additions}</span>
                )}
                {fileData.file.deletions != null && fileData.file.deletions > 0 && (
                  <span className="text-status-error">-{fileData.file.deletions}</span>
                )}
              </button>

              {!isCollapsed && (
                <MultiFileDiff
                  oldFile={fileData.oldFile}
                  newFile={fileData.newFile}
                  options={{
                    theme: { dark: "pierre-dark", light: "pierre-light" },
                    diffStyle: diffStyle,
                    diffIndicators: "bars",
                    hunkSeparators: "line-info",
                    lineDiffType: "word-alt",
                    enableLineSelection: true,
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
