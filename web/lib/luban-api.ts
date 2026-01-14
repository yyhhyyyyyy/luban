export type ProjectId = number
export type WorkspaceId = number
export type WorkspaceThreadId = number

export type WorkspaceStatus = "active" | "archived"

export type AppearanceTheme = "light" | "dark" | "system"

export type AppearanceFontsSnapshot = {
  ui_font: string
  chat_font: string
  code_font: string
  terminal_font: string
}

export type AppearanceSnapshot = {
  theme: AppearanceTheme
  fonts: AppearanceFontsSnapshot
}

export type AgentSettingsSnapshot = {
  codex_enabled: boolean
  default_model_id?: string
  default_thinking_effort?: ThinkingEffort
}

export type TaskPromptTemplateSnapshot = {
  intent_kind: TaskIntentKind
  template: string
}

export type TaskSettingsSnapshot = {
  prompt_templates: TaskPromptTemplateSnapshot[]
  default_prompt_templates: TaskPromptTemplateSnapshot[]
}

export type AppSnapshot = {
  rev: number
  projects: ProjectSnapshot[]
  appearance: AppearanceSnapshot
  agent: AgentSettingsSnapshot
  task: TaskSettingsSnapshot
}

export type ProjectSnapshot = {
  id: ProjectId
  name: string
  slug: string
  path: string
  is_git: boolean
  expanded: boolean
  create_workspace_status: OperationStatus
  workspaces: WorkspaceSnapshot[]
}

export type WorkspaceSnapshot = {
  id: WorkspaceId
  short_id: string
  workspace_name: string
  branch_name: string
  worktree_path: string
  status: WorkspaceStatus
  archive_status: OperationStatus
  agent_run_status: OperationStatus
  has_unread_completion: boolean
  pull_request: PullRequestSnapshot | null
}

export type FileChangeStatus = "modified" | "added" | "deleted" | "renamed"

export type FileChangeGroup = "committed" | "staged" | "unstaged"

export type ChangedFileSnapshot = {
  id: string
  path: string
  name: string
  status: FileChangeStatus
  group: FileChangeGroup
  additions: number | null
  deletions: number | null
  old_path: string | null
}

export type WorkspaceChangesSnapshot = {
  workspace_id: WorkspaceId
  files: ChangedFileSnapshot[]
}

export type DiffFileContents = {
  name: string
  contents: string
}

export type WorkspaceDiffFileSnapshot = {
  file: ChangedFileSnapshot
  old_file: DiffFileContents
  new_file: DiffFileContents
}

export type WorkspaceDiffSnapshot = {
  workspace_id: WorkspaceId
  files: WorkspaceDiffFileSnapshot[]
}

export type PullRequestState = "open" | "closed" | "merged"

export type PullRequestCiState = "pending" | "success" | "failure"

export type PullRequestSnapshot = {
  number: number
  is_draft: boolean
  state: PullRequestState
  ci_state: PullRequestCiState | null
  merge_ready: boolean
}

export type ThreadsSnapshot = {
  rev: number
  workspace_id: WorkspaceId
  tabs: WorkspaceTabsSnapshot
  threads: ThreadMeta[]
}

export type WorkspaceTabsSnapshot = {
  open_tabs: WorkspaceThreadId[]
  archived_tabs: WorkspaceThreadId[]
  active_tab: WorkspaceThreadId
}

export type ThreadMeta = {
  thread_id: WorkspaceThreadId
  remote_thread_id: string | null
  title: string
  updated_at_unix_seconds: number
}

export type AttachmentKind = "image" | "text" | "file"

export type AttachmentRef = {
  id: string
  kind: AttachmentKind
  name: string
  extension: string
  mime: string | null
  byte_len: number
}

export type ContextItemSnapshot = {
  context_id: number
  attachment: AttachmentRef
  created_at_unix_ms: number
}

export type ContextSnapshot = {
  workspace_id: WorkspaceId
  items: ContextItemSnapshot[]
}

export type ConversationSnapshot = {
  rev: number
  workspace_id: WorkspaceId
  thread_id: WorkspaceThreadId
  agent_model_id: string
  thinking_effort: ThinkingEffort
  run_status: OperationStatus
  entries: ConversationEntry[]
  in_progress_items: AgentItem[]
  remote_thread_id: string | null
  title: string
}

export type OperationStatus = "idle" | "running"

export type ThinkingEffort = "minimal" | "low" | "medium" | "high" | "xhigh"

export type TaskIntentKind =
  | "fix"
  | "implement"
  | "review"
  | "discuss"
  | "other"

export type TaskRepoInfo = {
  full_name: string
  url: string
  default_branch: string | null
}

export type TaskIssueInfo = {
  number: number
  title: string
  url: string
}

export type TaskPullRequestInfo = {
  number: number
  title: string
  url: string
  head_ref: string | null
  base_ref: string | null
  mergeable: string | null
}

export type TaskProjectSpec =
  | { type: "unspecified" }
  | { type: "local_path"; path: string }
  | { type: "git_hub_repo"; full_name: string }

export type TaskDraft = {
  input: string
  project: TaskProjectSpec
  intent_kind: TaskIntentKind
  summary: string
  prompt: string
  repo: TaskRepoInfo | null
  issue: TaskIssueInfo | null
  pull_request: TaskPullRequestInfo | null
}

