use std::collections::VecDeque;
use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
};

mod adapters;
pub use adapters::{
    ContextImage, CreatedWorkspace, ProjectWorkspaceService, PullRequestInfo, PullRequestState,
    RunAgentTurnRequest,
};
mod context_tokens;
pub use context_tokens::{
    ContextToken, ContextTokenKind, extract_context_image_paths_in_order, find_context_tokens,
};
mod agent_settings;
pub use agent_settings::{
    AgentModelSpec, ThinkingEffort, agent_model_label, agent_models, default_agent_model_id,
    default_thinking_effort, normalize_thinking_effort, thinking_effort_supported,
};
mod dashboard;
pub use dashboard::{
    DashboardCardModel, DashboardPreviewMessage, DashboardPreviewModel, DashboardStage,
    dashboard_cards, dashboard_preview,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub struct ProjectId(u64);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub struct WorkspaceId(u64);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MainPane {
    None,
    Dashboard,
    ProjectSettings(ProjectId),
    Workspace(WorkspaceId),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RightPane {
    None,
    Terminal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkspaceStatus {
    Active,
    Archived,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationStatus {
    Idle,
    Running,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexCommandExecutionStatus {
    InProgress,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexPatchChangeKind {
    Add,
    Delete,
    Update,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CodexFileUpdateChange {
    pub path: String,
    pub kind: CodexPatchChangeKind,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexPatchApplyStatus {
    Completed,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexMcpToolCallStatus {
    InProgress,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CodexErrorMessage {
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CodexTodoItem {
    pub text: String,
    pub completed: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum CodexThreadItem {
    #[serde(rename = "agent_message")]
    AgentMessage { id: String, text: String },
    #[serde(rename = "reasoning")]
    Reasoning { id: String, text: String },
    #[serde(rename = "command_execution")]
    CommandExecution {
        id: String,
        command: String,
        aggregated_output: String,
        exit_code: Option<i32>,
        status: CodexCommandExecutionStatus,
    },
    #[serde(rename = "file_change")]
    FileChange {
        id: String,
        changes: Vec<CodexFileUpdateChange>,
        status: CodexPatchApplyStatus,
    },
    #[serde(rename = "mcp_tool_call")]
    McpToolCall {
        id: String,
        server: String,
        tool: String,
        arguments: serde_json::Value,
        result: Option<serde_json::Value>,
        error: Option<CodexErrorMessage>,
        status: CodexMcpToolCallStatus,
    },
    #[serde(rename = "web_search")]
    WebSearch { id: String, query: String },
    #[serde(rename = "todo_list")]
    TodoList {
        id: String,
        items: Vec<CodexTodoItem>,
    },
    #[serde(rename = "error")]
    Error { id: String, message: String },
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CodexUsage {
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CodexThreadError {
    pub message: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum CodexThreadEvent {
    #[serde(rename = "thread.started")]
    ThreadStarted { thread_id: String },
    #[serde(rename = "turn.started")]
    TurnStarted,
    #[serde(rename = "turn.completed")]
    TurnCompleted { usage: CodexUsage },
    #[serde(rename = "turn.duration")]
    TurnDuration { duration_ms: u64 },
    #[serde(rename = "turn.failed")]
    TurnFailed { error: CodexThreadError },

    #[serde(rename = "item.started")]
    ItemStarted { item: CodexThreadItem },
    #[serde(rename = "item.updated")]
    ItemUpdated { item: CodexThreadItem },
    #[serde(rename = "item.completed")]
    ItemCompleted { item: CodexThreadItem },

    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ConversationEntry {
    UserMessage { text: String },
    CodexItem { item: Box<CodexThreadItem> },
    TurnUsage { usage: Option<CodexUsage> },
    TurnDuration { duration_ms: u64 },
    TurnCanceled,
    TurnError { message: String },
}

fn entry_is_same_codex_item(entry: &ConversationEntry, item: &CodexThreadItem) -> bool {
    match entry {
        ConversationEntry::CodexItem { item: existing } => {
            codex_item_id(existing) == codex_item_id(item)
        }
        _ => false,
    }
}

fn entries_contain_codex_item(entries: &[ConversationEntry], item: &CodexThreadItem) -> bool {
    entries.iter().any(|e| entry_is_same_codex_item(e, item))
}

fn flush_in_progress_items(conversation: &mut WorkspaceConversation) {
    let pending = conversation
        .in_progress_order
        .iter()
        .filter_map(|id| conversation.in_progress_items.get(id))
        .cloned()
        .collect::<Vec<_>>();

    for item in pending {
        if entries_contain_codex_item(&conversation.entries, &item) {
            continue;
        }
        conversation.entries.push(ConversationEntry::CodexItem {
            item: Box::new(item),
        });
    }
}

fn entry_is_same(a: &ConversationEntry, b: &ConversationEntry) -> bool {
    match (a, b) {
        (
            ConversationEntry::UserMessage { text: a },
            ConversationEntry::UserMessage { text: b },
        ) => a == b,
        (ConversationEntry::CodexItem { item: a }, ConversationEntry::CodexItem { item: b }) => {
            codex_item_id(a) == codex_item_id(b)
        }
        (ConversationEntry::TurnUsage { usage: a }, ConversationEntry::TurnUsage { usage: b }) => {
            a == b
        }
        (
            ConversationEntry::TurnDuration { duration_ms: a },
            ConversationEntry::TurnDuration { duration_ms: b },
        ) => a == b,
        (ConversationEntry::TurnCanceled, ConversationEntry::TurnCanceled) => true,
        (
            ConversationEntry::TurnError { message: a },
            ConversationEntry::TurnError { message: b },
        ) => a == b,
        _ => false,
    }
}

fn entries_is_prefix(prefix: &[ConversationEntry], full: &[ConversationEntry]) -> bool {
    if prefix.len() > full.len() {
        return false;
    }
    prefix
        .iter()
        .zip(full.iter())
        .all(|(a, b)| entry_is_same(a, b))
}

fn entries_is_suffix(suffix: &[ConversationEntry], full: &[ConversationEntry]) -> bool {
    if suffix.len() > full.len() {
        return false;
    }
    let offset = full.len() - suffix.len();
    suffix
        .iter()
        .zip(full.iter().skip(offset))
        .all(|(a, b)| entry_is_same(a, b))
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ConversationSnapshot {
    pub thread_id: Option<String>,
    pub entries: Vec<ConversationEntry>,
}

#[derive(Clone, Debug)]
pub struct WorkspaceConversation {
    pub thread_id: Option<String>,
    pub draft: String,
    pub agent_model_id: String,
    pub thinking_effort: ThinkingEffort,
    pub entries: Vec<ConversationEntry>,
    pub run_status: OperationStatus,
    pub in_progress_items: BTreeMap<String, CodexThreadItem>,
    pub in_progress_order: VecDeque<String>,
    pub pending_prompts: VecDeque<QueuedPrompt>,
    pub queue_paused: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentRunConfig {
    pub model_id: String,
    pub thinking_effort: ThinkingEffort,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueuedPrompt {
    pub text: String,
    pub run_config: AgentRunConfig,
}

#[derive(Clone, Debug)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub workspace_name: String,
    pub branch_name: String,
    pub worktree_path: PathBuf,
    pub status: WorkspaceStatus,
    pub last_activity_at: Option<std::time::SystemTime>,
    pub archive_status: OperationStatus,
}

#[derive(Clone, Debug)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    pub path: PathBuf,
    pub slug: String,
    pub expanded: bool,
    pub create_workspace_status: OperationStatus,
    pub workspaces: Vec<Workspace>,
}

#[derive(Clone, Debug)]
pub struct AppState {
    next_project_id: u64,
    next_workspace_id: u64,

    pub projects: Vec<Project>,
    pub main_pane: MainPane,
    pub right_pane: RightPane,
    pub sidebar_width: Option<u16>,
    pub terminal_pane_width: Option<u16>,
    pub conversations: HashMap<WorkspaceId, WorkspaceConversation>,
    pub dashboard_preview_workspace_id: Option<WorkspaceId>,
    pub last_open_workspace_id: Option<WorkspaceId>,
    pub last_error: Option<String>,
    pub workspace_chat_scroll_y10: HashMap<WorkspaceId, i32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistedAppState {
    pub projects: Vec<PersistedProject>,
    pub sidebar_width: Option<u16>,
    pub terminal_pane_width: Option<u16>,
    pub last_open_workspace_id: Option<u64>,
    pub workspace_chat_scroll_y10: HashMap<u64, i32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistedProject {
    pub id: u64,
    pub name: String,
    pub path: PathBuf,
    pub slug: String,
    pub expanded: bool,
    pub workspaces: Vec<PersistedWorkspace>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PersistedWorkspace {
    pub id: u64,
    pub workspace_name: String,
    pub branch_name: String,
    pub worktree_path: PathBuf,
    pub status: WorkspaceStatus,
    pub last_activity_at_unix_seconds: Option<u64>,
}

#[derive(Clone, Debug)]
pub enum Action {
    AppStarted,

    OpenDashboard,
    DashboardPreviewOpened {
        workspace_id: WorkspaceId,
    },
    DashboardPreviewClosed,

    AddProject {
        path: PathBuf,
    },
    ToggleProjectExpanded {
        project_id: ProjectId,
    },
    OpenProjectSettings {
        project_id: ProjectId,
    },

    CreateWorkspace {
        project_id: ProjectId,
    },
    WorkspaceCreated {
        project_id: ProjectId,
        workspace_name: String,
        branch_name: String,
        worktree_path: PathBuf,
    },
    WorkspaceCreateFailed {
        project_id: ProjectId,
        message: String,
    },

    OpenWorkspace {
        workspace_id: WorkspaceId,
    },
    OpenWorkspaceInIde {
        workspace_id: WorkspaceId,
    },
    OpenWorkspaceInIdeFailed {
        message: String,
    },
    ArchiveWorkspace {
        workspace_id: WorkspaceId,
    },
    WorkspaceArchived {
        workspace_id: WorkspaceId,
    },
    WorkspaceArchiveFailed {
        workspace_id: WorkspaceId,
        message: String,
    },

    ConversationLoaded {
        workspace_id: WorkspaceId,
        snapshot: ConversationSnapshot,
    },
    ConversationLoadFailed {
        workspace_id: WorkspaceId,
        message: String,
    },
    SendAgentMessage {
        workspace_id: WorkspaceId,
        text: String,
    },
    ChatModelChanged {
        workspace_id: WorkspaceId,
        model_id: String,
    },
    ThinkingEffortChanged {
        workspace_id: WorkspaceId,
        thinking_effort: ThinkingEffort,
    },
    ChatDraftChanged {
        workspace_id: WorkspaceId,
        text: String,
    },
    RemoveQueuedPrompt {
        workspace_id: WorkspaceId,
        index: usize,
    },
    ClearQueuedPrompts {
        workspace_id: WorkspaceId,
    },
    ResumeQueuedPrompts {
        workspace_id: WorkspaceId,
    },
    AgentEventReceived {
        workspace_id: WorkspaceId,
        event: CodexThreadEvent,
    },
    AgentTurnFinished {
        workspace_id: WorkspaceId,
    },
    CancelAgentTurn {
        workspace_id: WorkspaceId,
    },

    ToggleTerminalPane,
    TerminalPaneWidthChanged {
        width: u16,
    },
    SidebarWidthChanged {
        width: u16,
    },
    WorkspaceChatScrollSaved {
        workspace_id: WorkspaceId,
        offset_y10: i32,
    },

    AppStateLoaded {
        persisted: PersistedAppState,
    },
    AppStateLoadFailed {
        message: String,
    },
    AppStateSaved,
    AppStateSaveFailed {
        message: String,
    },

    ClearError,
}

#[derive(Clone, Debug)]
pub enum Effect {
    LoadAppState,
    SaveAppState,

    CreateWorkspace {
        project_id: ProjectId,
    },
    OpenWorkspaceInIde {
        workspace_id: WorkspaceId,
    },
    ArchiveWorkspace {
        workspace_id: WorkspaceId,
    },
    EnsureConversation {
        workspace_id: WorkspaceId,
    },
    LoadConversation {
        workspace_id: WorkspaceId,
    },
    RunAgentTurn {
        workspace_id: WorkspaceId,
        text: String,
        run_config: AgentRunConfig,
    },
    CancelAgentTurn {
        workspace_id: WorkspaceId,
    },
}

impl AppState {
    const MAIN_WORKSPACE_NAME: &'static str = "main";
    const MAIN_WORKSPACE_BRANCH: &'static str = "main";

    pub fn new() -> Self {
        Self {
            next_project_id: 1,
            next_workspace_id: 1,
            projects: Vec::new(),
            main_pane: MainPane::None,
            right_pane: RightPane::None,
            sidebar_width: None,
            terminal_pane_width: None,
            conversations: HashMap::new(),
            dashboard_preview_workspace_id: None,
            last_open_workspace_id: None,
            last_error: None,
            workspace_chat_scroll_y10: HashMap::new(),
        }
    }

    pub fn demo() -> Self {
        let mut this = Self::new();
        let p1 = this.add_project(PathBuf::from("/Users/example/luban"));
        let p2 = this.add_project(PathBuf::from("/Users/example/scratch"));

        this.projects
            .iter_mut()
            .find(|p| p.id == p1)
            .unwrap()
            .expanded = true;
        this.projects
            .iter_mut()
            .find(|p| p.id == p2)
            .unwrap()
            .expanded = true;

        this.insert_workspace(
            p1,
            "abandon-about",
            "luban/abandon-about",
            PathBuf::from("/Users/example/luban/worktrees/luban/abandon-about"),
        );

        this
    }

    pub fn apply(&mut self, action: Action) -> Vec<Effect> {
        match action {
            Action::AppStarted => vec![Effect::LoadAppState],

            Action::OpenDashboard => {
                self.main_pane = MainPane::Dashboard;
                self.right_pane = RightPane::None;
                self.dashboard_preview_workspace_id = None;

                let mut effects = Vec::new();
                for project in &self.projects {
                    for workspace in &project.workspaces {
                        if workspace.status != WorkspaceStatus::Active {
                            continue;
                        }
                        if Self::workspace_is_main(project, workspace) {
                            continue;
                        }
                        effects.push(Effect::LoadConversation {
                            workspace_id: workspace.id,
                        });
                    }
                }
                effects
            }
            Action::DashboardPreviewOpened { workspace_id } => {
                if self.workspace(workspace_id).is_none() {
                    return Vec::new();
                }
                self.dashboard_preview_workspace_id = Some(workspace_id);
                vec![Effect::LoadConversation { workspace_id }]
            }
            Action::DashboardPreviewClosed => {
                self.dashboard_preview_workspace_id = None;
                Vec::new()
            }

            Action::AddProject { path } => {
                let project_id = self.add_project(path);
                self.insert_main_workspace(project_id);
                vec![Effect::SaveAppState]
            }
            Action::ToggleProjectExpanded { project_id } => {
                if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
                    project.expanded = !project.expanded;
                }
                vec![Effect::SaveAppState]
            }
            Action::OpenProjectSettings { project_id } => {
                self.main_pane = MainPane::ProjectSettings(project_id);
                self.right_pane = RightPane::None;
                self.dashboard_preview_workspace_id = None;
                Vec::new()
            }

            Action::CreateWorkspace { project_id } => {
                if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
                    if project.create_workspace_status == OperationStatus::Running {
                        return Vec::new();
                    }
                    project.create_workspace_status = OperationStatus::Running;
                }
                vec![Effect::CreateWorkspace { project_id }]
            }
            Action::WorkspaceCreated {
                project_id,
                workspace_name,
                branch_name,
                worktree_path,
            } => {
                let workspace_id =
                    self.insert_workspace(project_id, &workspace_name, &branch_name, worktree_path);
                if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
                    project.create_workspace_status = OperationStatus::Idle;
                }
                self.conversations.insert(
                    workspace_id,
                    WorkspaceConversation {
                        thread_id: None,
                        draft: String::new(),
                        agent_model_id: default_agent_model_id().to_owned(),
                        thinking_effort: default_thinking_effort(),
                        entries: Vec::new(),
                        run_status: OperationStatus::Idle,
                        in_progress_items: BTreeMap::new(),
                        in_progress_order: VecDeque::new(),
                        pending_prompts: VecDeque::new(),
                        queue_paused: false,
                    },
                );
                vec![
                    Effect::SaveAppState,
                    Effect::EnsureConversation { workspace_id },
                ]
            }
            Action::WorkspaceCreateFailed {
                project_id,
                message,
            } => {
                if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
                    project.create_workspace_status = OperationStatus::Idle;
                }
                self.last_error = Some(message);
                Vec::new()
            }

            Action::OpenWorkspace { workspace_id } => {
                self.main_pane = MainPane::Workspace(workspace_id);
                self.right_pane = RightPane::Terminal;
                self.dashboard_preview_workspace_id = None;
                self.last_open_workspace_id = Some(workspace_id);
                vec![
                    Effect::SaveAppState,
                    Effect::LoadConversation { workspace_id },
                ]
            }
            Action::OpenWorkspaceInIde { workspace_id } => {
                if self.workspace(workspace_id).is_none() {
                    self.last_error = Some("Workspace not found".to_owned());
                    return Vec::new();
                }
                vec![Effect::OpenWorkspaceInIde { workspace_id }]
            }
            Action::OpenWorkspaceInIdeFailed { message } => {
                self.last_error = Some(message);
                Vec::new()
            }
            Action::ArchiveWorkspace { workspace_id } => {
                if let Some((project_idx, workspace_idx)) =
                    self.find_workspace_indices(workspace_id)
                {
                    let is_main = {
                        let project = &self.projects[project_idx];
                        let workspace = &project.workspaces[workspace_idx];
                        Self::workspace_is_main(project, workspace)
                    };
                    if is_main {
                        return Vec::new();
                    }

                    let project = &mut self.projects[project_idx];
                    let workspace = &mut project.workspaces[workspace_idx];

                    if workspace.archive_status == OperationStatus::Running {
                        return Vec::new();
                    }
                    workspace.archive_status = OperationStatus::Running;
                    project.expanded = true;
                }
                vec![Effect::ArchiveWorkspace { workspace_id }]
            }
            Action::WorkspaceArchived { workspace_id } => {
                if let Some((project_idx, workspace_idx)) =
                    self.find_workspace_indices(workspace_id)
                {
                    let workspace = &mut self.projects[project_idx].workspaces[workspace_idx];
                    workspace.archive_status = OperationStatus::Idle;
                    workspace.status = WorkspaceStatus::Archived;
                }
                if self.last_open_workspace_id == Some(workspace_id) {
                    self.last_open_workspace_id = None;
                }
                if matches!(self.main_pane, MainPane::Workspace(id) if id == workspace_id) {
                    self.main_pane = MainPane::None;
                    self.right_pane = RightPane::None;
                }
                if self.dashboard_preview_workspace_id == Some(workspace_id) {
                    self.dashboard_preview_workspace_id = None;
                }
                vec![Effect::SaveAppState]
            }
            Action::WorkspaceArchiveFailed {
                workspace_id,
                message,
            } => {
                if let Some((project_idx, workspace_idx)) =
                    self.find_workspace_indices(workspace_id)
                {
                    let workspace = &mut self.projects[project_idx].workspaces[workspace_idx];
                    workspace.archive_status = OperationStatus::Idle;
                }
                self.last_error = Some(message);
                Vec::new()
            }

            Action::ConversationLoaded {
                workspace_id,
                snapshot,
            } => {
                if let Some(conversation) = self.conversations.get_mut(&workspace_id) {
                    if conversation.thread_id.is_none() {
                        conversation.thread_id = snapshot.thread_id;
                    }

                    if conversation.entries.is_empty() {
                        conversation.entries = snapshot.entries;
                        return Vec::new();
                    }

                    let snapshot_is_newer =
                        entries_is_prefix(&conversation.entries, &snapshot.entries)
                            || entries_is_suffix(&conversation.entries, &snapshot.entries);
                    let conversation_is_newer =
                        entries_is_prefix(&snapshot.entries, &conversation.entries)
                            || entries_is_suffix(&snapshot.entries, &conversation.entries);

                    if snapshot_is_newer && !conversation_is_newer {
                        conversation.entries = snapshot.entries;
                    }

                    return Vec::new();
                }

                self.conversations.insert(
                    workspace_id,
                    WorkspaceConversation {
                        thread_id: snapshot.thread_id,
                        draft: String::new(),
                        agent_model_id: default_agent_model_id().to_owned(),
                        thinking_effort: default_thinking_effort(),
                        entries: snapshot.entries,
                        run_status: OperationStatus::Idle,
                        in_progress_items: BTreeMap::new(),
                        in_progress_order: VecDeque::new(),
                        pending_prompts: VecDeque::new(),
                        queue_paused: false,
                    },
                );
                Vec::new()
            }
            Action::ConversationLoadFailed {
                workspace_id: _,
                message,
            } => {
                self.last_error = Some(message);
                Vec::new()
            }
            Action::SendAgentMessage { workspace_id, text } => {
                let conversation = self.conversations.entry(workspace_id).or_insert_with(|| {
                    WorkspaceConversation {
                        thread_id: None,
                        draft: String::new(),
                        agent_model_id: default_agent_model_id().to_owned(),
                        thinking_effort: default_thinking_effort(),
                        entries: Vec::new(),
                        run_status: OperationStatus::Idle,
                        in_progress_items: BTreeMap::new(),
                        in_progress_order: VecDeque::new(),
                        pending_prompts: VecDeque::new(),
                        queue_paused: false,
                    }
                });
                conversation.draft.clear();

                let run_config = AgentRunConfig {
                    model_id: conversation.agent_model_id.clone(),
                    thinking_effort: conversation.thinking_effort,
                };

                if conversation.run_status == OperationStatus::Running {
                    conversation
                        .pending_prompts
                        .push_back(QueuedPrompt { text, run_config });
                    return Vec::new();
                }

                if conversation.queue_paused && !conversation.pending_prompts.is_empty() {
                    conversation
                        .entries
                        .push(ConversationEntry::UserMessage { text: text.clone() });
                    conversation.run_status = OperationStatus::Running;
                    conversation.in_progress_items.clear();
                    conversation.in_progress_order.clear();
                    return vec![Effect::RunAgentTurn {
                        workspace_id,
                        text,
                        run_config,
                    }];
                }

                if conversation.pending_prompts.is_empty() {
                    conversation.queue_paused = false;
                    conversation
                        .entries
                        .push(ConversationEntry::UserMessage { text: text.clone() });
                    conversation.run_status = OperationStatus::Running;
                    conversation.in_progress_items.clear();
                    conversation.in_progress_order.clear();
                    return vec![Effect::RunAgentTurn {
                        workspace_id,
                        text,
                        run_config,
                    }];
                }

                conversation
                    .pending_prompts
                    .push_back(QueuedPrompt { text, run_config });
                start_next_queued_prompt(conversation, workspace_id)
                    .into_iter()
                    .collect()
            }
            Action::ChatModelChanged {
                workspace_id,
                model_id,
            } => {
                let conversation = self.conversations.entry(workspace_id).or_insert_with(|| {
                    WorkspaceConversation {
                        thread_id: None,
                        draft: String::new(),
                        agent_model_id: default_agent_model_id().to_owned(),
                        thinking_effort: default_thinking_effort(),
                        entries: Vec::new(),
                        run_status: OperationStatus::Idle,
                        in_progress_items: BTreeMap::new(),
                        in_progress_order: VecDeque::new(),
                        pending_prompts: VecDeque::new(),
                        queue_paused: false,
                    }
                });

                conversation.agent_model_id = model_id.clone();
                conversation.thinking_effort =
                    normalize_thinking_effort(&model_id, conversation.thinking_effort);
                Vec::new()
            }
            Action::ThinkingEffortChanged {
                workspace_id,
                thinking_effort,
            } => {
                let conversation = self.conversations.entry(workspace_id).or_insert_with(|| {
                    WorkspaceConversation {
                        thread_id: None,
                        draft: String::new(),
                        agent_model_id: default_agent_model_id().to_owned(),
                        thinking_effort: default_thinking_effort(),
                        entries: Vec::new(),
                        run_status: OperationStatus::Idle,
                        in_progress_items: BTreeMap::new(),
                        in_progress_order: VecDeque::new(),
                        pending_prompts: VecDeque::new(),
                        queue_paused: false,
                    }
                });

                if thinking_effort_supported(&conversation.agent_model_id, thinking_effort) {
                    conversation.thinking_effort = thinking_effort;
                }
                Vec::new()
            }
            Action::ChatDraftChanged { workspace_id, text } => {
                let conversation = self.conversations.entry(workspace_id).or_insert_with(|| {
                    WorkspaceConversation {
                        thread_id: None,
                        draft: String::new(),
                        agent_model_id: default_agent_model_id().to_owned(),
                        thinking_effort: default_thinking_effort(),
                        entries: Vec::new(),
                        run_status: OperationStatus::Idle,
                        in_progress_items: BTreeMap::new(),
                        in_progress_order: VecDeque::new(),
                        pending_prompts: VecDeque::new(),
                        queue_paused: false,
                    }
                });
                conversation.draft = text;
                Vec::new()
            }
            Action::RemoveQueuedPrompt {
                workspace_id,
                index,
            } => {
                let Some(conversation) = self.conversations.get_mut(&workspace_id) else {
                    return Vec::new();
                };
                let _ = conversation.pending_prompts.remove(index);
                Vec::new()
            }
            Action::ClearQueuedPrompts { workspace_id } => {
                let Some(conversation) = self.conversations.get_mut(&workspace_id) else {
                    return Vec::new();
                };
                conversation.pending_prompts.clear();
                Vec::new()
            }
            Action::ResumeQueuedPrompts { workspace_id } => {
                let Some(conversation) = self.conversations.get_mut(&workspace_id) else {
                    return Vec::new();
                };
                conversation.queue_paused = false;
                start_next_queued_prompt(conversation, workspace_id)
                    .into_iter()
                    .collect()
            }
            Action::AgentEventReceived {
                workspace_id,
                event,
            } => {
                let conversation = self.conversations.entry(workspace_id).or_insert_with(|| {
                    WorkspaceConversation {
                        thread_id: None,
                        draft: String::new(),
                        agent_model_id: default_agent_model_id().to_owned(),
                        thinking_effort: default_thinking_effort(),
                        entries: Vec::new(),
                        run_status: OperationStatus::Idle,
                        in_progress_items: BTreeMap::new(),
                        in_progress_order: VecDeque::new(),
                        pending_prompts: VecDeque::new(),
                        queue_paused: false,
                    }
                });

                match event {
                    CodexThreadEvent::ThreadStarted { thread_id } => {
                        conversation.thread_id = Some(thread_id);
                        Vec::new()
                    }
                    CodexThreadEvent::TurnStarted => Vec::new(),
                    CodexThreadEvent::TurnCompleted { usage } => {
                        let _ = usage;
                        conversation.run_status = OperationStatus::Idle;
                        flush_in_progress_items(conversation);
                        conversation.in_progress_items.clear();
                        conversation.in_progress_order.clear();
                        start_next_queued_prompt(conversation, workspace_id)
                            .into_iter()
                            .collect()
                    }
                    CodexThreadEvent::TurnDuration { duration_ms } => {
                        conversation
                            .entries
                            .push(ConversationEntry::TurnDuration { duration_ms });
                        Vec::new()
                    }
                    CodexThreadEvent::TurnFailed { error } => {
                        flush_in_progress_items(conversation);
                        conversation.entries.push(ConversationEntry::TurnError {
                            message: error.message.clone(),
                        });
                        conversation.run_status = OperationStatus::Idle;
                        conversation.in_progress_items.clear();
                        conversation.in_progress_order.clear();
                        conversation.queue_paused = true;
                        self.last_error = Some(error.message);
                        Vec::new()
                    }
                    CodexThreadEvent::ItemStarted { item }
                    | CodexThreadEvent::ItemUpdated { item } => {
                        let id = codex_item_id(&item).to_owned();
                        conversation.in_progress_items.insert(id.clone(), item);
                        if !conversation.in_progress_order.iter().any(|v| v == &id) {
                            conversation.in_progress_order.push_back(id);
                        }
                        Vec::new()
                    }
                    CodexThreadEvent::ItemCompleted { item } => {
                        let id = codex_item_id(&item);
                        conversation.in_progress_items.remove(id);
                        if let Some(pos) =
                            conversation.in_progress_order.iter().position(|v| v == id)
                        {
                            conversation.in_progress_order.remove(pos);
                        }
                        let is_duplicate = entries_contain_codex_item(&conversation.entries, &item);
                        if !is_duplicate {
                            conversation.entries.push(ConversationEntry::CodexItem {
                                item: Box::new(item),
                            });
                        }
                        Vec::new()
                    }
                    CodexThreadEvent::Error { message } => {
                        flush_in_progress_items(conversation);
                        conversation.entries.push(ConversationEntry::TurnError {
                            message: message.clone(),
                        });
                        conversation.run_status = OperationStatus::Idle;
                        conversation.in_progress_items.clear();
                        conversation.in_progress_order.clear();
                        conversation.queue_paused = true;
                        self.last_error = Some(message);
                        Vec::new()
                    }
                }
            }
            Action::AgentTurnFinished { workspace_id } => {
                if let Some(conversation) = self.conversations.get_mut(&workspace_id)
                    && conversation.run_status == OperationStatus::Running
                {
                    conversation.run_status = OperationStatus::Idle;
                    flush_in_progress_items(conversation);
                    conversation.in_progress_items.clear();
                    conversation.in_progress_order.clear();
                }
                Vec::new()
            }
            Action::CancelAgentTurn { workspace_id } => {
                let Some(conversation) = self.conversations.get_mut(&workspace_id) else {
                    return Vec::new();
                };
                if conversation.run_status != OperationStatus::Running {
                    return Vec::new();
                }
                conversation.run_status = OperationStatus::Idle;
                flush_in_progress_items(conversation);
                conversation.in_progress_items.clear();
                conversation.in_progress_order.clear();
                conversation.queue_paused = true;
                conversation.entries.push(ConversationEntry::TurnCanceled);
                vec![Effect::CancelAgentTurn { workspace_id }]
            }
            Action::ToggleTerminalPane => {
                let can_show_terminal = match self.main_pane {
                    MainPane::Workspace(workspace_id) => self.workspace(workspace_id).is_some(),
                    _ => false,
                };

                if can_show_terminal {
                    self.right_pane = match self.right_pane {
                        RightPane::Terminal => RightPane::None,
                        RightPane::None => RightPane::Terminal,
                    };
                } else {
                    self.right_pane = RightPane::None;
                }

                Vec::new()
            }
            Action::TerminalPaneWidthChanged { width } => {
                self.terminal_pane_width = Some(width);
                vec![Effect::SaveAppState]
            }
            Action::SidebarWidthChanged { width } => {
                self.sidebar_width = Some(width);
                vec![Effect::SaveAppState]
            }
            Action::WorkspaceChatScrollSaved {
                workspace_id,
                offset_y10,
            } => {
                if self.workspace_chat_scroll_y10.get(&workspace_id).copied() == Some(offset_y10) {
                    return Vec::new();
                }
                self.workspace_chat_scroll_y10
                    .insert(workspace_id, offset_y10);
                vec![Effect::SaveAppState]
            }

            Action::AppStateLoaded { persisted } => {
                if !self.projects.is_empty() {
                    return Vec::new();
                }

                self.projects = persisted
                    .projects
                    .into_iter()
                    .map(|p| Project {
                        id: ProjectId(p.id),
                        name: p.name,
                        path: p.path,
                        slug: p.slug,
                        expanded: p.expanded,
                        create_workspace_status: OperationStatus::Idle,
                        workspaces: p
                            .workspaces
                            .into_iter()
                            .map(|w| Workspace {
                                id: WorkspaceId(w.id),
                                workspace_name: w.workspace_name,
                                branch_name: w.branch_name,
                                worktree_path: w.worktree_path,
                                status: w.status,
                                last_activity_at: w.last_activity_at_unix_seconds.map(|secs| {
                                    std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs)
                                }),
                                archive_status: OperationStatus::Idle,
                            })
                            .collect(),
                    })
                    .collect();
                self.sidebar_width = persisted.sidebar_width;
                self.terminal_pane_width = persisted.terminal_pane_width;
                self.last_open_workspace_id = persisted.last_open_workspace_id.map(WorkspaceId);
                self.workspace_chat_scroll_y10 = persisted
                    .workspace_chat_scroll_y10
                    .into_iter()
                    .map(|(id, offset)| (WorkspaceId(id), offset))
                    .collect();

                let max_project_id = self.projects.iter().map(|p| p.id.0).max().unwrap_or(0);
                let max_workspace_id = self
                    .projects
                    .iter()
                    .flat_map(|p| &p.workspaces)
                    .map(|w| w.id.0)
                    .max()
                    .unwrap_or(0);

                self.next_project_id = max_project_id + 1;
                self.next_workspace_id = max_workspace_id + 1;
                self.main_pane = MainPane::None;
                self.right_pane = RightPane::None;
                self.dashboard_preview_workspace_id = None;

                let upgraded = self.ensure_main_workspaces();
                let mut effects = if upgraded {
                    vec![Effect::SaveAppState]
                } else {
                    Vec::new()
                };

                let restored_workspace_id = self.last_open_workspace_id.and_then(|workspace_id| {
                    self.workspace(workspace_id)
                        .filter(|w| w.status == WorkspaceStatus::Active)
                        .map(|_| workspace_id)
                });

                if let Some(workspace_id) = restored_workspace_id {
                    self.main_pane = MainPane::Workspace(workspace_id);
                    self.right_pane = RightPane::Terminal;
                    effects.push(Effect::LoadConversation { workspace_id });
                }

                effects
            }
            Action::AppStateLoadFailed { message } => {
                self.last_error = Some(message);
                Vec::new()
            }
            Action::AppStateSaved => Vec::new(),
            Action::AppStateSaveFailed { message } => {
                self.last_error = Some(message);
                Vec::new()
            }

            Action::ClearError => {
                self.last_error = None;
                Vec::new()
            }
        }
    }

    pub fn to_persisted(&self) -> PersistedAppState {
        PersistedAppState {
            projects: self
                .projects
                .iter()
                .map(|p| PersistedProject {
                    id: p.id.0,
                    name: p.name.clone(),
                    path: p.path.clone(),
                    slug: p.slug.clone(),
                    expanded: p.expanded,
                    workspaces: p
                        .workspaces
                        .iter()
                        .map(|w| PersistedWorkspace {
                            id: w.id.0,
                            workspace_name: w.workspace_name.clone(),
                            branch_name: w.branch_name.clone(),
                            worktree_path: w.worktree_path.clone(),
                            status: w.status,
                            last_activity_at_unix_seconds: w.last_activity_at.and_then(|t| {
                                t.duration_since(std::time::UNIX_EPOCH)
                                    .ok()
                                    .map(|d| d.as_secs())
                            }),
                        })
                        .collect(),
                })
                .collect(),
            sidebar_width: self.sidebar_width,
            terminal_pane_width: self.terminal_pane_width,
            last_open_workspace_id: self.last_open_workspace_id.map(|id| id.0),
            workspace_chat_scroll_y10: self
                .workspace_chat_scroll_y10
                .iter()
                .map(|(id, offset_y10)| (id.0, *offset_y10))
                .collect(),
        }
    }

    pub fn project(&self, project_id: ProjectId) -> Option<&Project> {
        self.projects.iter().find(|p| p.id == project_id)
    }

    pub fn workspace(&self, workspace_id: WorkspaceId) -> Option<&Workspace> {
        self.projects
            .iter()
            .flat_map(|p| &p.workspaces)
            .find(|w| w.id == workspace_id)
    }

    pub fn workspace_conversation(
        &self,
        workspace_id: WorkspaceId,
    ) -> Option<&WorkspaceConversation> {
        self.conversations.get(&workspace_id)
    }

    fn add_project(&mut self, path: PathBuf) -> ProjectId {
        let id = ProjectId(self.next_project_id);
        self.next_project_id += 1;

        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("project")
            .to_owned();

        let slug = self.unique_project_slug(sanitize_slug(&name));

        self.projects.push(Project {
            id,
            name,
            path,
            slug,
            expanded: false,
            create_workspace_status: OperationStatus::Idle,
            workspaces: Vec::new(),
        });

        id
    }

    fn insert_main_workspace(&mut self, project_id: ProjectId) -> WorkspaceId {
        let workspace_id = WorkspaceId(self.next_workspace_id);
        self.next_workspace_id += 1;

        let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) else {
            return workspace_id;
        };

        project.workspaces.push(Workspace {
            id: workspace_id,
            workspace_name: Self::MAIN_WORKSPACE_NAME.to_owned(),
            branch_name: Self::MAIN_WORKSPACE_BRANCH.to_owned(),
            worktree_path: project.path.clone(),
            status: WorkspaceStatus::Active,
            last_activity_at: None,
            archive_status: OperationStatus::Idle,
        });

        workspace_id
    }

    fn ensure_main_workspaces(&mut self) -> bool {
        let mut upgraded = false;

        let project_ids: Vec<ProjectId> = self.projects.iter().map(|p| p.id).collect();
        for project_id in project_ids {
            let has_main = self
                .projects
                .iter()
                .find(|p| p.id == project_id)
                .map(|project| {
                    project.workspaces.iter().any(|w| {
                        w.status == WorkspaceStatus::Active && w.worktree_path == project.path
                    })
                })
                .unwrap_or(false);
            if has_main {
                continue;
            }

            self.insert_main_workspace(project_id);
            upgraded = true;
        }

        upgraded
    }

    fn workspace_is_main(project: &Project, workspace: &Workspace) -> bool {
        workspace.worktree_path == project.path
    }

    fn insert_workspace(
        &mut self,
        project_id: ProjectId,
        workspace_name: &str,
        branch_name: &str,
        worktree_path: PathBuf,
    ) -> WorkspaceId {
        let workspace_id = WorkspaceId(self.next_workspace_id);
        self.next_workspace_id += 1;

        if let Some(project) = self.projects.iter_mut().find(|p| p.id == project_id) {
            project.workspaces.push(Workspace {
                id: workspace_id,
                workspace_name: workspace_name.to_owned(),
                branch_name: branch_name.to_owned(),
                worktree_path,
                status: WorkspaceStatus::Active,
                last_activity_at: None,
                archive_status: OperationStatus::Idle,
            });
            project.expanded = true;
            self.main_pane = MainPane::Workspace(workspace_id);
        }

        workspace_id
    }

    fn find_workspace_indices(&self, workspace_id: WorkspaceId) -> Option<(usize, usize)> {
        for (project_idx, project) in self.projects.iter().enumerate() {
            if let Some(workspace_idx) = project
                .workspaces
                .iter()
                .position(|w| w.id == workspace_id && w.status == WorkspaceStatus::Active)
            {
                return Some((project_idx, workspace_idx));
            }
        }
        None
    }

    fn unique_project_slug(&self, base: String) -> String {
        if !self.projects.iter().any(|p| p.slug == base) {
            return base;
        }

        for i in 2.. {
            let candidate = format!("{base}-{i}");
            if !self.projects.iter().any(|p| p.slug == candidate) {
                return candidate;
            }
        }

        unreachable!("infinite iterator");
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

fn codex_item_id(item: &CodexThreadItem) -> &str {
    match item {
        CodexThreadItem::AgentMessage { id, .. } => id,
        CodexThreadItem::Reasoning { id, .. } => id,
        CodexThreadItem::CommandExecution { id, .. } => id,
        CodexThreadItem::FileChange { id, .. } => id,
        CodexThreadItem::McpToolCall { id, .. } => id,
        CodexThreadItem::WebSearch { id, .. } => id,
        CodexThreadItem::TodoList { id, .. } => id,
        CodexThreadItem::Error { id, .. } => id,
    }
}

fn sanitize_slug(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_dash = false;

    for ch in input.chars() {
        let mapped = match ch {
            'a'..='z' | '0'..='9' => Some(ch),
            'A'..='Z' => Some(ch.to_ascii_lowercase()),
            _ => None,
        };

        match mapped {
            Some(ch) => {
                out.push(ch);
                prev_dash = false;
            }
            None => {
                if !prev_dash && !out.is_empty() {
                    out.push('-');
                    prev_dash = true;
                }
            }
        }
    }

    while out.ends_with('-') {
        out.pop();
    }

    if out.is_empty() {
        "project".to_owned()
    } else {
        out
    }
}

fn start_next_queued_prompt(
    conversation: &mut WorkspaceConversation,
    workspace_id: WorkspaceId,
) -> Option<Effect> {
    if conversation.queue_paused || conversation.run_status != OperationStatus::Idle {
        return None;
    }

    let queued = conversation.pending_prompts.pop_front()?;

    conversation.entries.push(ConversationEntry::UserMessage {
        text: queued.text.clone(),
    });
    conversation.run_status = OperationStatus::Running;
    conversation.in_progress_items.clear();
    conversation.in_progress_order.clear();
    Some(Effect::RunAgentTurn {
        workspace_id,
        text: queued.text,
        run_config: queued.run_config,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn main_workspace_id(state: &AppState) -> WorkspaceId {
        let project = &state.projects[0];
        project
            .workspaces
            .iter()
            .find(|w| w.status == WorkspaceStatus::Active && w.worktree_path == project.path)
            .expect("missing main workspace")
            .id
    }

    fn workspace_id_by_name(state: &AppState, name: &str) -> WorkspaceId {
        state.projects[0]
            .workspaces
            .iter()
            .find(|w| w.status == WorkspaceStatus::Active && w.workspace_name == name)
            .unwrap_or_else(|| panic!("missing workspace {name}"))
            .id
    }

    fn first_non_main_workspace_id(state: &AppState) -> WorkspaceId {
        let project = &state.projects[0];
        project
            .workspaces
            .iter()
            .find(|w| w.status == WorkspaceStatus::Active && w.worktree_path != project.path)
            .expect("missing non-main workspace")
            .id
    }

    #[test]
    fn open_dashboard_loads_conversations_for_non_main_workspaces() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w1".to_owned(),
            branch_name: "repo/w1".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w1"),
        });

        let main_id = main_workspace_id(&state);
        let w1 = workspace_id_by_name(&state, "w1");

        let effects = state.apply(Action::OpenDashboard);
        assert_eq!(state.main_pane, MainPane::Dashboard);
        assert_eq!(state.right_pane, RightPane::None);
        assert_eq!(state.dashboard_preview_workspace_id, None);

        assert!(
            effects.iter().any(
                |e| matches!(e, Effect::LoadConversation { workspace_id } if *workspace_id == w1)
            ),
            "expected dashboard to load non-main workspace conversation"
        );
        assert!(
            !effects.iter().any(|e| matches!(e, Effect::LoadConversation { workspace_id } if *workspace_id == main_id)),
            "dashboard should not load main workspace conversation"
        );
    }

    #[test]
    fn right_pane_tracks_selected_main_pane() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w1".to_owned(),
            branch_name: "repo/w1".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w1"),
        });
        let workspace_id = workspace_id_by_name(&state, "w1");

        state.apply(Action::OpenWorkspace { workspace_id });
        assert_eq!(state.right_pane, RightPane::Terminal);

        state.apply(Action::OpenProjectSettings { project_id });
        assert_eq!(state.right_pane, RightPane::None);
    }

    #[test]
    fn toggle_terminal_pane_hides_and_shows_when_workspace_open() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w1".to_owned(),
            branch_name: "repo/w1".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w1"),
        });
        let workspace_id = workspace_id_by_name(&state, "w1");
        state.apply(Action::OpenWorkspace { workspace_id });

        assert_eq!(state.right_pane, RightPane::Terminal);

        state.apply(Action::ToggleTerminalPane);
        assert_eq!(state.right_pane, RightPane::None);

        state.apply(Action::ToggleTerminalPane);
        assert_eq!(state.right_pane, RightPane::Terminal);
    }

    #[test]
    fn toggle_terminal_pane_is_disabled_outside_workspace() {
        let mut state = AppState::new();
        state.apply(Action::ToggleTerminalPane);
        assert_eq!(state.right_pane, RightPane::None);

        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::OpenProjectSettings { project_id });
        state.apply(Action::ToggleTerminalPane);
        assert_eq!(state.right_pane, RightPane::None);
    }

    #[test]
    fn terminal_pane_width_is_persisted() {
        let mut state = AppState::new();
        let effects = state.apply(Action::TerminalPaneWidthChanged { width: 360 });
        assert_eq!(state.terminal_pane_width, Some(360));
        assert_eq!(effects.len(), 1);
        assert!(matches!(effects[0], Effect::SaveAppState));

        let persisted = state.to_persisted();
        assert_eq!(persisted.sidebar_width, None);
        assert_eq!(persisted.terminal_pane_width, Some(360));

        let mut state = AppState::new();
        state.apply(Action::AppStateLoaded {
            persisted: PersistedAppState {
                projects: Vec::new(),
                sidebar_width: None,
                terminal_pane_width: Some(480),
                last_open_workspace_id: None,
                workspace_chat_scroll_y10: HashMap::new(),
            },
        });
        assert_eq!(state.terminal_pane_width, Some(480));
    }

    #[test]
    fn sidebar_width_is_persisted() {
        let mut state = AppState::new();
        let effects = state.apply(Action::SidebarWidthChanged { width: 280 });
        assert_eq!(state.sidebar_width, Some(280));
        assert_eq!(effects.len(), 1);
        assert!(matches!(effects[0], Effect::SaveAppState));

        let persisted = state.to_persisted();
        assert_eq!(persisted.sidebar_width, Some(280));

        let mut state = AppState::new();
        state.apply(Action::AppStateLoaded {
            persisted: PersistedAppState {
                projects: Vec::new(),
                sidebar_width: Some(360),
                terminal_pane_width: None,
                last_open_workspace_id: None,
                workspace_chat_scroll_y10: HashMap::new(),
            },
        });
        assert_eq!(state.sidebar_width, Some(360));
    }

    #[test]
    fn workspace_chat_scroll_is_persisted() {
        let mut state = AppState::new();
        let workspace_id = WorkspaceId(42);

        let effects = state.apply(Action::WorkspaceChatScrollSaved {
            workspace_id,
            offset_y10: -1234,
        });
        assert_eq!(
            state.workspace_chat_scroll_y10.get(&workspace_id).copied(),
            Some(-1234)
        );
        assert_eq!(effects.len(), 1);
        assert!(matches!(effects[0], Effect::SaveAppState));

        let persisted = state.to_persisted();
        assert_eq!(
            persisted.workspace_chat_scroll_y10.get(&42).copied(),
            Some(-1234)
        );

        let mut loaded = AppState::new();
        loaded.apply(Action::AppStateLoaded { persisted });
        assert_eq!(
            loaded.workspace_chat_scroll_y10.get(&workspace_id).copied(),
            Some(-1234)
        );
    }

    #[test]
    fn project_expanded_is_persisted() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;

        let effects = state.apply(Action::ToggleProjectExpanded { project_id });
        assert_eq!(effects.len(), 1);
        assert!(matches!(effects[0], Effect::SaveAppState));
        assert!(state.projects[0].expanded);

        let persisted = state.to_persisted();
        assert_eq!(persisted.projects.len(), 1);
        assert!(persisted.projects[0].expanded);

        let mut loaded = AppState::new();
        loaded.apply(Action::AppStateLoaded { persisted });
        assert!(loaded.projects[0].expanded);
    }

    #[test]
    fn in_progress_order_tracks_started_items_and_removes_on_complete() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "luban/abandon-about".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Test".to_owned(),
        });
        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::ItemStarted {
                item: CodexThreadItem::Reasoning {
                    id: "r-1".to_owned(),
                    text: "x".to_owned(),
                },
            },
        });
        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::ItemStarted {
                item: CodexThreadItem::CommandExecution {
                    id: "c-1".to_owned(),
                    command: "echo hello".to_owned(),
                    aggregated_output: String::new(),
                    exit_code: None,
                    status: CodexCommandExecutionStatus::InProgress,
                },
            },
        });

        let conversation = state
            .workspace_conversation(workspace_id)
            .expect("missing conversation");
        assert_eq!(
            conversation
                .in_progress_order
                .iter()
                .cloned()
                .collect::<Vec<_>>(),
            vec!["r-1".to_owned(), "c-1".to_owned()]
        );

        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::ItemCompleted {
                item: CodexThreadItem::Reasoning {
                    id: "r-1".to_owned(),
                    text: "done".to_owned(),
                },
            },
        });

        let conversation = state
            .workspace_conversation(workspace_id)
            .expect("missing conversation");
        assert_eq!(
            conversation
                .in_progress_order
                .iter()
                .cloned()
                .collect::<Vec<_>>(),
            vec!["c-1".to_owned()]
        );
        assert!(!conversation.in_progress_items.contains_key("r-1"));
    }

    #[test]
    fn app_started_emits_load_app_state_effect() {
        let mut state = AppState::new();
        let effects = state.apply(Action::AppStarted);
        assert_eq!(effects.len(), 1);
        assert!(matches!(effects[0], Effect::LoadAppState));
    }

    #[test]
    fn add_project_emits_save_app_state_effect() {
        let mut state = AppState::new();
        let effects = state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        assert_eq!(effects.len(), 1);
        assert!(matches!(effects[0], Effect::SaveAppState));
    }

    #[test]
    fn main_workspace_cannot_be_archived() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });

        let workspace_id = main_workspace_id(&state);
        let effects = state.apply(Action::ArchiveWorkspace { workspace_id });
        assert!(effects.is_empty());

        let project = &state.projects[0];
        let workspace = project
            .workspaces
            .iter()
            .find(|w| w.id == workspace_id)
            .expect("missing main workspace after archive attempt");
        assert_eq!(workspace.archive_status, OperationStatus::Idle);
        assert_eq!(workspace.status, WorkspaceStatus::Active);
        assert_eq!(workspace.worktree_path, project.path);
    }

    #[test]
    fn demo_state_is_consistent() {
        let state = AppState::demo();

        assert!(!state.projects.is_empty());
    }

    #[test]
    fn project_slug_is_sanitized_and_unique() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/My Project"),
        });
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/My Project"),
        });

        assert_eq!(state.projects.len(), 2);
        assert_eq!(state.projects[0].slug, "my-project");
        assert_eq!(state.projects[1].slug, "my-project-2");
    }

    #[test]
    fn create_workspace_sets_busy_and_emits_effect() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;

        let effects = state.apply(Action::CreateWorkspace { project_id });
        assert_eq!(effects.len(), 1);
        assert!(matches!(effects[0], Effect::CreateWorkspace { .. }));

        let project = state.project(project_id).unwrap();
        assert_eq!(project.create_workspace_status, OperationStatus::Running);
    }

    #[test]
    fn open_workspace_emits_conversation_load_effect() {
        let mut state = AppState::demo();
        let workspace_id = first_non_main_workspace_id(&state);

        let effects = state.apply(Action::OpenWorkspace { workspace_id });
        assert_eq!(effects.len(), 2);
        assert!(matches!(effects[0], Effect::SaveAppState));
        assert!(matches!(effects[1], Effect::LoadConversation { .. }));
    }

    #[test]
    fn app_state_restores_last_open_workspace() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "luban/abandon-about".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");
        state.apply(Action::OpenWorkspace { workspace_id });

        let persisted = state.to_persisted();
        assert_eq!(persisted.last_open_workspace_id, Some(workspace_id.0));

        let mut loaded = AppState::new();
        let effects = loaded.apply(Action::AppStateLoaded { persisted });

        assert!(
            matches!(loaded.main_pane, MainPane::Workspace(id) if id == workspace_id),
            "expected main pane to restore workspace"
        );
        assert_eq!(loaded.right_pane, RightPane::Terminal);
        assert_eq!(effects.len(), 1);
        assert!(matches!(
            effects[0],
            Effect::LoadConversation {
                workspace_id: id
            } if id == workspace_id
        ));
    }

    #[test]
    fn chat_drafts_are_isolated_and_preserved_on_reload() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;

        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w1".to_owned(),
            branch_name: "repo/w1".to_owned(),
            worktree_path: PathBuf::from("/tmp/repo/worktrees/w1"),
        });
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w2".to_owned(),
            branch_name: "repo/w2".to_owned(),
            worktree_path: PathBuf::from("/tmp/repo/worktrees/w2"),
        });

        let w1 = workspace_id_by_name(&state, "w1");
        let w2 = workspace_id_by_name(&state, "w2");

        state.apply(Action::ChatDraftChanged {
            workspace_id: w1,
            text: "draft-1".to_owned(),
        });
        state.apply(Action::ChatDraftChanged {
            workspace_id: w2,
            text: "draft-2".to_owned(),
        });

        assert_eq!(state.workspace_conversation(w1).unwrap().draft, "draft-1");
        assert_eq!(state.workspace_conversation(w2).unwrap().draft, "draft-2");

        state.apply(Action::ConversationLoaded {
            workspace_id: w1,
            snapshot: ConversationSnapshot {
                thread_id: None,
                entries: Vec::new(),
            },
        });
        assert_eq!(state.workspace_conversation(w1).unwrap().draft, "draft-1");
    }

    #[test]
    fn conversation_loaded_does_not_reset_running_turn_state() {
        let mut state = AppState::demo();
        let workspace_id = first_non_main_workspace_id(&state);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Hello".to_owned(),
        });

        let item = CodexThreadItem::AgentMessage {
            id: "item_0".to_owned(),
            text: "Hi".to_owned(),
        };
        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::ItemStarted { item },
        });

        assert_eq!(
            state
                .workspace_conversation(workspace_id)
                .unwrap()
                .run_status,
            OperationStatus::Running
        );
        assert_eq!(
            state
                .workspace_conversation(workspace_id)
                .unwrap()
                .in_progress_items
                .len(),
            1
        );

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread_0".to_owned()),
                entries: Vec::new(),
            },
        });

        let conversation = state.workspace_conversation(workspace_id).unwrap();
        assert_eq!(conversation.run_status, OperationStatus::Running);
        assert_eq!(conversation.in_progress_items.len(), 1);
        assert_eq!(conversation.entries.len(), 1);
        assert!(matches!(
            &conversation.entries[0],
            ConversationEntry::UserMessage { text } if text == "Hello"
        ));
        assert_eq!(conversation.thread_id.as_deref(), Some("thread_0"));
    }

    #[test]
    fn conversation_loaded_does_not_overwrite_newer_local_entries() {
        let mut state = AppState::demo();
        let workspace_id = first_non_main_workspace_id(&state);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Hello".to_owned(),
        });
        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::TurnDuration { duration_ms: 1234 },
        });

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: None,
                entries: vec![ConversationEntry::UserMessage {
                    text: "Hello".to_owned(),
                }],
            },
        });

        let after = &state.workspace_conversation(workspace_id).unwrap().entries;
        assert_eq!(after.len(), 2);
        assert!(matches!(
            &after[0],
            ConversationEntry::UserMessage { text } if text == "Hello"
        ));
        assert!(matches!(
            &after[1],
            ConversationEntry::TurnDuration { duration_ms: 1234 }
        ));
    }

    #[test]
    fn conversation_loaded_replaces_entries_when_snapshot_is_newer() {
        let mut state = AppState::demo();
        let workspace_id = first_non_main_workspace_id(&state);

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: None,
                entries: vec![ConversationEntry::UserMessage {
                    text: "Hello".to_owned(),
                }],
            },
        });

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: None,
                entries: vec![
                    ConversationEntry::UserMessage {
                        text: "Hello".to_owned(),
                    },
                    ConversationEntry::TurnDuration { duration_ms: 1234 },
                ],
            },
        });

        let after = &state.workspace_conversation(workspace_id).unwrap().entries;
        assert!(matches!(
            &after[..],
            [
                ConversationEntry::UserMessage { .. },
                ConversationEntry::TurnDuration { duration_ms: 1234 }
            ]
        ));
    }

    #[test]
    fn send_agent_message_sets_running_and_emits_effect() {
        let mut state = AppState::demo();
        let workspace_id = first_non_main_workspace_id(&state);

        let effects = state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Hello".to_owned(),
        });
        assert_eq!(effects.len(), 1);
        assert!(matches!(
            &effects[0],
            Effect::RunAgentTurn {
                workspace_id: wid,
                text,
                run_config
            } if *wid == workspace_id
                && text == "Hello"
                && run_config.model_id == default_agent_model_id()
                && run_config.thinking_effort == default_thinking_effort()
        ));

        let conversation = state.workspace_conversation(workspace_id).unwrap();
        assert_eq!(conversation.run_status, OperationStatus::Running);
        assert_eq!(conversation.entries.len(), 1);
        assert!(matches!(
            &conversation.entries[0],
            ConversationEntry::UserMessage { text } if text == "Hello"
        ));
    }

    #[test]
    fn agent_item_completed_is_idempotent() {
        let mut state = AppState::demo();
        let workspace_id = first_non_main_workspace_id(&state);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Hello".to_owned(),
        });

        let item = CodexThreadItem::AgentMessage {
            id: "item_0".to_owned(),
            text: "Hi".to_owned(),
        };

        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::ItemCompleted { item: item.clone() },
        });
        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::ItemCompleted { item },
        });

        let conversation = state.workspace_conversation(workspace_id).unwrap();
        let completed_items = conversation
            .entries
            .iter()
            .filter(|e| matches!(e, ConversationEntry::CodexItem { .. }))
            .count();
        assert_eq!(completed_items, 1);
    }

    #[test]
    fn agent_item_completed_is_idempotent_even_if_not_last_entry() {
        let mut state = AppState::demo();
        let workspace_id = first_non_main_workspace_id(&state);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Hello".to_owned(),
        });

        let item = CodexThreadItem::AgentMessage {
            id: "item_0".to_owned(),
            text: "Hi".to_owned(),
        };

        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::ItemCompleted { item: item.clone() },
        });
        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::TurnDuration { duration_ms: 1000 },
        });
        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::ItemCompleted { item },
        });

        let conversation = state.workspace_conversation(workspace_id).unwrap();
        let completed_items = conversation
            .entries
            .iter()
            .filter(|e| matches!(e, ConversationEntry::CodexItem { .. }))
            .count();
        assert_eq!(completed_items, 1);
    }

    #[test]
    fn cancel_agent_turn_sets_idle_and_emits_effect() {
        let mut state = AppState::demo();
        let workspace_id = first_non_main_workspace_id(&state);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Hello".to_owned(),
        });

        let effects = state.apply(Action::CancelAgentTurn { workspace_id });
        assert_eq!(effects.len(), 1);
        assert!(matches!(effects[0], Effect::CancelAgentTurn { .. }));

        let conversation = state.workspace_conversation(workspace_id).unwrap();
        assert_eq!(conversation.run_status, OperationStatus::Idle);
        assert!(conversation.in_progress_items.is_empty());
        assert!(matches!(
            conversation.entries.last(),
            Some(ConversationEntry::TurnCanceled)
        ));
    }

    #[test]
    fn send_agent_message_while_running_is_queued() {
        let mut state = AppState::demo();
        let workspace_id = first_non_main_workspace_id(&state);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "First".to_owned(),
        });
        let effects = state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Second".to_owned(),
        });
        assert!(effects.is_empty());

        let conversation = state.workspace_conversation(workspace_id).unwrap();
        assert_eq!(conversation.entries.len(), 1);
        assert_eq!(conversation.pending_prompts.len(), 1);
        assert_eq!(conversation.pending_prompts[0].text, "Second");
        assert_eq!(conversation.run_status, OperationStatus::Running);
    }

    #[test]
    fn completed_turn_auto_sends_next_queued_prompt() {
        let mut state = AppState::demo();
        let workspace_id = first_non_main_workspace_id(&state);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "First".to_owned(),
        });
        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Second".to_owned(),
        });

        let effects = state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::TurnCompleted {
                usage: CodexUsage {
                    input_tokens: 0,
                    cached_input_tokens: 0,
                    output_tokens: 0,
                },
            },
        });
        assert_eq!(effects.len(), 1);
        assert!(matches!(
            &effects[0],
            Effect::RunAgentTurn {
                workspace_id: wid,
                text,
                run_config
            } if *wid == workspace_id
                && text == "Second"
                && run_config.model_id == default_agent_model_id()
                && run_config.thinking_effort == default_thinking_effort()
        ));

        let conversation = state.workspace_conversation(workspace_id).unwrap();
        assert_eq!(conversation.run_status, OperationStatus::Running);
        assert!(conversation.pending_prompts.is_empty());
        assert!(matches!(
            &conversation.entries[0],
            ConversationEntry::UserMessage { text } if text == "First"
        ));
        assert!(matches!(
            &conversation.entries[1],
            ConversationEntry::UserMessage { text } if text == "Second"
        ));
    }

    #[test]
    fn failed_turn_pauses_queue_until_resumed() {
        let mut state = AppState::demo();
        let workspace_id = first_non_main_workspace_id(&state);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "First".to_owned(),
        });
        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Second".to_owned(),
        });

        let effects = state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::TurnFailed {
                error: CodexThreadError {
                    message: "boom".to_owned(),
                },
            },
        });
        assert!(effects.is_empty());

        let conversation = state.workspace_conversation(workspace_id).unwrap();
        assert_eq!(conversation.run_status, OperationStatus::Idle);
        assert_eq!(conversation.pending_prompts.len(), 1);
        assert!(conversation.queue_paused);

        let effects = state.apply(Action::ResumeQueuedPrompts { workspace_id });
        assert_eq!(effects.len(), 1);
        assert!(matches!(
            &effects[0],
            Effect::RunAgentTurn {
                workspace_id: wid,
                text,
                run_config
            } if *wid == workspace_id
                && text == "Second"
                && run_config.model_id == default_agent_model_id()
                && run_config.thinking_effort == default_thinking_effort()
        ));
    }

    #[test]
    fn open_workspace_in_ide_emits_effect_for_existing_workspace() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "luban/abandon-about".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");

        let effects = state.apply(Action::OpenWorkspaceInIde { workspace_id });
        assert!(
            matches!(
                effects.as_slice(),
                [Effect::OpenWorkspaceInIde {
                    workspace_id: effect_workspace_id
                }] if *effect_workspace_id == workspace_id
            ),
            "unexpected effects: {effects:?}"
        );
    }

    #[test]
    fn open_workspace_in_ide_sets_error_when_workspace_missing() {
        let mut state = AppState::new();
        let effects = state.apply(Action::OpenWorkspaceInIde {
            workspace_id: WorkspaceId(1),
        });
        assert!(effects.is_empty());
        assert_eq!(state.last_error.as_deref(), Some("Workspace not found"));
    }
}
