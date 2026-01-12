"use client"

import type {
  AttachmentRef,
  ClientAction,
  TaskDraft,
  TaskExecuteMode,
  TaskExecuteResult,
  ThinkingEffort,
  WorkspaceId,
  WorkspaceThreadId,
} from "./luban-api"
import { fetchConversation, fetchThreads } from "./luban-http"
import type { LubanStore } from "./luban-store"
import { ACTIVE_WORKSPACE_KEY } from "./ui-prefs"
import { waitForNewThread } from "./luban-thread-flow"

export type LubanActions = {
  pickProjectPath: () => Promise<string | null>
  addProject: (path: string) => void
  deleteProject: (projectId: number) => void
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

  setChatModel: (workspaceId: WorkspaceId, threadId: WorkspaceThreadId, modelId: string) => void
  setThinkingEffort: (workspaceId: WorkspaceId, threadId: WorkspaceThreadId, effort: ThinkingEffort) => void
}

export type LubanActionsInternal = LubanActions & {
  selectThreadInWorkspace: (workspaceId: WorkspaceId, threadId: number) => Promise<void>
}

export function createLubanActions(args: {
  store: LubanStore
  sendAction: (action: ClientAction, requestId?: string) => void
  request: <T>(action: ClientAction) => Promise<T>
}): LubanActionsInternal {
  const store = args.store

  function addProject(path: string) {
    args.sendAction({ type: "add_project", path })
  }

  function deleteProject(projectId: number) {
    args.sendAction({ type: "delete_project", project_id: projectId })
  }

  function pickProjectPath(): Promise<string | null> {
    return args.request<string | null>({ type: "pick_project_path" })
  }

  function createWorkspace(projectId: number) {
    args.sendAction({ type: "create_workspace", project_id: projectId })
  }

  function openWorkspaceInIde(workspaceId: WorkspaceId) {
    args.sendAction({ type: "open_workspace_in_ide", workspace_id: workspaceId })
  }

  function openWorkspacePullRequest(workspaceId: WorkspaceId) {
    args.sendAction({ type: "open_workspace_pull_request", workspace_id: workspaceId })
  }

  function openWorkspacePullRequestFailedAction(workspaceId: WorkspaceId) {
    args.sendAction({ type: "open_workspace_pull_request_failed_action", workspace_id: workspaceId })
  }

  function archiveWorkspace(workspaceId: number) {
    args.sendAction({ type: "archive_workspace", workspace_id: workspaceId })
  }

  function toggleProjectExpanded(projectId: number) {
    store.setApp((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        projects: prev.projects.map((p) => (p.id === projectId ? { ...p, expanded: !p.expanded } : p)),
      }
    })
    args.sendAction({ type: "toggle_project_expanded", project_id: projectId })
  }

  function previewTask(input: string): Promise<TaskDraft> {
    return args.request<TaskDraft>({ type: "task_preview", input })
  }

  function executeTask(draft: TaskDraft, mode: TaskExecuteMode): Promise<TaskExecuteResult> {
    return args.request<TaskExecuteResult>({ type: "task_execute", draft, mode })
  }

  async function selectThreadInWorkspace(workspaceId: WorkspaceId, threadId: number) {
    store.setActiveThreadId(threadId)

    args.sendAction({
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

  async function refreshThreads(workspaceId: WorkspaceId): Promise<{
    threadId: number | null
  }> {
    const snap = await fetchThreads(workspaceId)
    store.setThreads(snap.threads)
    store.setWorkspaceTabs(snap.tabs)

    const preferred = snap.tabs.active_tab
    const initial =
      (snap.threads.some((t) => t.thread_id === preferred) ? preferred : null) ??
      snap.threads[0]?.thread_id ??
      null

    store.setActiveThreadId(initial)
    if (initial == null) {
      store.setConversation(null)
      return { threadId: null }
    }

    try {
      const convo = await fetchConversation(workspaceId, initial)
      store.setConversation(convo)
    } catch (err) {
      console.warn("fetchConversation failed", err)
    }

    return { threadId: initial }
  }

  async function waitAndActivateNewThread(args2: {
    workspaceId: WorkspaceId
    existingThreadIds: Set<number>
  }): Promise<boolean> {
    const created = await waitForNewThread({
      workspaceId: args2.workspaceId,
      existingThreadIds: args2.existingThreadIds,
      fetchThreads,
    })
    if (created.createdThreadId == null) return false

    store.refs.pendingCreateThreadRef.current = null
    store.setThreads(created.threads)
    store.setWorkspaceTabs(created.tabs)
    await selectThreadInWorkspace(args2.workspaceId, created.createdThreadId)
    return true
  }

  async function openWorkspace(workspaceId: WorkspaceId) {
    store.setActiveWorkspaceId(workspaceId)
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(workspaceId))
    store.setThreads([])
    store.setWorkspaceTabs(null)
    store.setConversation(null)

    args.sendAction({ type: "open_workspace", workspace_id: workspaceId })

    try {
      const snap = await fetchThreads(workspaceId)
      store.setThreads(snap.threads)
      store.setWorkspaceTabs(snap.tabs)

      const preferred = snap.tabs.active_tab
      const initial =
        (snap.threads.some((t) => t.thread_id === preferred) ? preferred : null) ??
        snap.threads[0]?.thread_id ??
        null

      if (initial == null) {
        const existing = new Set<number>()
        store.markPendingCreateThread({ workspaceId, existingThreadIds: existing })
        args.sendAction({ type: "create_workspace_thread", workspace_id: workspaceId })
        store.setActiveThreadId(null)

        await waitAndActivateNewThread({ workspaceId, existingThreadIds: existing })
        return
      }

      store.setActiveThreadId(initial)
      try {
        const convo = await fetchConversation(workspaceId, initial)
        store.setConversation(convo)
      } catch (err) {
        console.warn("fetchConversation failed", err)
      }
    } catch (err) {
      console.warn("fetchThreads failed", err)
    }
  }

  async function selectThread(threadId: number) {
    const wid = store.refs.activeWorkspaceIdRef.current
    if (wid == null) return
    await selectThreadInWorkspace(wid, threadId)
  }

  function createThread() {
    const wid = store.refs.activeWorkspaceIdRef.current
    if (wid == null) return

    void (async () => {
      const existingThreadIds = new Set(store.refs.threadsRef.current.map((t) => t.thread_id))
      store.markPendingCreateThread({ workspaceId: wid, existingThreadIds })
      args.sendAction({ type: "open_workspace", workspace_id: wid })
      args.sendAction({ type: "create_workspace_thread", workspace_id: wid })

      await waitAndActivateNewThread({ workspaceId: wid, existingThreadIds })
    })()
  }

  async function closeThreadTab(threadId: number) {
    const wid = store.refs.activeWorkspaceIdRef.current
    if (wid == null) return
    args.sendAction({ type: "close_workspace_thread_tab", workspace_id: wid, thread_id: threadId })
    try {
      await refreshThreads(wid)
    } catch (err) {
      console.warn("fetchThreads failed", err)
    }
  }

  async function restoreThreadTab(threadId: number) {
    const wid = store.refs.activeWorkspaceIdRef.current
    if (wid == null) return
    args.sendAction({ type: "restore_workspace_thread_tab", workspace_id: wid, thread_id: threadId })
    try {
      await refreshThreads(wid)
    } catch (err) {
      console.warn("fetchThreads failed", err)
    }
  }

  function activeWorkspaceThread(): { workspaceId: WorkspaceId; threadId: number } | null {
    const wid = store.refs.activeWorkspaceIdRef.current
    const tid = store.refs.activeThreadIdRef.current
    if (wid == null || tid == null) return null
    return { workspaceId: wid, threadId: tid }
  }

  function sendAgentMessage(text: string, attachments: AttachmentRef[] = []) {
    const ids = activeWorkspaceThread()
    if (!ids) return
    args.sendAction({
      type: "send_agent_message",
      workspace_id: ids.workspaceId,
      thread_id: ids.threadId,
      text,
      attachments,
    })
  }

  function sendAgentMessageTo(
    workspaceId: WorkspaceId,
    threadId: number,
    text: string,
    attachments: AttachmentRef[] = [],
  ) {
    args.sendAction({
      type: "send_agent_message",
      workspace_id: workspaceId,
      thread_id: threadId,
      text,
      attachments,
    })
  }

  function cancelAgentTurn() {
    const ids = activeWorkspaceThread()
    if (!ids) return
    args.sendAction({ type: "cancel_agent_turn", workspace_id: ids.workspaceId, thread_id: ids.threadId })
  }

  function setChatModel(workspaceId: WorkspaceId, threadId: WorkspaceThreadId, modelId: string) {
    args.sendAction({
      type: "chat_model_changed",
      workspace_id: workspaceId,
      thread_id: threadId,
      model_id: modelId,
    })
  }

  function setThinkingEffort(
    workspaceId: WorkspaceId,
    threadId: WorkspaceThreadId,
    effort: ThinkingEffort,
  ) {
    args.sendAction({
      type: "thinking_effort_changed",
      workspace_id: workspaceId,
      thread_id: threadId,
      thinking_effort: effort,
    })
  }

  return {
    pickProjectPath,
    addProject,
    deleteProject,
    createWorkspace,
    openWorkspaceInIde,
    openWorkspacePullRequest,
    openWorkspacePullRequestFailedAction,
    archiveWorkspace,
    toggleProjectExpanded,
    previewTask,
    executeTask,
    openWorkspace,
    selectThread,
    selectThreadInWorkspace,
    createThread,
    closeThreadTab,
    restoreThreadTab,
    sendAgentMessage,
    sendAgentMessageTo,
    cancelAgentTurn,
    setChatModel,
    setThinkingEffort,
  }
}
