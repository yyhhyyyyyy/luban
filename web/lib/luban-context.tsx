"use client"

import type React from "react"

import { createContext, useContext, useEffect, useRef } from "react"
import { toast } from "sonner"

import type {
  AppSnapshot,
  AppearanceFontsSnapshot,
  AppearanceTheme,
  AttachmentRef,
  CodexConfigEntrySnapshot,
  ConversationSnapshot,
  ServerEvent,
  SystemTaskKind,
  ThreadMeta,
  TaskDraft,
  TaskExecuteMode,
  TaskExecuteResult,
  TaskIntentKind,
  ThinkingEffort,
  OpenTarget,
  WorkspaceId,
  WorkspaceThreadId,
  WorkspaceSnapshot,
  WorkspaceTabsSnapshot,
} from "./luban-api"
import { createLubanActions } from "./luban-actions"
import { useLubanStore } from "./luban-store"
import { createLubanServerEventHandler } from "./luban-store-events"
import { useExternalLinkInterceptor } from "./external-link-interceptor"
import { ACTIVE_WORKSPACE_KEY } from "./ui-prefs"
import { useLubanTransport } from "./luban-transport"

type LubanContextValue = {
  app: AppSnapshot | null
  activeWorkspaceId: WorkspaceId | null
  activeWorkspace: WorkspaceSnapshot | null
  activeThreadId: number | null
  threads: ThreadMeta[]
  workspaceTabs: WorkspaceTabsSnapshot | null
  conversation: ConversationSnapshot | null
  wsConnected: boolean

  pickProjectPath: () => Promise<string | null>
  addProject: (path: string) => void
  deleteProject: (projectId: number) => void
  createWorkspace: (projectId: number) => void
  ensureMainWorkspace: (projectId: number) => void
  openWorkspaceInIde: (workspaceId: WorkspaceId) => void
  openWorkspaceWith: (workspaceId: WorkspaceId, target: OpenTarget) => void
  openWorkspacePullRequest: (workspaceId: WorkspaceId) => void
  openWorkspacePullRequestFailedAction: (workspaceId: WorkspaceId) => void
  archiveWorkspace: (workspaceId: number) => void
  toggleProjectExpanded: (projectId: number) => void

  previewTask: (input: string) => Promise<TaskDraft>
  executeTask: (draft: TaskDraft, mode: TaskExecuteMode) => Promise<TaskExecuteResult>

  openWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  selectThread: (threadId: number) => Promise<void>
  createThread: () => void
  closeThreadTab: (threadId: number) => Promise<void>
  restoreThreadTab: (threadId: number) => Promise<void>

  sendAgentMessage: (text: string, attachments?: AttachmentRef[]) => void
  sendAgentMessageTo: (
    workspaceId: WorkspaceId,
    threadId: number,
    text: string,
    attachments?: AttachmentRef[],
  ) => void
  cancelAgentTurn: () => void

  renameWorkspaceBranch: (workspaceId: WorkspaceId, branchName: string) => void
  aiRenameWorkspaceBranch: (workspaceId: WorkspaceId, threadId: WorkspaceThreadId) => void

  setChatModel: (workspaceId: WorkspaceId, threadId: WorkspaceThreadId, modelId: string) => void
  setThinkingEffort: (workspaceId: WorkspaceId, threadId: WorkspaceThreadId, effort: ThinkingEffort) => void
  setAppearanceTheme: (theme: AppearanceTheme) => void
  setAppearanceFonts: (fonts: AppearanceFontsSnapshot) => void

  setCodexEnabled: (enabled: boolean) => void
  setTaskPromptTemplate: (intentKind: TaskIntentKind, template: string) => void
  setSystemPromptTemplate: (kind: SystemTaskKind, template: string) => void
  checkCodex: () => Promise<{ ok: boolean; message: string | null }>
  getCodexConfigTree: () => Promise<CodexConfigEntrySnapshot[]>
  readCodexConfigFile: (path: string) => Promise<string>
  writeCodexConfigFile: (path: string, contents: string) => Promise<void>
}

const LubanContext = createContext<LubanContextValue | null>(null)

export function LubanProvider({ children }: { children: React.ReactNode }) {
  const store = useLubanStore()
  const { app, activeWorkspaceId, activeThreadId, threads, workspaceTabs, conversation, activeWorkspace } = store.state
  const eventHandlerRef = useRef<(event: ServerEvent) => void>(() => {})

  useExternalLinkInterceptor()

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
    workspaceTabs,
    conversation,
    wsConnected,
    pickProjectPath: actions.pickProjectPath,
    addProject: actions.addProject,
    deleteProject: actions.deleteProject,
    createWorkspace: actions.createWorkspace,
    ensureMainWorkspace: actions.ensureMainWorkspace,
    openWorkspaceInIde: actions.openWorkspaceInIde,
    openWorkspaceWith: actions.openWorkspaceWith,
    openWorkspacePullRequest: actions.openWorkspacePullRequest,
    openWorkspacePullRequestFailedAction: actions.openWorkspacePullRequestFailedAction,
    archiveWorkspace: actions.archiveWorkspace,
    toggleProjectExpanded: actions.toggleProjectExpanded,
    previewTask: actions.previewTask,
    executeTask: actions.executeTask,
    openWorkspace: actions.openWorkspace,
    selectThread: actions.selectThread,
    createThread: actions.createThread,
    closeThreadTab: actions.closeThreadTab,
    restoreThreadTab: actions.restoreThreadTab,
    sendAgentMessage: actions.sendAgentMessage,
    sendAgentMessageTo: actions.sendAgentMessageTo,
    cancelAgentTurn: actions.cancelAgentTurn,
    renameWorkspaceBranch: actions.renameWorkspaceBranch,
    aiRenameWorkspaceBranch: actions.aiRenameWorkspaceBranch,
    setChatModel: actions.setChatModel,
    setThinkingEffort: actions.setThinkingEffort,
    setAppearanceTheme: actions.setAppearanceTheme,
    setAppearanceFonts: actions.setAppearanceFonts,
    setCodexEnabled: actions.setCodexEnabled,
    setTaskPromptTemplate: actions.setTaskPromptTemplate,
    setSystemPromptTemplate: actions.setSystemPromptTemplate,
    checkCodex: actions.checkCodex,
    getCodexConfigTree: actions.getCodexConfigTree,
    readCodexConfigFile: actions.readCodexConfigFile,
    writeCodexConfigFile: actions.writeCodexConfigFile,
  }

  return <LubanContext.Provider value={value}>{children}</LubanContext.Provider>
}

export function useLuban(): LubanContextValue {
  const ctx = useContext(LubanContext)
  if (!ctx) throw new Error("useLuban must be used within LubanProvider")
  return ctx
}
