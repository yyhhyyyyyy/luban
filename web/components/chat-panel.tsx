"use client"

import type React from "react"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Send,
  ChevronDown,
  ChevronRight,
  ArrowDown,
  MessageSquare,
  Plus,
  X,
  ExternalLink,
  GitBranch,
  GitCompareArrows,
  RotateCcw,
  Terminal,
  Eye,
  Pencil,
  CheckCircle2,
  Loader2,
  Paperclip,
  ImageIcon,
  FileText,
  FileCode,
  Columns2,
  AlignJustify,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useLuban } from "@/lib/luban-context"
import { buildMessages } from "@/lib/conversation-ui"
import { ConversationView } from "@/components/conversation-view"
import { fetchWorkspaceDiff, uploadAttachment } from "@/lib/luban-http"
import type { AttachmentRef } from "@/lib/luban-api"
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
import { openSettingsPanel } from "@/lib/open-settings"

interface ChatTab {
  id: string
  title: string
  isActive: boolean
}

interface ArchivedTab {
  id: string
  title: string
}

type ComposerAttachment = {
  id: string
  type: "image" | "file"
  name: string
  size: number
  preview?: string
  previewUrl?: string
  status: "uploading" | "ready" | "failed"
  attachment?: AttachmentRef
}

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

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const {
    app,
    activeWorkspaceId,
    activeThreadId,
    threads,
    workspaceTabs,
    conversation,
    selectThread,
    createThread,
    closeThreadTab,
    restoreThreadTab,
    sendAgentMessage,
    openWorkspaceInIde,
    setChatModel,
    setThinkingEffort,
  } = useLuban()

  const [draftText, setDraftText] = useState("")
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const [followTail, setFollowTail] = useState(true)
  const programmaticScrollRef = useRef(false)

  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const attachmentScopeRef = useRef<string>("")
  const attachmentScope = `${activeWorkspaceId ?? "none"}:${activeThreadId ?? "none"}`

  const [activePanel, setActivePanel] = useState<"thread" | "diff">("thread")
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">("split")
  const [diffFiles, setDiffFiles] = useState<DiffFileData[]>([])
  const [diffActiveFileId, setDiffActiveFileId] = useState<string | undefined>(undefined)
  const [isDiffTabOpen, setIsDiffTabOpen] = useState(false)
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

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
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const maxHeightPx = 160
    const nextHeight = Math.min(el.scrollHeight, maxHeightPx)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > maxHeightPx ? "auto" : "hidden"
  }, [draftText])

  const messages = useMemo(() => buildMessages(conversation), [conversation])

  const projectInfo = useMemo(() => {
    if (app == null || activeWorkspaceId == null) return { name: "Luban", branch: "" }
    for (const p of app.projects) {
      for (const w of p.workspaces) {
        if (w.id !== activeWorkspaceId) continue
        return { name: p.slug, branch: w.branch_name }
      }
    }
    return { name: "Luban", branch: "" }
  }, [app, activeWorkspaceId])

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
      return
    }

    setFollowTail(true)
    localStorage.setItem(followTailKey(activeWorkspaceId, activeThreadId), "true")

    const saved = loadJson<{ text: string }>(draftKey(activeWorkspaceId, activeThreadId))
    setDraftText(saved?.text ?? "")
    setAttachments([])
    setIsDragging(false)
    attachmentScopeRef.current = attachmentScope
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

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
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
          <div className="flex items-center gap-1 text-muted-foreground">
            <GitBranch className="w-3.5 h-3.5" />
            <span data-testid="active-workspace-branch" className="text-xs">
              {projectInfo.branch}
            </span>
          </div>
          <button
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            title="Open in editor"
            disabled={activeWorkspaceId == null}
            onClick={() => {
              if (activeWorkspaceId == null) return
              openWorkspaceInIde(activeWorkspaceId)
            }}
          >
            <ExternalLink className="w-4 h-4" />
          </button>
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
            <ConversationView
              messages={messages}
              workspaceId={activeWorkspaceId ?? undefined}
              className="max-w-3xl mx-auto py-4 px-4 pb-20"
              emptyState={
                <div className="max-w-3xl mx-auto py-4 px-4 text-sm text-muted-foreground">
                  {activeWorkspaceId == null ? "Select a workspace to start." : "Select a thread to load conversation."}
                </div>
              }
            />
          </div>

          <div className="relative z-10 -mt-16 pt-8 bg-gradient-to-t from-background via-background to-transparent pointer-events-none">
            <div className="pointer-events-auto">
              {!followTail && messages.length > 0 ? (
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

              <div className="px-4 pb-4">
                <div className="max-w-3xl mx-auto">
                  <div
                    className={cn(
                      "relative bg-background border rounded-lg shadow-lg transition-all",
                      isComposerFocused ? "border-primary/50 ring-1 ring-primary/20 shadow-xl" : "border-border",
                      isDragging && "border-primary ring-2 ring-primary/30 bg-primary/5",
                    )}
                    onDragOver={(e) => {
                      e.preventDefault()
                      if (activeWorkspaceId == null || activeThreadId == null) return
                      setIsDragging(true)
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault()
                      setIsDragging(false)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      setIsDragging(false)
                      const raw = e.dataTransfer.getData("luban-context-attachment")
                      if (raw) {
                        try {
                          const attachment = JSON.parse(raw) as AttachmentRef
                          if (attachment && typeof attachment.id === "string") {
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
                            return
                          }
                        } catch {
                          // Ignore invalid payloads.
                        }
                      }

                      handleFileSelect(e.dataTransfer.files)
                    }}
                  >
                {isDragging && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 rounded-lg border-2 border-dashed border-primary">
                    <div className="flex flex-col items-center gap-2 text-primary">
                      <ImageIcon className="w-8 h-8" />
                      <span className="text-sm font-medium">Drop files here</span>
                    </div>
                  </div>
                )}

                {attachments.length > 0 && (
                  <div className="px-3 pt-3 pb-1 flex flex-wrap gap-3">
                    {attachments.map((attachment) => (
                      <div key={attachment.id} data-testid="chat-attachment-tile" className="group relative">
                        <div className="relative">
                          <div className="w-20 h-20 rounded-lg overflow-hidden border border-border/50 hover:border-border transition-colors bg-muted/40 flex items-center justify-center">
                            {attachment.type === "image" && (attachment.preview || attachment.previewUrl) ? (
                              <img
                                src={attachment.preview ?? attachment.previewUrl}
                                alt={attachment.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="flex flex-col items-center gap-1.5">
                                {attachment.name.toLowerCase().endsWith(".json") ? (
                                  <FileCode className="w-6 h-6 text-amber-500" />
                                ) : attachment.name.toLowerCase().endsWith(".pdf") ? (
                                  <FileText className="w-6 h-6 text-red-500" />
                                ) : (
                                  <FileText className="w-6 h-6 text-muted-foreground" />
                                )}
                                <span className="text-[9px] text-muted-foreground uppercase font-medium tracking-wide">
                                  {attachment.name.split(".").pop()}
                                </span>
                              </div>
                            )}
                          </div>
                          {attachment.status === "uploading" && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            </div>
                          )}
                          <button
                            onClick={() => removeAttachment(attachment.id)}
                            className={cn(
                              "absolute -top-1.5 -right-1.5 p-1 bg-background border border-border rounded-full shadow-sm transition-opacity hover:bg-destructive hover:border-destructive hover:text-destructive-foreground",
                              attachment.status === "uploading" ? "opacity-0 pointer-events-none" : "opacity-0 group-hover:opacity-100",
                            )}
                            aria-label="Remove attachment"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-popover border border-border rounded text-[9px] text-muted-foreground truncate max-w-[90px] opacity-0 group-hover:opacity-100 transition-opacity shadow-sm pointer-events-none">
                            {attachment.name}
                          </div>
                          {attachment.status === "failed" && (
                            <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[9px] text-destructive bg-background/80 text-center">
                              Upload failed
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="px-2.5 pt-2">
                  <textarea
                    ref={textareaRef}
                    data-testid="chat-input"
                    value={draftText}
                    onChange={(e) => {
                      setDraftText(e.target.value)
                      persistDraft(e.target.value)
                    }}
                    onFocus={() => setIsComposerFocused(true)}
                    onBlur={() => setIsComposerFocused(false)}
                    onPaste={handlePaste}
                    placeholder="Message... (⌘↵ to send)"
                    className="w-full bg-transparent text-sm leading-5 text-foreground placeholder:text-muted-foreground resize-none focus:outline-none min-h-[20px] max-h-[160px] luban-font-chat"
                    rows={1}
                    disabled={activeWorkspaceId == null || activeThreadId == null}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                  />
                </div>

                <div className="flex items-center px-2 pb-2 pt-1">
                  <input
                    ref={fileInputRef}
                    data-testid="chat-attach-input"
                    type="file"
                    multiple
                    accept="image/*,.pdf,.txt,.md,.json,.csv,.xml,.yaml,.yml"
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files)}
                  />
                  <button
                    data-testid="chat-attach"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
                    title="Attach files"
                    disabled={activeWorkspaceId == null || activeThreadId == null}
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  <div className="w-px h-4 bg-border mx-1" />

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

                  <div className="flex-1" />
                  <button
                    data-testid="chat-send"
                    aria-label="Send message"
                    className={cn(
                      "p-1.5 rounded-md transition-all flex-shrink-0 disabled:opacity-50",
                      canSend
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-muted text-muted-foreground",
                    )}
                    onClick={handleSend}
                    disabled={!canSend}
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
      )}
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
