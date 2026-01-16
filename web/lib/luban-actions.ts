"use client"

import type {
  AgentRunConfigSnapshot,
  AppearanceFontsSnapshot,
  AppearanceTheme,
  AttachmentRef,
  ClientAction,
  CodexConfigEntrySnapshot,
  OpenTarget,
  ProjectId,
  SystemTaskKind,
  TaskIntentKind,
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
  addProjectAndOpen: (path: string) => Promise<{ projectId: ProjectId; workspaceId: WorkspaceId }>
  deleteProject: (projectId: ProjectId) => void
  createWorkspace: (projectId: ProjectId) => void
  ensureMainWorkspace: (projectId: ProjectId) => void
  openWorkspaceInIde: (workspaceId: WorkspaceId) => void
  openWorkspaceWith: (workspaceId: WorkspaceId, target: OpenTarget) => void
  openWorkspacePullRequest: (workspaceId: WorkspaceId) => void
  openWorkspacePullRequestFailedAction: (workspaceId: WorkspaceId) => void
  archiveWorkspace: (workspaceId: number) => void
  toggleProjectExpanded: (projectId: ProjectId) => void
  setCodexEnabled: (enabled: boolean) => void
  setTaskPromptTemplate: (intentKind: TaskIntentKind, template: string) => void
  setSystemPromptTemplate: (kind: SystemTaskKind, template: string) => void
  checkCodex: () => Promise<{ ok: boolean; message: string | null }>
  getCodexConfigTree: () => Promise<CodexConfigEntrySnapshot[]>
  readCodexConfigFile: (path: string) => Promise<string>
  writeCodexConfigFile: (path: string, contents: string) => Promise<void>

  previewTask: (input: string) => Promise<TaskDraft>
  executeTask: (draft: TaskDraft, mode: TaskExecuteMode) => Promise<TaskExecuteResult>

  openWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  selectThread: (threadId: number) => Promise<void>
  createThread: () => void
  closeThreadTab: (threadId: number) => Promise<void>
  restoreThreadTab: (threadId: number) => Promise<void>

  sendAgentMessage: (text: string, attachments?: AttachmentRef[]) => void
  queueAgentMessage: (text: string, attachments?: AttachmentRef[]) => void
  sendAgentMessageTo: (
    workspaceId: WorkspaceId,
    threadId: number,
    text: string,
    attachments?: AttachmentRef[],
  ) => void
  removeQueuedPrompt: (workspaceId: WorkspaceId, threadId: WorkspaceThreadId, promptId: number) => void
  reorderQueuedPrompt: (
    workspaceId: WorkspaceId,
    threadId: WorkspaceThreadId,
    activeId: number,
    overId: number,
  ) => void
  updateQueuedPrompt: (
    workspaceId: WorkspaceId,
    threadId: WorkspaceThreadId,
    promptId: number,
    args: { text: string; attachments: AttachmentRef[]; runConfig: AgentRunConfigSnapshot },
  ) => void
  cancelAgentTurn: () => void

  setChatModel: (workspaceId: WorkspaceId, threadId: WorkspaceThreadId, modelId: string) => void
  setThinkingEffort: (workspaceId: WorkspaceId, threadId: WorkspaceThreadId, effort: ThinkingEffort) => void
  setAppearanceTheme: (theme: AppearanceTheme) => void
  setAppearanceFonts: (fonts: AppearanceFontsSnapshot) => void
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

  function addProjectAndOpen(path: string): Promise<{ projectId: ProjectId; workspaceId: WorkspaceId }> {
    return args.request<{ projectId: ProjectId; workspaceId: WorkspaceId }>({ type: "add_project_and_open", path })
  }

  function deleteProject(projectId: ProjectId) {
    args.sendAction({ type: "delete_project", project_id: projectId })
  }

  function pickProjectPath(): Promise<string | null> {
    return args.request<string | null>({ type: "pick_project_path" })
  }

  function createWorkspace(projectId: ProjectId) {
    args.sendAction({ type: "create_workspace", project_id: projectId })
  }

  function ensureMainWorkspace(projectId: ProjectId) {
    args.sendAction({ type: "ensure_main_workspace", project_id: projectId })
  }

  function openWorkspaceInIde(workspaceId: WorkspaceId) {
    args.sendAction({ type: "open_workspace_in_ide", workspace_id: workspaceId })
  }

  function openWorkspaceWith(workspaceId: WorkspaceId, target: OpenTarget) {
    args.sendAction({ type: "open_workspace_with", workspace_id: workspaceId, target })
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

  function toggleProjectExpanded(projectId: ProjectId) {
    store.setApp((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        projects: prev.projects.map((p) => (p.id === projectId ? { ...p, expanded: !p.expanded } : p)),
      }
    })
    args.sendAction({ type: "toggle_project_expanded", project_id: projectId })
  }

  function setCodexEnabled(enabled: boolean) {
    args.sendAction({ type: "codex_enabled_changed", enabled })
  }

  function setTaskPromptTemplate(intentKind: TaskIntentKind, template: string) {
    const trimmed = template.trim()
    if (!trimmed) return

    store.setApp((prev) => {
      if (!prev) return prev
      const task = prev.task ?? {
        prompt_templates: [],
        default_prompt_templates: [],
        system_prompt_templates: [],
        default_system_prompt_templates: [],
      }
      const existing = task.prompt_templates
      const nextTemplates = [...existing]
      const idx = nextTemplates.findIndex((t) => t.intent_kind === intentKind)
      if (idx >= 0) nextTemplates[idx] = { intent_kind: intentKind, template: trimmed }
      else nextTemplates.push({ intent_kind: intentKind, template: trimmed })
      return {
        ...prev,
        task: {
          ...task,
          prompt_templates: nextTemplates,
        },
      }
    })

    args.sendAction({ type: "task_prompt_template_changed", intent_kind: intentKind, template: trimmed })
  }

  function setSystemPromptTemplate(kind: SystemTaskKind, template: string) {
    const trimmed = template.trim()
    if (!trimmed) return

    store.setApp((prev) => {
      if (!prev) return prev
      const task = prev.task ?? {
        prompt_templates: [],
        default_prompt_templates: [],
        system_prompt_templates: [],
        default_system_prompt_templates: [],
      }
      const existing = task.system_prompt_templates
      const nextTemplates = [...existing]
      const idx = nextTemplates.findIndex((t) => t.kind === kind)
      if (idx >= 0) nextTemplates[idx] = { kind, template: trimmed }
      else nextTemplates.push({ kind, template: trimmed })
      return {
        ...prev,
        task: {
          ...task,
          system_prompt_templates: nextTemplates,
        },
      }
    })

    args.sendAction({ type: "system_prompt_template_changed", kind, template: trimmed })
  }

  function checkCodex(): Promise<{ ok: boolean; message: string | null }> {
    return args.request<{ ok: boolean; message: string | null }>({ type: "codex_check" })
  }

  function getCodexConfigTree(): Promise<CodexConfigEntrySnapshot[]> {
    return args.request<CodexConfigEntrySnapshot[]>({ type: "codex_config_tree" })
  }

  function readCodexConfigFile(path: string): Promise<string> {
    return args.request<string>({ type: "codex_config_read_file", path })
  }

  async function writeCodexConfigFile(path: string, contents: string): Promise<void> {
    await args.request<null>({ type: "codex_config_write_file", path, contents })
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

  function queueAgentMessage(text: string, attachments: AttachmentRef[] = []) {
    const ids = activeWorkspaceThread()
    if (!ids) return
    args.sendAction({
      type: "queue_agent_message",
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

  function removeQueuedPrompt(workspaceId: WorkspaceId, threadId: WorkspaceThreadId, promptId: number) {
    store.setConversation((prev) => {
      if (!prev) return prev
      if (prev.workspace_id !== workspaceId || prev.thread_id !== threadId) return prev
      return { ...prev, pending_prompts: prev.pending_prompts.filter((p) => p.id !== promptId) }
    })
    args.sendAction({ type: "remove_queued_prompt", workspace_id: workspaceId, thread_id: threadId, prompt_id: promptId })
  }

  function reorderQueuedPrompt(
    workspaceId: WorkspaceId,
    threadId: WorkspaceThreadId,
    activeId: number,
    overId: number,
  ) {
    store.setConversation((prev) => {
      if (!prev) return prev
      if (prev.workspace_id !== workspaceId || prev.thread_id !== threadId) return prev
      const from = prev.pending_prompts.findIndex((p) => p.id === activeId)
      const to = prev.pending_prompts.findIndex((p) => p.id === overId)
      if (from < 0 || to < 0 || from === to) return prev
      const next = [...prev.pending_prompts]
      const [item] = next.splice(from, 1)
      if (!item) return prev
      next.splice(to, 0, item)
      return { ...prev, pending_prompts: next }
    })
    args.sendAction({
      type: "reorder_queued_prompt",
      workspace_id: workspaceId,
      thread_id: threadId,
      active_id: activeId,
      over_id: overId,
    })
  }

  function updateQueuedPrompt(
    workspaceId: WorkspaceId,
    threadId: WorkspaceThreadId,
    promptId: number,
    args2: { text: string; attachments: AttachmentRef[]; runConfig: AgentRunConfigSnapshot },
  ) {
    const text = args2.text.trim()
    const attachments = args2.attachments
    const runConfig = args2.runConfig
    store.setConversation((prev) => {
      if (!prev) return prev
      if (prev.workspace_id !== workspaceId || prev.thread_id !== threadId) return prev
      const next = prev.pending_prompts.map((p) =>
        p.id === promptId ? { ...p, text, attachments, run_config: runConfig } : p,
      )
      return { ...prev, pending_prompts: next }
    })
    args.sendAction({
      type: "update_queued_prompt",
      workspace_id: workspaceId,
      thread_id: threadId,
      prompt_id: promptId,
      text,
      attachments,
      model_id: runConfig.model_id,
      thinking_effort: runConfig.thinking_effort,
    })
  }

  function cancelAgentTurn() {
    const ids = activeWorkspaceThread()
    if (!ids) return
    args.sendAction({ type: "cancel_agent_turn", workspace_id: ids.workspaceId, thread_id: ids.threadId })
  }

  function renameWorkspaceBranch(workspaceId: WorkspaceId, branchName: string) {
    args.sendAction({ type: "workspace_rename_branch", workspace_id: workspaceId, branch_name: branchName })
  }

  function aiRenameWorkspaceBranch(workspaceId: WorkspaceId, threadId: WorkspaceThreadId) {
    args.sendAction({ type: "workspace_ai_rename_branch", workspace_id: workspaceId, thread_id: threadId })
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

  function setAppearanceTheme(theme: AppearanceTheme) {
    args.sendAction({ type: "appearance_theme_changed", theme })
  }

  function setAppearanceFonts(fonts: AppearanceFontsSnapshot) {
    args.sendAction({ type: "appearance_fonts_changed", fonts })
  }

  return {
    pickProjectPath,
    addProject,
    addProjectAndOpen,
    deleteProject,
    createWorkspace,
    ensureMainWorkspace,
    openWorkspaceInIde,
    openWorkspaceWith,
    openWorkspacePullRequest,
    openWorkspacePullRequestFailedAction,
    archiveWorkspace,
    toggleProjectExpanded,
    setCodexEnabled,
    setTaskPromptTemplate,
    setSystemPromptTemplate,
    checkCodex,
    getCodexConfigTree,
    readCodexConfigFile,
    writeCodexConfigFile,
    previewTask,
    executeTask,
    openWorkspace,
    selectThread,
    selectThreadInWorkspace,
    createThread,
    closeThreadTab,
    restoreThreadTab,
    sendAgentMessage,
    queueAgentMessage,
    sendAgentMessageTo,
    removeQueuedPrompt,
    reorderQueuedPrompt,
    updateQueuedPrompt,
    cancelAgentTurn,
    renameWorkspaceBranch,
    aiRenameWorkspaceBranch,
    setChatModel,
    setThinkingEffort,
    setAppearanceTheme,
    setAppearanceFonts,
  }
}
