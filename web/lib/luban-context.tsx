"use client"

import type React from "react"

import { createContext, useContext, useEffect, useRef } from "react"
import { toast } from "sonner"

import type {
  AppSnapshot,
  ConversationSnapshot,
  ServerEvent,
  ThreadMeta,
  TaskDraft,
  TaskExecuteMode,
  TaskExecuteResult,
  ThinkingEffort,
  WorkspaceId,
  WorkspaceThreadId,
  WorkspaceSnapshot,
} from "./luban-api"
import { createLubanActions } from "./luban-actions"
import { useLubanStore } from "./luban-store"
import { createLubanServerEventHandler } from "./luban-store-events"
import { ACTIVE_WORKSPACE_KEY } from "./ui-prefs"
import { useLubanTransport } from "./luban-transport"

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
  openWorkspaceInIde: (workspaceId: WorkspaceId) => void
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

  setChatModel: (workspaceId: WorkspaceId, threadId: WorkspaceThreadId, modelId: string) => void
  setThinkingEffort: (workspaceId: WorkspaceId, threadId: WorkspaceThreadId, effort: ThinkingEffort) => void
}

const LubanContext = createContext<LubanContextValue | null>(null)

export function LubanProvider({ children }: { children: React.ReactNode }) {
  const store = useLubanStore()
  const { app, activeWorkspaceId, activeThreadId, threads, conversation, activeWorkspace } = store.state
  const eventHandlerRef = useRef<(event: ServerEvent) => void>(() => {})

  const { wsConnected, sendAction: sendActionTransport, request: requestTransport } = useLubanTransport({
    onEvent: (event) => eventHandlerRef.current(event),
    onError: (message) => {
      console.warn("server error:", message)
      toast.error(message)
    },
  })

  const actions = createLubanActions({
    store,
    sendAction: sendActionTransport,
    request: requestTransport,
  })

  eventHandlerRef.current = createLubanServerEventHandler({
    store,
    onToast: (message) => {
      console.warn("server toast:", message)
      toast(message)
    },
    onSelectThreadInWorkspace: (workspaceId, threadId) => {
      void actions.selectThreadInWorkspace(workspaceId, threadId)
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
    void actions.openWorkspace(stored)
  }, [app, activeWorkspaceId])

  const value: LubanContextValue = {
    app,
    activeWorkspaceId,
    activeWorkspace,
    activeThreadId,
    threads,
    conversation,
    wsConnected,
    pickProjectPath: actions.pickProjectPath,
    addProject: actions.addProject,
    createWorkspace: actions.createWorkspace,
    openWorkspaceInIde: actions.openWorkspaceInIde,
    openWorkspacePullRequest: actions.openWorkspacePullRequest,
    openWorkspacePullRequestFailedAction: actions.openWorkspacePullRequestFailedAction,
    archiveWorkspace: actions.archiveWorkspace,
    toggleProjectExpanded: actions.toggleProjectExpanded,
    previewTask: actions.previewTask,
    executeTask: actions.executeTask,
    openWorkspace: actions.openWorkspace,
    selectThread: actions.selectThread,
    createThread: actions.createThread,
    sendAgentMessage: actions.sendAgentMessage,
    sendAgentMessageTo: actions.sendAgentMessageTo,
    cancelAgentTurn: actions.cancelAgentTurn,
    setChatModel: actions.setChatModel,
    setThinkingEffort: actions.setThinkingEffort,
  }

  return <LubanContext.Provider value={value}>{children}</LubanContext.Provider>
}

export function useLuban(): LubanContextValue {
  const ctx = useContext(LubanContext)
  if (!ctx) throw new Error("useLuban must be used within LubanProvider")
  return ctx
}
