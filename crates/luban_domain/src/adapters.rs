use crate::{
    AttachmentRef, CodexThreadEvent, ContextItem, ConversationSnapshot, ConversationThreadMeta,
    PersistedAppState,
};
use std::collections::HashMap;
use std::{path::PathBuf, sync::Arc, sync::atomic::AtomicBool};

#[derive(Clone, Debug)]
pub struct ContextImage {
    pub extension: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PullRequestState {
    Open,
    Closed,
    Merged,
}

impl PullRequestState {
    pub fn is_finished(self) -> bool {
        matches!(self, Self::Closed | Self::Merged)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PullRequestCiState {
    Pending,
    Success,
    Failure,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PullRequestInfo {
    pub number: u64,
    pub is_draft: bool,
    pub state: PullRequestState,
    pub ci_state: Option<PullRequestCiState>,
    pub merge_ready: bool,
}

#[derive(Clone, Debug)]
pub struct CreatedWorkspace {
    pub workspace_name: String,
    pub branch_name: String,
    pub worktree_path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct RunAgentTurnRequest {
    pub project_slug: String,
    pub workspace_name: String,
    pub worktree_path: PathBuf,
    pub thread_local_id: u64,
    pub thread_id: Option<String>,
    pub prompt: String,
    pub attachments: Vec<AttachmentRef>,
    pub model: Option<String>,
    pub model_reasoning_effort: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum TaskIntentKind {
    Fix,
    Implement,
    Review,
    Discuss,
    Other,
}

impl TaskIntentKind {
    pub const ALL: [TaskIntentKind; 5] = [
        TaskIntentKind::Fix,
        TaskIntentKind::Implement,
        TaskIntentKind::Review,
        TaskIntentKind::Discuss,
        TaskIntentKind::Other,
    ];

    pub fn as_key(self) -> &'static str {
        match self {
            TaskIntentKind::Fix => "fix",
            TaskIntentKind::Implement => "implement",
            TaskIntentKind::Review => "review",
            TaskIntentKind::Discuss => "discuss",
            TaskIntentKind::Other => "other",
        }
    }

    pub fn parse_key(raw: &str) -> TaskIntentKind {
        match raw.trim().to_ascii_lowercase().as_str() {
            "fix" | "fix_issue" => TaskIntentKind::Fix,
            "implement" | "implement_feature" => TaskIntentKind::Implement,
            "review" | "review_pull_request" => TaskIntentKind::Review,
            "discuss" => TaskIntentKind::Discuss,
            _ => TaskIntentKind::Other,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            TaskIntentKind::Fix => "Fix",
            TaskIntentKind::Implement => "Implement",
            TaskIntentKind::Review => "Review",
            TaskIntentKind::Discuss => "Discuss",
            TaskIntentKind::Other => "Other",
        }
    }
}

#[derive(Clone, Debug)]
pub struct TaskRepoInfo {
    pub full_name: String,
    pub url: String,
    pub default_branch: Option<String>,
}

#[derive(Clone, Debug)]
pub struct TaskIssueInfo {
    pub number: u64,
    pub title: String,
    pub url: String,
}

#[derive(Clone, Debug)]
pub struct TaskPullRequestInfo {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub head_ref: Option<String>,
    pub base_ref: Option<String>,
    pub mergeable: Option<String>,
}

#[derive(Clone, Debug)]
pub enum TaskProjectSpec {
    Unspecified,
    LocalPath { path: PathBuf },
    GitHubRepo { full_name: String },
}

#[derive(Clone, Debug)]
pub struct TaskDraft {
    pub input: String,
    pub project: TaskProjectSpec,
    pub intent_kind: TaskIntentKind,
    pub summary: String,
    pub prompt: String,
    pub repo: Option<TaskRepoInfo>,
    pub issue: Option<TaskIssueInfo>,
    pub pull_request: Option<TaskPullRequestInfo>,
}

#[derive(Clone, Debug)]
pub struct ProjectIdentity {
    pub root_path: PathBuf,
    pub github_repo: Option<String>,
    pub is_git: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CodexConfigEntryKind {
    File,
    Folder,
}

#[derive(Clone, Debug)]
pub struct CodexConfigEntry {
    pub path: String,
    pub name: String,
    pub kind: CodexConfigEntryKind,
    pub children: Vec<CodexConfigEntry>,
}

pub trait ProjectWorkspaceService: Send + Sync {
    fn load_app_state(&self) -> Result<PersistedAppState, String>;

    fn save_app_state(&self, snapshot: PersistedAppState) -> Result<(), String>;

    fn create_workspace(
        &self,
        project_path: PathBuf,
        project_slug: String,
    ) -> Result<CreatedWorkspace, String>;

    fn open_workspace_in_ide(&self, worktree_path: PathBuf) -> Result<(), String>;

    fn archive_workspace(
        &self,
        project_path: PathBuf,
        worktree_path: PathBuf,
    ) -> Result<(), String>;

    fn ensure_conversation(
        &self,
        project_slug: String,
        workspace_name: String,
        thread_id: u64,
    ) -> Result<(), String>;

    fn list_conversation_threads(
        &self,
        project_slug: String,
        workspace_name: String,
    ) -> Result<Vec<ConversationThreadMeta>, String>;

    fn load_conversation(
        &self,
        project_slug: String,
        workspace_name: String,
        thread_id: u64,
    ) -> Result<ConversationSnapshot, String>;

    fn store_context_image(
        &self,
        project_slug: String,
        workspace_name: String,
        image: ContextImage,
    ) -> Result<AttachmentRef, String>;

    fn store_context_text(
        &self,
        project_slug: String,
        workspace_name: String,
        text: String,
        extension: String,
    ) -> Result<AttachmentRef, String>;

    fn store_context_file(
        &self,
        project_slug: String,
        workspace_name: String,
        source_path: PathBuf,
    ) -> Result<AttachmentRef, String>;

    fn record_context_item(
        &self,
        project_slug: String,
        workspace_name: String,
        attachment: AttachmentRef,
        created_at_unix_ms: u64,
    ) -> Result<u64, String>;

    fn list_context_items(
        &self,
        project_slug: String,
        workspace_name: String,
    ) -> Result<Vec<ContextItem>, String>;

    fn delete_context_item(
        &self,
        project_slug: String,
        workspace_name: String,
        context_id: u64,
    ) -> Result<(), String>;

    fn run_agent_turn_streamed(
        &self,
        request: RunAgentTurnRequest,
        cancel: Arc<AtomicBool>,
        on_event: Arc<dyn Fn(CodexThreadEvent) + Send + Sync>,
    ) -> Result<(), String>;

    fn gh_is_authorized(&self) -> Result<bool, String>;

    fn gh_pull_request_info(
        &self,
        worktree_path: PathBuf,
    ) -> Result<Option<PullRequestInfo>, String>;

    fn gh_open_pull_request(&self, worktree_path: PathBuf) -> Result<(), String>;

    fn gh_open_pull_request_failed_action(&self, worktree_path: PathBuf) -> Result<(), String>;

    fn task_preview(&self, input: String) -> Result<TaskDraft, String>;

    fn task_prepare_project(&self, spec: TaskProjectSpec) -> Result<PathBuf, String>;

    fn task_prompt_templates_load(&self) -> Result<HashMap<TaskIntentKind, String>, String> {
        Ok(HashMap::new())
    }

    fn task_prompt_template_store(
        &self,
        _intent_kind: TaskIntentKind,
        _template: String,
    ) -> Result<(), String> {
        Ok(())
    }

    fn task_prompt_template_delete(&self, _intent_kind: TaskIntentKind) -> Result<(), String> {
        Ok(())
    }

    fn codex_check(&self) -> Result<(), String> {
        Err("unimplemented".to_owned())
    }

    fn codex_config_tree(&self) -> Result<Vec<CodexConfigEntry>, String> {
        Err("unimplemented".to_owned())
    }

    fn codex_config_read_file(&self, _path: String) -> Result<String, String> {
        Err("unimplemented".to_owned())
    }

    fn codex_config_write_file(&self, _path: String, _contents: String) -> Result<(), String> {
        Err("unimplemented".to_owned())
    }

    fn project_identity(&self, path: PathBuf) -> Result<ProjectIdentity, String> {
        Ok(ProjectIdentity {
            root_path: path,
            github_repo: None,
            is_git: false,
        })
    }
}