export type TaskExecuteMode = "create" | "start"

export type TaskExecuteResult = {
  project_id: ProjectId
  workspace_id: WorkspaceId
  thread_id: WorkspaceThreadId
  worktree_path: string
  prompt: string
  mode: TaskExecuteMode
}

export type CodexConfigEntryKind = "file" | "folder"

export type CodexConfigEntrySnapshot = {
  path: string
  name: string
  kind: CodexConfigEntryKind
  children: CodexConfigEntrySnapshot[]
}

export type AgentItemKind =
  | "agent_message"
  | "reasoning"
  | "command_execution"
  | "file_change"
  | "mcp_tool_call"
  | "web_search"
  | "todo_list"
  | "error"

export type AgentItem = {
  id: string
  kind: AgentItemKind
  payload: unknown
}

export type ConversationEntry =
  | { type: "user_message"; text: string; attachments: AttachmentRef[] }
  | { type: "agent_item"; id: string; kind: AgentItemKind; payload: unknown }
  | { type: "turn_usage"; usage_json: unknown | null }
  | { type: "turn_duration"; duration_ms: number }
  | { type: "turn_canceled" }
  | { type: "turn_error"; message: string }

export type ClientAction =
  | { type: "pick_project_path" }
  | { type: "add_project"; path: string }
  | { type: "task_preview"; input: string }
  | { type: "task_execute"; draft: TaskDraft; mode: TaskExecuteMode }
  | { type: "delete_project"; project_id: ProjectId }
  | { type: "toggle_project_expanded"; project_id: ProjectId }
  | { type: "create_workspace"; project_id: ProjectId }
  | { type: "ensure_main_workspace"; project_id: ProjectId }
  | { type: "open_workspace"; workspace_id: WorkspaceId }
  | { type: "open_workspace_in_ide"; workspace_id: WorkspaceId }
  | { type: "open_workspace_pull_request"; workspace_id: WorkspaceId }
  | { type: "open_workspace_pull_request_failed_action"; workspace_id: WorkspaceId }
  | { type: "archive_workspace"; workspace_id: WorkspaceId }
  | { type: "chat_model_changed"; workspace_id: WorkspaceId; thread_id: WorkspaceThreadId; model_id: string }
  | {
      type: "thinking_effort_changed"
      workspace_id: WorkspaceId
      thread_id: WorkspaceThreadId
      thinking_effort: ThinkingEffort
    }
  | {
      type: "send_agent_message"
      workspace_id: WorkspaceId
      thread_id: WorkspaceThreadId
      text: string
      attachments: AttachmentRef[]
    }
  | { type: "cancel_agent_turn"; workspace_id: WorkspaceId; thread_id: WorkspaceThreadId }
  | { type: "create_workspace_thread"; workspace_id: WorkspaceId }
  | { type: "activate_workspace_thread"; workspace_id: WorkspaceId; thread_id: WorkspaceThreadId }
  | { type: "close_workspace_thread_tab"; workspace_id: WorkspaceId; thread_id: WorkspaceThreadId }
  | { type: "restore_workspace_thread_tab"; workspace_id: WorkspaceId; thread_id: WorkspaceThreadId }
  | {
      type: "reorder_workspace_thread_tab"
      workspace_id: WorkspaceId
      thread_id: WorkspaceThreadId
      to_index: number
    }
  | { type: "appearance_theme_changed"; theme: AppearanceTheme }
  | { type: "appearance_fonts_changed"; fonts: AppearanceFontsSnapshot }
  | { type: "codex_enabled_changed"; enabled: boolean }
  | { type: "task_prompt_template_changed"; intent_kind: TaskIntentKind; template: string }
  | { type: "codex_check" }
  | { type: "codex_config_tree" }
  | { type: "codex_config_read_file"; path: string }
  | { type: "codex_config_write_file"; path: string; contents: string }

export type ServerEvent =
  | { type: "app_changed"; rev: number; snapshot: AppSnapshot }
  | { type: "workspace_threads_changed"; workspace_id: WorkspaceId; tabs: WorkspaceTabsSnapshot; threads: ThreadMeta[] }
  | { type: "conversation_changed"; snapshot: ConversationSnapshot }
  | { type: "toast"; message: string }
  | { type: "project_path_picked"; request_id: string; path: string | null }
  | { type: "task_preview_ready"; request_id: string; draft: TaskDraft }
  | { type: "task_executed"; request_id: string; result: TaskExecuteResult }
  | { type: "codex_check_ready"; request_id: string; ok: boolean; message: string | null }
  | { type: "codex_config_tree_ready"; request_id: string; tree: CodexConfigEntrySnapshot[] }
  | { type: "codex_config_file_ready"; request_id: string; path: string; contents: string }
  | { type: "codex_config_file_saved"; request_id: string; path: string }

export type WsClientMessage =
  | { type: "hello"; protocol_version: number; last_seen_rev: number | null }
  | { type: "action"; request_id: string; action: ClientAction }
  | { type: "ping" }

export type WsServerMessage =
  | { type: "hello"; protocol_version: number; current_rev: number }
  | { type: "ack"; request_id: string; rev: number }
  | { type: "event"; rev: number; event: ServerEvent }
  | { type: "error"; request_id: string | null; message: string }
  | { type: "pong" }
