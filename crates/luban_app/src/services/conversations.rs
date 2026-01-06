use super::GitWorkspaceService;
use anyhow::Context as _;
use luban_domain::{ConversationEntry, ConversationSnapshot, PersistedAppState};
use std::{
    io::{BufRead as _, BufReader},
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct ConversationMeta {
    version: u32,
    thread_id: Option<String>,
    created_at: u64,
    updated_at: u64,
}

impl GitWorkspaceService {
    pub(super) fn conversation_dir(&self, project_slug: &str, workspace_name: &str) -> PathBuf {
        let mut path = self.conversations_root.clone();
        path.push(project_slug);
        path.push(workspace_name);
        path
    }

    pub(super) fn conversation_meta_path(
        &self,
        project_slug: &str,
        workspace_name: &str,
    ) -> PathBuf {
        self.conversation_dir(project_slug, workspace_name)
            .join("conversation.json")
    }

    pub(super) fn conversation_events_path(
        &self,
        project_slug: &str,
        workspace_name: &str,
    ) -> PathBuf {
        self.conversation_dir(project_slug, workspace_name)
            .join("events.jsonl")
    }

    pub(super) fn now_unix_seconds() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    fn read_conversation_meta_legacy(
        &self,
        project_slug: &str,
        workspace_name: &str,
    ) -> anyhow::Result<ConversationMeta> {
        let path = self.conversation_meta_path(project_slug, workspace_name);
        let content =
            std::fs::read(&path).with_context(|| format!("failed to read {}", path.display()))?;
        serde_json::from_slice(&content).context("failed to parse conversation meta")
    }

    pub(super) fn load_conversation_legacy(
        &self,
        project_slug: &str,
        workspace_name: &str,
    ) -> anyhow::Result<Option<ConversationSnapshot>> {
        let meta_path = self.conversation_meta_path(project_slug, workspace_name);
        let events_path = self.conversation_events_path(project_slug, workspace_name);
        if !meta_path.exists() && !events_path.exists() {
            return Ok(None);
        }

        let meta = if meta_path.exists() {
            self.read_conversation_meta_legacy(project_slug, workspace_name)?
        } else {
            ConversationMeta {
                version: 1,
                thread_id: None,
                created_at: Self::now_unix_seconds(),
                updated_at: Self::now_unix_seconds(),
            }
        };

        if !events_path.exists() {
            return Ok(Some(ConversationSnapshot {
                thread_id: meta.thread_id,
                entries: Vec::new(),
            }));
        }

        let file = std::fs::File::open(&events_path)
            .with_context(|| format!("failed to open {}", events_path.display()))?;
        let reader = BufReader::new(file);

        let mut entries = Vec::new();
        for line in reader.lines() {
            let line = line.context("failed to read line")?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let entry: ConversationEntry =
                serde_json::from_str(trimmed).context("failed to parse entry")?;
            if matches!(entry, ConversationEntry::TurnUsage { .. }) {
                continue;
            }
            let is_duplicate = match (&entry, entries.last()) {
                (
                    ConversationEntry::CodexItem { item },
                    Some(ConversationEntry::CodexItem { item: prev }),
                ) => super::codex_item_id(item) == super::codex_item_id(prev),
                _ => false,
            };
            if !is_duplicate {
                entries.push(entry);
            }
        }

        Ok(Some(ConversationSnapshot {
            thread_id: meta.thread_id,
            entries,
        }))
    }

    pub(super) fn load_app_state_internal(&self) -> anyhow::Result<PersistedAppState> {
        self.sqlite.load_app_state()
    }

    pub(super) fn save_app_state_internal(
        &self,
        snapshot: PersistedAppState,
    ) -> anyhow::Result<()> {
        self.sqlite.save_app_state(snapshot)
    }

    pub(super) fn ensure_conversation_internal(
        &self,
        project_slug: String,
        workspace_name: String,
        thread_id: u64,
    ) -> anyhow::Result<()> {
        self.sqlite
            .ensure_conversation(project_slug, workspace_name, thread_id)
    }

    pub(super) fn load_conversation_internal(
        &self,
        project_slug: String,
        workspace_name: String,
        thread_id: u64,
    ) -> anyhow::Result<ConversationSnapshot> {
        let snapshot = self.sqlite.load_conversation(
            project_slug.clone(),
            workspace_name.clone(),
            thread_id,
        )?;

        if !snapshot.entries.is_empty() || snapshot.thread_id.is_some() {
            return Ok(snapshot);
        }

        if thread_id != 1 {
            return Ok(snapshot);
        }

        let Some(legacy) = self.load_conversation_legacy(&project_slug, &workspace_name)? else {
            return Ok(snapshot);
        };

        if legacy.entries.is_empty() && legacy.thread_id.is_none() {
            return Ok(snapshot);
        }

        if let Some(thread_id) = legacy.thread_id.as_deref() {
            let existing_thread_id = self.sqlite.get_conversation_thread_id(
                project_slug.clone(),
                workspace_name.clone(),
                1,
            )?;
            if existing_thread_id.is_none() {
                self.sqlite.set_conversation_thread_id(
                    project_slug.clone(),
                    workspace_name.clone(),
                    1,
                    thread_id.to_owned(),
                )?;
            }
        }

        if !legacy.entries.is_empty() {
            self.sqlite.append_conversation_entries(
                project_slug.clone(),
                workspace_name.clone(),
                1,
                legacy.entries,
            )?;
        }

        self.sqlite
            .load_conversation(project_slug.clone(), workspace_name.clone(), 1)
    }
}
