#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Backlog,
    Todo,
    #[serde(alias = "in_progress")]
    Iterating,
    #[serde(alias = "in_review")]
    Validating,
    Done,
    Canceled,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskStatus::Backlog => "backlog",
            TaskStatus::Todo => "todo",
            TaskStatus::Iterating => "iterating",
            TaskStatus::Validating => "validating",
            TaskStatus::Done => "done",
            TaskStatus::Canceled => "canceled",
        }
    }
}

pub fn parse_task_status(value: &str) -> Option<TaskStatus> {
    match value.trim().to_ascii_lowercase().as_str() {
        "backlog" => Some(TaskStatus::Backlog),
        "todo" => Some(TaskStatus::Todo),
        "iterating" | "in_progress" => Some(TaskStatus::Iterating),
        "validating" | "in_review" => Some(TaskStatus::Validating),
        "done" => Some(TaskStatus::Done),
        "canceled" => Some(TaskStatus::Canceled),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{TaskStatus, parse_task_status};

    #[test]
    fn parse_task_status_accepts_legacy_aliases() {
        assert_eq!(
            parse_task_status("in_progress"),
            Some(TaskStatus::Iterating)
        );
        assert_eq!(parse_task_status("in_review"), Some(TaskStatus::Validating));
    }

    #[test]
    fn parse_task_status_accepts_current_values() {
        assert_eq!(parse_task_status("iterating"), Some(TaskStatus::Iterating));
        assert_eq!(
            parse_task_status("validating"),
            Some(TaskStatus::Validating)
        );
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnStatus {
    Idle,
    Running,
    Awaiting,
    Paused,
}

impl TurnStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TurnStatus::Idle => "idle",
            TurnStatus::Running => "running",
            TurnStatus::Awaiting => "awaiting",
            TurnStatus::Paused => "paused",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnResult {
    Completed,
    Failed,
}

impl TurnResult {
    pub fn as_str(self) -> &'static str {
        match self {
            TurnResult::Completed => "completed",
            TurnResult::Failed => "failed",
        }
    }
}
