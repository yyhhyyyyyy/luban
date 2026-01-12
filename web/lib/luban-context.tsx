"use client"

import type React from "react"

import { createContext, useContext, useEffect } from "react"
import { toast } from "sonner"

import type {
  AppSnapshot,
  ClientAction,
  ConversationSnapshot,
  ServerEvent,
  ThreadMeta,
  TaskDraft,
  TaskExecuteMode,
  TaskExecuteResult,
  WorkspaceId,
  WorkspaceSnapshot,
} from "./luban-api"
import { fetchConversation, fetchThreads } from "./luban-http"
import { useLubanStore } from "./luban-store"
import { ACTIVE_WORKSPACE_KEY, activeThreadKey } from "./ui-prefs"
import { useLubanTransport } from "./luban-transport"
import {
  DEFAULT_NEW_THREAD_TIMEOUT_MS,
  pickCreatedThreadId,
  waitForNewThread,
} from "./luban-thread-flow"

type LubanContextValue = {
  app: AppSnapshot | null
  activeWorkspaceId: WorkspaceId | null
  activeWorkspace: WorkspaceSnapshot | null
  activeThreadId: number | null
  threads: ThreadMeta[]
  conversation: ConversationSnapshot | null
  wsConnected: boolean

  pickProjectPath: () => Promise<string | null>
  addProject: (path: string) => void
  createWorkspace: (projectId: number) => void
  openWorkspacePullRequest: (workspaceId: WorkspaceId) => void
  openWorkspacePullRequestFailedAction: (workspaceId: WorkspaceId) => void
  archiveWorkspace: (workspaceId: number) => void
  toggleProjectExpanded: (projectId: number) => void

  previewTask: (input: string) => Promise<TaskDraft>
  executeTask: (draft: TaskDraft, mode: TaskExecuteMode) => Promise<TaskExecuteResult>

  openWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  selectThread: (threadId: number) => Promise<void>
  createThread: () => void

  sendAgentMessage: (text: string) => void
  sendAgentMessageTo: (workspaceId: WorkspaceId, threadId: number, text: string) => void
  cancelAgentTurn: () => void
}

const LubanContext = createContext<LubanContextValue | null>(null)

