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
    InProgress,
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
        #[serde(default)]
        command: String,
        #[serde(default)]
        aggregated_output: String,
        #[serde(default)]
        exit_code: Option<i32>,
        status: CodexCommandExecutionStatus,
    },
    #[serde(rename = "file_change")]
    FileChange {
        id: String,
        #[serde(default)]
        changes: Vec<CodexFileUpdateChange>,
        status: CodexPatchApplyStatus,
    },
    #[serde(rename = "mcp_tool_call")]
    McpToolCall {
        id: String,
        #[serde(default)]
        server: String,
        #[serde(default)]
        tool: String,
        #[serde(default)]
        arguments: serde_json::Value,
        result: Option<serde_json::Value>,
        error: Option<CodexErrorMessage>,
        status: CodexMcpToolCallStatus,
    },
    #[serde(rename = "web_search")]
    WebSearch {
        id: String,
        #[serde(default)]
        query: String,
    },
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_parsing_accepts_partial_command_execution_items() {
        let payload = r#"{"type":"item.started","item":{"type":"command_execution","id":"cmd_1","command":"echo hi","status":"in_progress"}}"#;
        let parsed = serde_json::from_str::<CodexThreadEvent>(payload)
            .expect("partial command_execution item should deserialize");
        assert!(matches!(
            parsed,
            CodexThreadEvent::ItemStarted {
                item: CodexThreadItem::CommandExecution { .. }
            }
        ));
    }

    #[test]
    fn codex_parsing_accepts_in_progress_file_change_items() {
        let payload = r#"{"type":"item.started","item":{"type":"file_change","id":"patch_1","status":"in_progress"}}"#;
        let parsed = serde_json::from_str::<CodexThreadEvent>(payload)
            .expect("in_progress file_change item should deserialize");
        assert!(matches!(
            parsed,
            CodexThreadEvent::ItemStarted {
                item: CodexThreadItem::FileChange { .. }
            }
        ));
    }
}
