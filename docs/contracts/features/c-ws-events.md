# C-WS-EVENTS

Status: Draft
Verification: Mock=yes, Provider=yes, CI=no

## Surface

- WebSocket path: `/api/events`

## Purpose

Primary action/event protocol used by the UI:

- Client sends `WsClientMessage::Hello` then `WsClientMessage::Action`.
- Server sends `WsServerMessage::Hello`, `WsServerMessage::Ack`, and `WsServerMessage::Event`.

## Message types

See `crates/luban_api`:

- `WsClientMessage`
- `WsServerMessage`
- `ClientAction`
- `ServerEvent`

## Invariants

- Provider wire protocol invariants:
  - JSON must be tagged with `type` and must deserialize into the enums above.
  - `protocol_version` must match `PROTOCOL_VERSION`.
  - Each `Action` must eventually be followed by either:
    - `Ack` (plus any number of `Event`)
    - `Error` with the matching `request_id`

- Mock-mode invariant:
  - The web UI must be able to run without a real WebSocket by directly executing `ClientAction`
    against an in-process mock runtime and emitting `ServerEvent` snapshots.

## Web usage

- `web/lib/luban-transport.ts` `useLubanTransport()`

## Action inventory (tracked)

All `ClientAction` variants are part of this contract surface. For reviewability, new actions must
update this section.

- `PickProjectPath`
- `AddProject`
- `AddProjectAndOpen`
- `TaskPreview`
- `TaskExecute`
- `FeedbackSubmit`
- `DeleteProject`
- `ToggleProjectExpanded`
- `CreateWorkspace`
- `OpenWorkspace`
- `OpenWorkspaceInIde`
- `OpenWorkspaceWith`
- `OpenWorkspacePullRequest`
- `OpenWorkspacePullRequestFailedAction`
- `ArchiveWorkspace`
- `EnsureMainWorkspace`
- `ChatModelChanged`
- `ThinkingEffortChanged`
- `SendAgentMessage`
- `CancelAndSendAgentMessage`
- `QueueAgentMessage`
- `RemoveQueuedPrompt`
- `ReorderQueuedPrompt`
- `UpdateQueuedPrompt`
- `WorkspaceRenameBranch`
- `WorkspaceAiRenameBranch`
- `CancelAgentTurn`
- `CreateWorkspaceThread`
- `ActivateWorkspaceThread`
- `CloseWorkspaceThreadTab`
- `RestoreWorkspaceThreadTab`
- `ReorderWorkspaceThreadTab`
- `OpenButtonSelectionChanged`
- `AppearanceThemeChanged`
- `AppearanceFontsChanged`
- `AppearanceGlobalZoomChanged`
- `CodexEnabledChanged`
- `AgentRunnerChanged`
- `AgentAmpModeChanged`
- `TaskPromptTemplateChanged`
- `SystemPromptTemplateChanged`
- `CodexCheck`
- `CodexConfigTree`
- `CodexConfigListDir`
- `CodexConfigReadFile`
- `CodexConfigWriteFile`
- `AmpCheck`
- `AmpConfigTree`
- `AmpConfigListDir`
- `AmpConfigReadFile`
- `AmpConfigWriteFile`

## Event inventory (tracked)

All `ServerEvent` variants are part of this contract surface:

- `AppChanged`
- `WorkspaceThreadsChanged`
- `ConversationChanged`
- `Toast`
- `ProjectPathPicked`
- `AddProjectAndOpenReady`
- `TaskPreviewReady`
- `TaskExecuted`
- `FeedbackSubmitted`
- `CodexCheckReady`
- `CodexConfigTreeReady`
- `CodexConfigListDirReady`
- `CodexConfigFileReady`
- `CodexConfigFileSaved`
- `AmpCheckReady`
- `AmpConfigTreeReady`
- `AmpConfigListDirReady`
- `AmpConfigFileReady`
- `AmpConfigFileSaved`

## Request/response style events

The web UI treats some `ServerEvent` variants as request/response completions keyed by
`request_id` (see `web/lib/luban-transport.ts`):

- `ProjectPathPicked`
- `AddProjectAndOpenReady`
- `TaskPreviewReady`
- `TaskExecuted`
- `FeedbackSubmitted`
- `CodexCheckReady`
- `CodexConfigTreeReady`
- `CodexConfigListDirReady`
- `CodexConfigFileReady`
- `CodexConfigFileSaved`
- `AmpCheckReady`
- `AmpConfigTreeReady`
- `AmpConfigListDirReady`
- `AmpConfigFileReady`
- `AmpConfigFileSaved`