export function LubanProvider({ children }: { children: React.ReactNode }) {
  const store = useLubanStore()
  const { app, activeWorkspaceId, activeThreadId, threads, conversation, activeWorkspace } = store.state
  const { activeWorkspaceIdRef, activeThreadIdRef, threadsRef, pendingCreateThreadRef } = store.refs

  function handleAppChanged(event: Extract<ServerEvent, { type: "app_changed" }>) {
    store.setApp(event.snapshot)
  }

  function handleWorkspaceThreadsChanged(
    event: Extract<ServerEvent, { type: "workspace_threads_changed" }>,
  ) {
    const wid = activeWorkspaceIdRef.current
    if (wid == null || wid !== event.workspace_id) return

    setThreads(event.threads)
    const current = activeThreadIdRef.current

    const pending = pendingCreateThreadRef.current
    if (pending && pending.workspaceId === wid) {
      const created = pickCreatedThreadId({
        threads: event.threads,
        existingThreadIds: pending.existingThreadIds,
      })
      if (created != null) {
        pendingCreateThreadRef.current = null
        void selectThreadInternal(wid, created)
        return
      }

      if (Date.now() - pending.requestedAtUnixMs > DEFAULT_NEW_THREAD_TIMEOUT_MS) {
        pendingCreateThreadRef.current = null
      }
    }

    if (current == null || !event.threads.some((t) => t.thread_id === current)) {
      const next = event.threads[0]?.thread_id ?? null
      if (next != null) {
        void selectThreadInternal(wid, next)
      }
    }
  }

  function handleConversationChanged(event: Extract<ServerEvent, { type: "conversation_changed" }>) {
    const wid = activeWorkspaceIdRef.current
    const tid = activeThreadIdRef.current
    if (wid == null || tid == null) return
    if (event.snapshot.workspace_id === wid && event.snapshot.thread_id === tid) {
      store.setConversation(event.snapshot)
    }
  }

  function handleToast(event: Extract<ServerEvent, { type: "toast" }>) {
    console.warn("server toast:", event.message)
    toast(event.message)
  }

  const { wsConnected, sendAction: sendActionTransport, request: requestTransport } = useLubanTransport({
    onEvent: (event) => {
      switch (event.type) {
        case "app_changed":
          handleAppChanged(event)
          return
        case "workspace_threads_changed":
          handleWorkspaceThreadsChanged(event)
          return
        case "conversation_changed":
          handleConversationChanged(event)
          return
        case "toast":
          handleToast(event)
          return
      }
    },
    onError: (message) => {
      console.warn("server error:", message)
      toast.error(message)
    },
  })

  useEffect(() => {
    if (app == null) return
    if (activeWorkspaceId != null) return
    const raw = localStorage.getItem(ACTIVE_WORKSPACE_KEY)
    const stored = raw ? Number(raw) : null
    if (!stored || !Number.isFinite(stored)) return
    const exists = app.projects.some((p) => p.workspaces.some((w) => w.id === stored))
    if (!exists) return
    void openWorkspace(stored)
  }, [app, activeWorkspaceId])

  function sendAction(action: ClientAction, requestId?: string) {
    sendActionTransport(action, requestId)
  }

  function request<T>(action: ClientAction): Promise<T> {
    return requestTransport<T>(action)
  }

  function addProject(path: string) {
    sendAction({ type: "add_project", path })
  }

  function pickProjectPath(): Promise<string | null> {
    return request<string | null>({ type: "pick_project_path" })
  }

  function createWorkspace(projectId: number) {
    sendAction({ type: "create_workspace", project_id: projectId })
  }

  function openWorkspacePullRequest(workspaceId: WorkspaceId) {
    sendAction({ type: "open_workspace_pull_request", workspace_id: workspaceId })
  }

  function openWorkspacePullRequestFailedAction(workspaceId: WorkspaceId) {
    sendAction({ type: "open_workspace_pull_request_failed_action", workspace_id: workspaceId })
  }

  function archiveWorkspace(workspaceId: number) {
    sendAction({ type: "archive_workspace", workspace_id: workspaceId })
  }

  function toggleProjectExpanded(projectId: number) {
    store.setApp((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        projects: prev.projects.map((p) =>
          p.id === projectId ? { ...p, expanded: !p.expanded } : p,
        ),
      }
    })
    sendAction({ type: "toggle_project_expanded", project_id: projectId })
  }

  function previewTask(input: string): Promise<TaskDraft> {
    return request<TaskDraft>({ type: "task_preview", input })
  }

  function executeTask(draft: TaskDraft, mode: TaskExecuteMode): Promise<TaskExecuteResult> {
    return request<TaskExecuteResult>({ type: "task_execute", draft, mode })
  }

  async function selectThreadInternal(workspaceId: WorkspaceId, threadId: number) {
    store.setActiveThreadId(threadId)
    localStorage.setItem(activeThreadKey(workspaceId), String(threadId))

    sendAction({
      type: "activate_workspace_thread",
      workspace_id: workspaceId,
      thread_id: threadId,
    })

    try {
      const convo = await fetchConversation(workspaceId, threadId)
      store.setConversation(convo)
    } catch (err) {
      console.warn("fetchConversation failed", err)
    }
  }

  async function waitAndActivateNewThread(args: {
    workspaceId: WorkspaceId
    existingThreadIds: Set<number>
  }): Promise<boolean> {
    const created = await waitForNewThread({
      workspaceId: args.workspaceId,
      existingThreadIds: args.existingThreadIds,
      fetchThreads,
    })
    if (created.createdThreadId == null) return false

    pendingCreateThreadRef.current = null
    store.setThreads(created.threads)
    await selectThreadInternal(args.workspaceId, created.createdThreadId)
    return true
  }

  async function openWorkspace(workspaceId: WorkspaceId) {
    store.setActiveWorkspaceId(workspaceId)
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(workspaceId))
    store.setThreads([])
    store.setConversation(null)

    sendAction({ type: "open_workspace", workspace_id: workspaceId })

    try {
      const snap = await fetchThreads(workspaceId)
      store.setThreads(snap.threads)

      const saved = Number(localStorage.getItem(activeThreadKey(workspaceId)) ?? "")
      const initial =
        snap.threads.find((t) => t.thread_id === saved)?.thread_id ??
        snap.threads[0]?.thread_id ??
        null

      if (initial == null) {
        const existing = new Set<number>()
        store.markPendingCreateThread({ workspaceId, existingThreadIds: existing })
        sendAction({ type: "create_workspace_thread", workspace_id: workspaceId })
        store.setActiveThreadId(null)

        await waitAndActivateNewThread({ workspaceId, existingThreadIds: existing })
        return
      }

      await selectThreadInternal(workspaceId, initial)
    } catch (err) {
      console.warn("fetchThreads failed", err)
    }
  }

  async function selectThread(threadId: number) {
    const wid = activeWorkspaceIdRef.current
    if (wid == null) return
    await selectThreadInternal(wid, threadId)
  }

  function createThread() {
    const wid = activeWorkspaceIdRef.current
    if (wid == null) return

    void (async () => {
      const existingThreadIds = new Set(threadsRef.current.map((t) => t.thread_id))
      store.markPendingCreateThread({ workspaceId: wid, existingThreadIds })
      sendAction({ type: "open_workspace", workspace_id: wid })
      sendAction({ type: "create_workspace_thread", workspace_id: wid })

      await waitAndActivateNewThread({ workspaceId: wid, existingThreadIds })
    })()
  }

  function activeWorkspaceThread(): { workspaceId: WorkspaceId; threadId: number } | null {
    const wid = activeWorkspaceIdRef.current
    const tid = activeThreadIdRef.current
    if (wid == null || tid == null) return null
    return { workspaceId: wid, threadId: tid }
  }

  function sendAgentMessage(text: string) {
    const ids = activeWorkspaceThread()
    if (!ids) return
    sendAction({
      type: "send_agent_message",
      workspace_id: ids.workspaceId,
      thread_id: ids.threadId,
      text,
      attachments: [],
    })
  }

  function sendAgentMessageTo(workspaceId: WorkspaceId, threadId: number, text: string) {
    sendAction({
      type: "send_agent_message",
      workspace_id: workspaceId,
      thread_id: threadId,
      text,
      attachments: [],
    })
  }

  function cancelAgentTurn() {
    const ids = activeWorkspaceThread()
    if (!ids) return
    sendAction({ type: "cancel_agent_turn", workspace_id: ids.workspaceId, thread_id: ids.threadId })
  }

  const value: LubanContextValue = {
    app,
    activeWorkspaceId,
    activeWorkspace,
    activeThreadId,
    threads,
    conversation,
    wsConnected,
    pickProjectPath,
    addProject,
    createWorkspace,
    openWorkspacePullRequest,
    openWorkspacePullRequestFailedAction,
    archiveWorkspace,
    toggleProjectExpanded,
    previewTask,
    executeTask,
    openWorkspace,
    selectThread,
    createThread,
    sendAgentMessage,
    sendAgentMessageTo,
    cancelAgentTurn,
  }

  return <LubanContext.Provider value={value}>{children}</LubanContext.Provider>
}

export function useLuban(): LubanContextValue {
  const ctx = useContext(LubanContext)
  if (!ctx) throw new Error("useLuban must be used within LubanProvider")
  return ctx
}
