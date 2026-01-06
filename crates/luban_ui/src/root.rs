use gpui::point;
use gpui::prelude::*;
use gpui::{
    AnyElement, Context, CursorStyle, ElementId, FileDropEvent, IntoElement, MouseButton, Pixels,
    PromptButton, PromptLevel, SharedString, Window, div, px, rems,
};
use gpui_component::input::RopeExt as _;
use gpui_component::{
    ActiveTheme as _, Disableable as _, ElementExt as _, Icon, IconName, IconNamed as _,
    Sizable as _, Size, StyledExt as _,
    button::*,
    collapsible::Collapsible,
    input::{Input, InputEvent, InputState},
    popover::Popover,
    scroll::{ScrollableElement as _, Scrollbar, ScrollbarShow},
    spinner::Spinner,
    text::{TextView, TextViewStyle},
};
use luban_domain::{
    Action, AgentRunConfig, AppState, CodexThreadEvent, CodexThreadItem, DashboardCardModel,
    DashboardPreviewModel, DashboardStage, Effect, MainPane, OperationStatus, ProjectId,
    ProjectWorkspaceService, PullRequestInfo, RightPane, RunAgentTurnRequest, ThinkingEffort,
    WorkspaceId, WorkspaceStatus, agent_model_label, agent_models, dashboard_cards,
    dashboard_preview, default_agent_model_id, default_thinking_effort, thinking_effort_supported,
};
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    path::PathBuf,
    rc::Rc,
    sync::Arc,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant, SystemTime},
};

use crate::selectable_text::SelectablePlainText;
use crate::terminal_panel::{WorkspaceTerminal, spawn_workspace_terminal, terminal_cell_metrics};

mod chat_input;
mod dashboard;
mod gh;
mod right_pane;
mod sidebar;
mod titlebar;
use sidebar::render_sidebar;
use titlebar::render_titlebar;

const TERMINAL_PANE_RESIZER_WIDTH: f32 = 6.0;
const SIDEBAR_RESIZER_WIDTH: f32 = 6.0;
const DASHBOARD_PREVIEW_RESIZER_WIDTH: f32 = 6.0;
const RIGHT_PANE_CONTENT_PADDING: f32 = 8.0;
const TITLEBAR_HEIGHT: f32 = 44.0;
const MAX_INLINE_PASTE_CHARS: usize = 8_000;
const MAX_INLINE_PASTE_LINES: usize = 200;

static PENDING_CONTEXT_TOKEN_ID: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(1);

#[cfg(not(test))]
const SUCCESS_TOAST_DURATION: Duration = Duration::from_secs(2);
#[cfg(test)]
const SUCCESS_TOAST_DURATION: Duration = Duration::from_millis(30);

#[derive(Clone, Debug)]
enum ContextImportSpec {
    Image { extension: String, bytes: Vec<u8> },
    Text { extension: String, text: String },
    File { source_path: PathBuf },
}

fn context_token(kind: &str, value: &str) -> String {
    format!("<<context:{kind}:{value}>>>")
}

fn next_pending_context_id() -> u64 {
    PENDING_CONTEXT_TOKEN_ID.fetch_add(1, Ordering::Relaxed)
}

fn draft_text_and_attachments_from_message_text(
    text: &str,
) -> (
    String,
    Vec<(luban_domain::ContextTokenKind, usize, PathBuf)>,
) {
    let tokens = luban_domain::find_context_tokens(text);
    if tokens.is_empty() {
        return (text.to_owned(), Vec::new());
    }

    let mut draft = String::with_capacity(text.len());
    let mut attachments = Vec::new();
    let mut cursor = 0usize;
    for token in tokens {
        if token.range.start > cursor {
            draft.push_str(&text[cursor..token.range.start]);
        }
        let anchor = draft.len();
        attachments.push((token.kind, anchor, token.path));
        cursor = token.range.end;
    }
    if cursor < text.len() {
        draft.push_str(&text[cursor..]);
    }

    (draft, attachments)
}

fn ordered_draft_attachments_for_display(
    attachments: &[luban_domain::DraftAttachment],
) -> Vec<luban_domain::DraftAttachment> {
    let mut out = attachments.to_vec();
    out.sort_by(|a, b| (a.anchor, a.id).cmp(&(b.anchor, b.id)));
    out
}

fn compose_user_message_text(
    draft_text: &str,
    attachments: &[luban_domain::DraftAttachment],
) -> String {
    let mut ready = attachments
        .iter()
        .filter(|a| a.path.is_some() && !a.failed)
        .collect::<Vec<_>>();
    if ready.is_empty() {
        return draft_text.trim().to_owned();
    }

    ready.sort_by(|a, b| (a.anchor, a.id).cmp(&(b.anchor, b.id)));

    let bytes = draft_text.as_bytes();
    let mut cursor = 0usize;
    let mut out = String::with_capacity(draft_text.len() + ready.len() * 48);

    let mut idx = 0usize;
    while idx < ready.len() {
        let anchor = ready[idx].anchor.min(draft_text.len());
        out.push_str(&draft_text[cursor..anchor]);

        if anchor > 0 && bytes[anchor - 1] != b'\n' {
            out.push('\n');
        }

        let mut first = true;
        while idx < ready.len() && ready[idx].anchor.min(draft_text.len()) == anchor {
            let attachment = ready[idx];
            let path = attachment.path.as_ref().expect("ready attachment path");
            let kind = match attachment.kind {
                luban_domain::ContextTokenKind::Image => "image",
                luban_domain::ContextTokenKind::Text => "text",
                luban_domain::ContextTokenKind::File => "file",
            };
            if !first {
                out.push('\n');
            }
            first = false;
            out.push_str(&context_token(kind, path.to_string_lossy().as_ref()));
            idx += 1;
        }

        if anchor < draft_text.len() && bytes[anchor] != b'\n' {
            out.push('\n');
        }

        cursor = anchor;
    }

    out.push_str(&draft_text[cursor..]);
    out.trim().to_owned()
}

fn should_inline_paste_text(text: &str) -> bool {
    if text.chars().count() > MAX_INLINE_PASTE_CHARS {
        return false;
    }
    if text.lines().count() > MAX_INLINE_PASTE_LINES {
        return false;
    }
    true
}

fn is_text_like_extension(path: &std::path::Path) -> bool {
    let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
        return false;
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "txt"
            | "md"
            | "json"
            | "toml"
            | "yaml"
            | "yml"
            | "rs"
            | "go"
            | "py"
            | "js"
            | "ts"
            | "jsx"
            | "tsx"
            | "html"
            | "css"
            | "log"
            | "csv"
    )
}

fn image_format_extension(format: gpui::ImageFormat) -> Option<&'static str> {
    match format {
        gpui::ImageFormat::Png => Some("png"),
        gpui::ImageFormat::Jpeg => Some("jpg"),
        gpui::ImageFormat::Webp => Some("webp"),
        gpui::ImageFormat::Bmp => Some("bmp"),
        gpui::ImageFormat::Tiff => Some("tiff"),
        gpui::ImageFormat::Ico => Some("ico"),
        gpui::ImageFormat::Svg => Some("svg"),
        gpui::ImageFormat::Gif => Some("gif"),
    }
}

fn context_import_plan_from_clipboard(
    clipboard: &gpui::ClipboardItem,
) -> (Option<String>, Vec<ContextImportSpec>) {
    let mut inline_text = clipboard.text().unwrap_or_default();
    let mut imports: Vec<ContextImportSpec> = Vec::new();

    for entry in clipboard.entries() {
        match entry {
            gpui::ClipboardEntry::Image(image) => {
                let Some(ext) = image_format_extension(image.format) else {
                    continue;
                };
                imports.push(ContextImportSpec::Image {
                    extension: ext.to_owned(),
                    bytes: image.bytes.clone(),
                });
            }
            gpui::ClipboardEntry::ExternalPaths(paths) => {
                for path in paths.paths() {
                    let path = path.to_path_buf();
                    if !is_text_like_extension(&path) {
                        continue;
                    }
                    imports.push(ContextImportSpec::File { source_path: path });
                }
            }
            gpui::ClipboardEntry::String(_) => {}
        }
    }

    if !inline_text.is_empty() && !should_inline_paste_text(&inline_text) {
        imports.push(ContextImportSpec::Text {
            extension: "txt".to_owned(),
            text: inline_text,
        });
        inline_text = String::new();
    }

    let inline_text = if inline_text.is_empty() {
        None
    } else {
        Some(inline_text)
    };

    (inline_text, imports)
}

fn chat_composer_attachments_row(
    workspace_id: WorkspaceId,
    attachments: &[luban_domain::DraftAttachment],
    view_handle: &gpui::WeakEntity<LubanRootView>,
    theme: &gpui_component::Theme,
) -> Option<AnyElement> {
    if attachments.is_empty() {
        return None;
    }

    let ordered = ordered_draft_attachments_for_display(attachments);
    let items = ordered
        .iter()
        .map(|attachment| {
            let id = attachment.id;
            let debug_id = format!("chat-composer-attachment-{id}");
            let view_handle = view_handle.clone();

            let remove = move || {
                let view_handle = view_handle.clone();

                div()
                    .id(format!("chat-composer-attachment-remove-{id}"))
                    .w(px(18.0))
                    .h(px(18.0))
                    .rounded_full()
                    .bg(gpui::rgba(0x0000_00dc))
                    .text_color(gpui::rgb(0x00ff_ffff))
                    .flex()
                    .items_center()
                    .justify_center()
                    .cursor_pointer()
                    .child(Icon::new(IconName::Close).with_size(Size::XSmall))
                    .on_mouse_down(MouseButton::Left, move |_, _, app| {
                        let _ = view_handle.update(app, |view, cx| {
                            view.dispatch(
                                Action::ChatDraftAttachmentRemoved { workspace_id, id },
                                cx,
                            );
                        });
                    })
            };

            let body = if attachment.failed {
                div()
                    .h(px(72.0))
                    .px_3()
                    .rounded_xl()
                    .border_1()
                    .border_color(theme.danger_hover)
                    .bg(theme.danger)
                    .text_color(theme.danger_foreground)
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(div().text_sm().child("Failed"))
                    .child(div().flex_1())
                    .child(remove())
                    .into_any_element()
            } else if attachment.path.is_none() {
                div()
                    .relative()
                    .w(px(72.0))
                    .h(px(72.0))
                    .rounded_xl()
                    .border_1()
                    .border_color(theme.border)
                    .bg(theme.muted)
                    .overflow_hidden()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(Spinner::new().with_size(Size::Small))
                    .child(div().absolute().top(px(6.0)).right(px(6.0)).child(remove()))
                    .into_any_element()
            } else {
                let path = attachment.path.clone().unwrap_or_default();
                match attachment.kind {
                    luban_domain::ContextTokenKind::Image => div()
                        .relative()
                        .w(px(72.0))
                        .h(px(72.0))
                        .rounded_xl()
                        .border_1()
                        .border_color(theme.border)
                        .bg(theme.muted)
                        .overflow_hidden()
                        .child(
                            gpui::img(path)
                                .w_full()
                                .h_full()
                                .object_fit(gpui::ObjectFit::Cover)
                                .with_loading(|| {
                                    Spinner::new().with_size(Size::Small).into_any_element()
                                })
                                .with_fallback({
                                    let muted = theme.muted;
                                    let muted_foreground = theme.muted_foreground;
                                    move || {
                                        div()
                                            .w_full()
                                            .h_full()
                                            .bg(muted)
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .text_color(muted_foreground)
                                            .child("Missing")
                                            .into_any_element()
                                    }
                                }),
                        )
                        .child(div().absolute().top(px(6.0)).right(px(6.0)).child(remove()))
                        .into_any_element(),
                    luban_domain::ContextTokenKind::Text | luban_domain::ContextTokenKind::File => {
                        let filename = path
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| "attachment".to_owned());
                        div()
                            .h(px(72.0))
                            .px_3()
                            .rounded_xl()
                            .border_1()
                            .border_color(theme.border)
                            .bg(theme.muted)
                            .text_color(theme.muted_foreground)
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(Icon::new(IconName::File).with_size(Size::Small))
                            .child(div().text_sm().truncate().child(filename))
                            .child(div().flex_1())
                            .child(remove())
                            .into_any_element()
                    }
                }
            };

            div()
                .debug_selector(move || debug_id.clone())
                .child(body)
                .into_any_element()
        })
        .collect::<Vec<_>>();

    Some(
        div()
            .debug_selector(|| "chat-composer-attachments-row".to_owned())
            .w_full()
            .flex()
            .items_center()
            .flex_wrap()
            .gap_3()
            .px_4()
            .pt_2()
            .pb_1()
            .children(items)
            .into_any_element(),
    )
}

#[derive(Clone, Copy, Debug)]
struct TerminalPaneResizeState {
    start_mouse_x: Pixels,
    start_width: Pixels,
}

#[derive(Clone, Copy, Debug)]
struct TerminalPaneResizeDrag;

struct TerminalPaneResizeGhost;

impl gpui::Render for TerminalPaneResizeGhost {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div().w(px(0.0)).h(px(0.0)).hidden()
    }
}

#[derive(Clone, Copy, Debug)]
struct SidebarResizeState {
    start_mouse_x: Pixels,
    start_width: Pixels,
}

#[derive(Clone, Copy, Debug)]
struct SidebarResizeDrag;

struct SidebarResizeGhost;

impl gpui::Render for SidebarResizeGhost {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div().w(px(0.0)).h(px(0.0)).hidden()
    }
}

#[derive(Clone, Copy, Debug)]
struct DashboardPreviewResizeState {
    start_mouse_x: Pixels,
    start_width: Pixels,
}

#[derive(Clone, Copy, Debug)]
struct DashboardPreviewResizeDrag;

struct DashboardPreviewResizeGhost;

impl gpui::Render for DashboardPreviewResizeGhost {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div().w(px(0.0)).h(px(0.0)).hidden()
    }
}

pub struct LubanRootView {
    state: AppState,
    services: Arc<dyn ProjectWorkspaceService>,
    terminal_enabled: bool,
    terminal_resize_hooked: bool,
    debug_layout_enabled: bool,
    debug_scrollbar_enabled: bool,
    sidebar_width_preview: Option<Pixels>,
    last_sidebar_width: Pixels,
    sidebar_resize: Option<SidebarResizeState>,
    terminal_pane_width_preview: Option<Pixels>,
    terminal_pane_resize: Option<TerminalPaneResizeState>,
    dashboard_preview_width_preview: Option<Pixels>,
    dashboard_preview_resize: Option<DashboardPreviewResizeState>,
    last_dashboard_preview_width: Pixels,
    #[cfg(test)]
    last_terminal_grid_size: Option<(u16, u16)>,
    workspace_terminals: HashMap<WorkspaceId, WorkspaceTerminal>,
    workspace_terminal_errors: HashMap<WorkspaceId, String>,
    gh_authorized: Option<bool>,
    gh_auth_check_inflight: bool,
    gh_last_auth_check_at: Option<Instant>,
    workspace_pull_request_numbers: HashMap<WorkspaceId, Option<PullRequestInfo>>,
    workspace_pull_request_inflight: HashSet<WorkspaceId>,
    chat_input: Option<gpui::Entity<InputState>>,
    expanded_agent_items: HashSet<String>,
    expanded_agent_turns: HashSet<String>,
    chat_column_width: Option<Pixels>,
    running_turn_started_at: HashMap<WorkspaceId, Instant>,
    running_turn_tickers: HashSet<WorkspaceId>,
    pending_turn_durations: HashMap<WorkspaceId, Duration>,
    running_turn_user_message_count: HashMap<WorkspaceId, usize>,
    running_turn_summary_order: HashMap<WorkspaceId, Vec<String>>,
    turn_generation: HashMap<WorkspaceId, u64>,
    turn_cancel_flags: HashMap<WorkspaceId, Arc<AtomicBool>>,
    chat_scroll_handle: gpui::ScrollHandle,
    projects_scroll_handle: gpui::ScrollHandle,
    last_chat_workspace_id: Option<WorkspaceId>,
    last_chat_item_count: usize,
    last_workspace_before_dashboard: Option<WorkspaceId>,
    success_toast_message: Option<String>,
    success_toast_generation: u64,
    pending_context_imports: HashMap<WorkspaceId, usize>,
    #[cfg(test)]
    inspector_bounds: HashMap<&'static str, gpui::Bounds<Pixels>>,
    #[cfg(test)]
    dashboard_scroll_wheel_events: usize,
    _subscriptions: Vec<gpui::Subscription>,
}

impl LubanRootView {
    pub fn new(services: Arc<dyn ProjectWorkspaceService>, cx: &mut Context<Self>) -> Self {
        let mut this = Self {
            state: AppState::new(),
            services,
            terminal_enabled: true,
            terminal_resize_hooked: false,
            debug_layout_enabled: debug_layout::enabled_from_env(),
            debug_scrollbar_enabled: debug_scrollbar::enabled_from_env(),
            sidebar_width_preview: None,
            last_sidebar_width: px(300.0),
            sidebar_resize: None,
            terminal_pane_width_preview: None,
            terminal_pane_resize: None,
            dashboard_preview_width_preview: None,
            dashboard_preview_resize: None,
            last_dashboard_preview_width: px(420.0),
            #[cfg(test)]
            last_terminal_grid_size: None,
            workspace_terminals: HashMap::new(),
            workspace_terminal_errors: HashMap::new(),
            gh_authorized: None,
            gh_auth_check_inflight: false,
            gh_last_auth_check_at: None,
            workspace_pull_request_numbers: HashMap::new(),
            workspace_pull_request_inflight: HashSet::new(),
            chat_input: None,
            expanded_agent_items: HashSet::new(),
            expanded_agent_turns: HashSet::new(),
            chat_column_width: None,
            running_turn_started_at: HashMap::new(),
            running_turn_tickers: HashSet::new(),
            pending_turn_durations: HashMap::new(),
            running_turn_user_message_count: HashMap::new(),
            running_turn_summary_order: HashMap::new(),
            turn_generation: HashMap::new(),
            turn_cancel_flags: HashMap::new(),
            chat_scroll_handle: gpui::ScrollHandle::new(),
            projects_scroll_handle: gpui::ScrollHandle::new(),
            last_chat_workspace_id: None,
            last_chat_item_count: 0,
            last_workspace_before_dashboard: None,
            success_toast_message: None,
            success_toast_generation: 0,
            pending_context_imports: HashMap::new(),
            #[cfg(test)]
            inspector_bounds: HashMap::new(),
            #[cfg(test)]
            dashboard_scroll_wheel_events: 0,
            _subscriptions: Vec::new(),
        };

        this.dispatch(Action::AppStarted, cx);
        this
    }

    #[cfg(test)]
    pub fn with_state(
        services: Arc<dyn ProjectWorkspaceService>,
        state: AppState,
        _cx: &mut Context<Self>,
    ) -> Self {
        Self {
            last_sidebar_width: state
                .sidebar_width
                .map(|v| px(v as f32))
                .unwrap_or(px(300.0)),
            state,
            services,
            terminal_enabled: false,
            terminal_resize_hooked: false,
            debug_layout_enabled: false,
            debug_scrollbar_enabled: false,
            sidebar_width_preview: None,
            sidebar_resize: None,
            terminal_pane_width_preview: None,
            terminal_pane_resize: None,
            dashboard_preview_width_preview: None,
            dashboard_preview_resize: None,
            last_dashboard_preview_width: px(420.0),
            #[cfg(test)]
            last_terminal_grid_size: None,
            workspace_terminals: HashMap::new(),
            workspace_terminal_errors: HashMap::new(),
            gh_authorized: None,
            gh_auth_check_inflight: false,
            gh_last_auth_check_at: None,
            workspace_pull_request_numbers: HashMap::new(),
            workspace_pull_request_inflight: HashSet::new(),
            chat_input: None,
            expanded_agent_items: HashSet::new(),
            expanded_agent_turns: HashSet::new(),
            chat_column_width: None,
            running_turn_started_at: HashMap::new(),
            running_turn_tickers: HashSet::new(),
            pending_turn_durations: HashMap::new(),
            running_turn_user_message_count: HashMap::new(),
            running_turn_summary_order: HashMap::new(),
            turn_generation: HashMap::new(),
            turn_cancel_flags: HashMap::new(),
            chat_scroll_handle: gpui::ScrollHandle::new(),
            projects_scroll_handle: gpui::ScrollHandle::new(),
            last_chat_workspace_id: None,
            last_chat_item_count: 0,
            last_workspace_before_dashboard: None,
            success_toast_message: None,
            success_toast_generation: 0,
            pending_context_imports: HashMap::new(),
            #[cfg(test)]
            inspector_bounds: HashMap::new(),
            #[cfg(test)]
            dashboard_scroll_wheel_events: 0,
            _subscriptions: Vec::new(),
        }
    }

    #[cfg(test)]
    pub fn debug_state(&self) -> &AppState {
        &self.state
    }

    #[cfg(test)]
    pub fn debug_inspector_bounds(&self, key: &'static str) -> Option<gpui::Bounds<Pixels>> {
        self.inspector_bounds.get(key).copied()
    }

    #[cfg(test)]
    pub fn debug_dashboard_scroll_wheel_events(&self) -> usize {
        self.dashboard_scroll_wheel_events
    }

    #[cfg(test)]
    fn record_inspector_bounds(&mut self, key: &'static str, bounds: gpui::Bounds<Pixels>) {
        self.inspector_bounds.insert(key, bounds);
    }

    #[cfg(test)]
    pub fn debug_last_terminal_grid_size(&self) -> Option<(u16, u16)> {
        self.last_terminal_grid_size
    }

    #[cfg(test)]
    pub fn debug_chat_scroll_offset_y10(&self) -> i32 {
        quantize_pixels_y10(self.chat_scroll_handle.offset().y)
    }

    #[cfg(test)]
    pub fn debug_chat_scroll_max_offset_y10(&self) -> i32 {
        quantize_pixels_y10(self.chat_scroll_handle.max_offset().height)
    }

    fn dispatch(&mut self, action: Action, cx: &mut Context<Self>) {
        let previous_workspace_for_scroll = match self.state.main_pane {
            MainPane::Workspace(workspace_id) => Some(workspace_id),
            _ => None,
        };

        let success_toast = match &action {
            Action::AddProject { .. } => Some("Project added".to_owned()),
            Action::WorkspaceCreated { workspace_name, .. } => {
                Some(format!("Workspace \"{workspace_name}\" created"))
            }
            Action::WorkspaceArchived { workspace_id } => self
                .state
                .workspace(*workspace_id)
                .map(|workspace| format!("Workspace \"{}\" archived", workspace.workspace_name))
                .or_else(|| Some("Workspace archived".to_owned())),
            _ => None,
        };

        match &action {
            Action::OpenDashboard => {
                if let MainPane::Workspace(workspace_id) = self.state.main_pane {
                    self.last_workspace_before_dashboard = Some(workspace_id);
                } else if self.last_chat_workspace_id.is_some() {
                    self.last_workspace_before_dashboard = self.last_chat_workspace_id;
                }
            }
            Action::OpenWorkspace { workspace_id } => {
                self.last_workspace_before_dashboard = Some(*workspace_id);
            }
            _ => {}
        }

        if let Action::WorkspaceArchived { workspace_id } = &action {
            self.workspace_terminal_errors.remove(workspace_id);
            if let Some(mut terminal) = self.workspace_terminals.remove(workspace_id) {
                terminal.kill();
            }
            self.workspace_pull_request_numbers.remove(workspace_id);
            self.workspace_pull_request_inflight.remove(workspace_id);
            if self.last_workspace_before_dashboard == Some(*workspace_id) {
                self.last_workspace_before_dashboard = None;
            }
        }

        let start_timer_workspace = match &action {
            Action::SendAgentMessage { workspace_id, .. } => Some(*workspace_id),
            _ => None,
        };
        let stop_timer_workspace = match &action {
            Action::AgentEventReceived {
                workspace_id,
                event:
                    CodexThreadEvent::TurnCompleted { .. }
                    | CodexThreadEvent::TurnFailed { .. }
                    | CodexThreadEvent::Error { .. },
            }
            | Action::AgentTurnFinished { workspace_id } => Some(*workspace_id),
            Action::CancelAgentTurn { workspace_id } => Some(*workspace_id),
            _ => None,
        };
        let clear_pending_duration_workspace = match &action {
            Action::AgentEventReceived {
                workspace_id,
                event: CodexThreadEvent::TurnDuration { .. },
            } => Some(*workspace_id),
            _ => None,
        };

        let stop_timer_turn_id = stop_timer_workspace.and_then(|workspace_id| {
            self.state
                .workspace_conversation(workspace_id)
                .and_then(|c| latest_agent_turn_id(&c.entries))
        });

        let mut effects = self.state.apply(action);
        let next_workspace_for_scroll = match self.state.main_pane {
            MainPane::Workspace(workspace_id) => Some(workspace_id),
            _ => None,
        };
        if previous_workspace_for_scroll != next_workspace_for_scroll
            && let Some(workspace_id) = previous_workspace_for_scroll
        {
            let offset_y10 = quantize_pixels_y10(self.chat_scroll_handle.offset().y);
            effects.extend(self.state.apply(Action::WorkspaceChatScrollSaved {
                workspace_id,
                offset_y10,
            }));
        }
        cx.notify();
        if let Some(message) = success_toast {
            self.show_success_toast(message, cx);
        }

        if let Some(workspace_id) = start_timer_workspace {
            self.pending_turn_durations.remove(&workspace_id);
            let is_running = self
                .state
                .workspace_conversation(workspace_id)
                .map(|c| c.run_status == OperationStatus::Running)
                .unwrap_or(false);
            if is_running {
                self.ensure_running_turn_timer(workspace_id, cx);
            }
        }

        if let Some(workspace_id) = stop_timer_workspace {
            if let Some(started_at) = self.running_turn_started_at.get(&workspace_id) {
                self.pending_turn_durations
                    .insert(workspace_id, started_at.elapsed());
            }
            self.running_turn_started_at.remove(&workspace_id);
            self.running_turn_tickers.remove(&workspace_id);
            self.running_turn_user_message_count.remove(&workspace_id);
            self.running_turn_summary_order.remove(&workspace_id);
            if let Some(turn_id) = stop_timer_turn_id {
                self.collapse_agent_turn_summary(&turn_id);
            }
            cx.notify();
        }

        if let Some(workspace_id) = clear_pending_duration_workspace {
            self.pending_turn_durations.remove(&workspace_id);
            cx.notify();
        }

        for effect in effects {
            self.run_effect(effect, cx);
        }

        self.ensure_workspace_pull_request_numbers(cx);
    }

    fn bump_turn_generation(&mut self, workspace_id: WorkspaceId) -> u64 {
        let entry = self.turn_generation.entry(workspace_id).or_insert(0);
        *entry += 1;
        *entry
    }

    fn collapse_agent_turn_summary(&mut self, id: &str) {
        self.expanded_agent_turns.remove(id);
        let prefix = format!("{id}::");
        self.expanded_agent_items
            .retain(|item_id| !item_id.starts_with(&prefix));
    }

    fn toggle_agent_turn_expanded(&mut self, id: &str) {
        if self.expanded_agent_turns.contains(id) {
            self.expanded_agent_turns.remove(id);
        } else {
            self.expanded_agent_turns.insert(id.to_owned());
            let prefix = format!("{id}::");
            self.expanded_agent_items
                .retain(|item_id| !item_id.starts_with(&prefix));
        }
    }

    fn ensure_running_turn_timer(&mut self, workspace_id: WorkspaceId, cx: &mut Context<Self>) {
        self.running_turn_started_at
            .entry(workspace_id)
            .or_insert_with(Instant::now);
        if !self.running_turn_tickers.insert(workspace_id) {
            return;
        }

        cx.spawn(
            move |this: gpui::WeakEntity<LubanRootView>, cx: &mut gpui::AsyncApp| {
                let mut async_cx = cx.clone();
                async move {
                    loop {
                        gpui::Timer::after(Duration::from_secs(1)).await;

                        let still_running = this
                            .update(&mut async_cx, |view: &mut LubanRootView, view_cx| {
                                let running = view
                                    .state
                                    .workspace_conversation(workspace_id)
                                    .map(|c| c.run_status == OperationStatus::Running)
                                    .unwrap_or(false);
                                if running {
                                    view_cx.notify();
                                } else {
                                    view.running_turn_started_at.remove(&workspace_id);
                                    view.running_turn_tickers.remove(&workspace_id);
                                }
                                running
                            })
                            .unwrap_or(false);

                        if !still_running {
                            break;
                        }
                    }
                }
            },
        )
        .detach();
    }

    fn run_effect(&mut self, effect: Effect, cx: &mut Context<Self>) {
        match effect {
            Effect::LoadAppState => self.run_load_app_state(cx),
            Effect::SaveAppState => self.run_save_app_state(cx),
            Effect::CreateWorkspace { project_id } => self.run_create_workspace(project_id, cx),
            Effect::OpenWorkspaceInIde { workspace_id } => {
                self.run_open_workspace_in_ide(workspace_id, cx)
            }
            Effect::ArchiveWorkspace { workspace_id } => {
                self.run_archive_workspace(workspace_id, cx)
            }
            Effect::EnsureConversation { workspace_id } => {
                self.run_ensure_conversation(workspace_id, cx)
            }
            Effect::LoadConversation { workspace_id } => {
                self.run_load_conversation(workspace_id, cx)
            }
            Effect::RunAgentTurn {
                workspace_id,
                text,
                run_config,
            } => self.run_agent_turn(workspace_id, text, run_config, cx),
            Effect::CancelAgentTurn { workspace_id } => {
                self.bump_turn_generation(workspace_id);
                if let Some(flag) = self.turn_cancel_flags.get(&workspace_id) {
                    flag.store(true, Ordering::SeqCst);
                }
            }
        }
    }

    fn run_load_app_state(&mut self, cx: &mut Context<Self>) {
        let services = self.services.clone();

        cx.spawn(
            move |this: gpui::WeakEntity<LubanRootView>, cx: &mut gpui::AsyncApp| {
                let mut async_cx = cx.clone();
                async move {
                    let result = async_cx
                        .background_spawn(async move { services.load_app_state() })
                        .await;

                    let action = match result {
                        Ok(persisted) => Action::AppStateLoaded { persisted },
                        Err(message) => Action::AppStateLoadFailed { message },
                    };

                    let _ = this.update(
                        &mut async_cx,
                        |view: &mut LubanRootView, view_cx: &mut Context<LubanRootView>| {
                            view.dispatch(action, view_cx)
                        },
                    );
                }
            },
        )
        .detach();
    }

    fn run_save_app_state(&mut self, cx: &mut Context<Self>) {
        let services = self.services.clone();
        let snapshot = self.state.to_persisted();

        cx.spawn(
            move |this: gpui::WeakEntity<LubanRootView>, cx: &mut gpui::AsyncApp| {
                let mut async_cx = cx.clone();
                async move {
                    let result = async_cx
                        .background_spawn(async move { services.save_app_state(snapshot) })
                        .await;

                    let action = match result {
                        Ok(()) => Action::AppStateSaved,
                        Err(message) => Action::AppStateSaveFailed { message },
                    };

                    let _ = this.update(
                        &mut async_cx,
                        |view: &mut LubanRootView, view_cx: &mut Context<LubanRootView>| {
                            view.dispatch(action, view_cx)
                        },
                    );
                }
            },
        )
        .detach();
    }

    fn run_open_workspace_in_ide(&mut self, workspace_id: WorkspaceId, cx: &mut Context<Self>) {
        let Some(workspace) = self.state.workspace(workspace_id) else {
            self.dispatch(
                Action::OpenWorkspaceInIdeFailed {
                    message: "Workspace not found".to_owned(),
                },
                cx,
            );
            return;
        };

        let services = self.services.clone();
        let worktree_path = workspace.worktree_path.clone();

        cx.spawn(
            move |this: gpui::WeakEntity<LubanRootView>, cx: &mut gpui::AsyncApp| {
                let mut async_cx = cx.clone();
                async move {
                    let result = async_cx
                        .background_spawn(
                            async move { services.open_workspace_in_ide(worktree_path) },
                        )
                        .await;

                    let Err(message) = result else {
                        return;
                    };

                    let _ = this.update(
                        &mut async_cx,
                        |view: &mut LubanRootView, view_cx: &mut Context<LubanRootView>| {
                            view.dispatch(Action::OpenWorkspaceInIdeFailed { message }, view_cx)
                        },
                    );
                }
            },
        )
        .detach();
    }

    fn enqueue_context_import(
        &mut self,
        workspace_id: WorkspaceId,
        id: u64,
        _kind: luban_domain::ContextTokenKind,
        spec: ContextImportSpec,
        cx: &mut Context<Self>,
    ) {
        let Some(agent_context) = workspace_agent_context(&self.state, workspace_id) else {
            return;
        };

        *self
            .pending_context_imports
            .entry(workspace_id)
            .or_insert(0) += 1;
        let services = self.services.clone();

        cx.spawn(
            move |this: gpui::WeakEntity<LubanRootView>, cx: &mut gpui::AsyncApp| {
                let mut async_cx = cx.clone();
                async move {
                    let project_slug = agent_context.project_slug;
                    let workspace_name = agent_context.workspace_name;
                    let attachment_id = id;

                    let result = async_cx
                        .background_spawn(async move {
                            match spec {
                                ContextImportSpec::Image { extension, bytes } => services
                                    .store_context_image(
                                        project_slug,
                                        workspace_name,
                                        luban_domain::ContextImage { extension, bytes },
                                    ),
                                ContextImportSpec::Text { extension, text } => services
                                    .store_context_text(
                                        project_slug,
                                        workspace_name,
                                        text,
                                        extension,
                                    ),
                                ContextImportSpec::File { source_path } => services
                                    .store_context_file(project_slug, workspace_name, source_path),
                            }
                        })
                        .await;

                    let _ = this.update(
                        &mut async_cx,
                        |view: &mut LubanRootView, view_cx: &mut Context<LubanRootView>| {
                            if let Ok(path) = result {
                                view.dispatch(
                                    Action::ChatDraftAttachmentResolved {
                                        workspace_id,
                                        id: attachment_id,
                                        path,
                                    },
                                    view_cx,
                                );
                            } else {
                                view.dispatch(
                                    Action::ChatDraftAttachmentFailed {
                                        workspace_id,
                                        id: attachment_id,
                                    },
                                    view_cx,
                                );
                            }

                            if let Some(count) = view.pending_context_imports.get_mut(&workspace_id)
                            {
                                *count = count.saturating_sub(1);
                                if *count == 0 {
                                    view.pending_context_imports.remove(&workspace_id);
                                }
                            }

                            view_cx.notify();
                        },
                    );
                }
            },
        )
        .detach();
    }

    fn toggle_agent_item_expanded(&mut self, id: &str) {
        if !self.expanded_agent_items.insert(id.to_owned()) {
            self.expanded_agent_items.remove(id);
        }
    }

    fn run_create_workspace(&mut self, project_id: ProjectId, cx: &mut Context<Self>) {
        let Some(project) = self.state.project(project_id) else {
            self.dispatch(
                Action::WorkspaceCreateFailed {
                    project_id,
                    message: "Project not found".to_owned(),
                },
                cx,
            );
            return;
        };

        let project_path = project.path.clone();
        let project_slug = project.slug.clone();
        let services = self.services.clone();

        cx.spawn(
            move |this: gpui::WeakEntity<LubanRootView>, cx: &mut gpui::AsyncApp| {
                let mut async_cx = cx.clone();
                async move {
                    let result = async_cx
                        .background_spawn(async move {
                            services.create_workspace(project_path, project_slug)
                        })
                        .await;

                    let action = match result {
                        Ok(created) => Action::WorkspaceCreated {
                            project_id,
                            workspace_name: created.workspace_name,
                            branch_name: created.branch_name,
                            worktree_path: created.worktree_path,
                        },
                        Err(message) => Action::WorkspaceCreateFailed {
                            project_id,
                            message,
                        },
                    };

                    let _ = this.update(
                        &mut async_cx,
                        |view: &mut LubanRootView, view_cx: &mut Context<LubanRootView>| {
                            view.dispatch(action, view_cx)
                        },
                    );
                }
            },
        )
        .detach();
    }

    fn run_archive_workspace(&mut self, workspace_id: WorkspaceId, cx: &mut Context<Self>) {
        let Some((project_path, worktree_path)) = workspace_context(&self.state, workspace_id)
        else {
            self.dispatch(
                Action::WorkspaceArchiveFailed {
                    workspace_id,
                    message: "Workspace not found".to_owned(),
                },
                cx,
            );
            return;
        };

        let services = self.services.clone();

        cx.spawn(
            move |this: gpui::WeakEntity<LubanRootView>, cx: &mut gpui::AsyncApp| {
                let mut async_cx = cx.clone();
                async move {
                    let result = async_cx
                        .background_spawn(async move {
                            services.archive_workspace(project_path, worktree_path)
                        })
                        .await;

                    let action = match result {
                        Ok(()) => Action::WorkspaceArchived { workspace_id },
                        Err(message) => Action::WorkspaceArchiveFailed {
                            workspace_id,
                            message,
                        },
                    };

                    let _ = this.update(
                        &mut async_cx,
                        |view: &mut LubanRootView, view_cx: &mut Context<LubanRootView>| {
                            view.dispatch(action, view_cx)
                        },
                    );
                }
            },
        )
        .detach();
    }

    fn run_ensure_conversation(&mut self, workspace_id: WorkspaceId, cx: &mut Context<Self>) {
        let Some(agent_context) = workspace_agent_context(&self.state, workspace_id) else {
            self.dispatch(
                Action::ConversationLoadFailed {
                    workspace_id,
                    message: "Workspace not found".to_owned(),
                },
                cx,
            );
            return;
        };

        let services = self.services.clone();

        cx.spawn(
            move |this: gpui::WeakEntity<LubanRootView>, cx: &mut gpui::AsyncApp| {
                let mut async_cx = cx.clone();
                async move {
                    let result = async_cx
                        .background_spawn(async move {
                            services.ensure_conversation(
                                agent_context.project_slug,
                                agent_context.workspace_name,
                            )
                        })
                        .await;

                    if let Err(message) = result {
                        let _ = this.update(
                            &mut async_cx,
                            |view: &mut LubanRootView, view_cx: &mut Context<LubanRootView>| {
                                view.dispatch(
                                    Action::ConversationLoadFailed {
                                        workspace_id,
                                        message,
                                    },
                                    view_cx,
                                )
                            },
                        );
                    }
                }
            },
        )
        .detach();
    }

    fn run_load_conversation(&mut self, workspace_id: WorkspaceId, cx: &mut Context<Self>) {
        let Some(agent_context) = workspace_agent_context(&self.state, workspace_id) else {
            self.dispatch(
                Action::ConversationLoadFailed {
                    workspace_id,
                    message: "Workspace not found".to_owned(),
                },
                cx,
            );
            return;
        };

        let services = self.services.clone();

        cx.spawn(
            move |this: gpui::WeakEntity<LubanRootView>, cx: &mut gpui::AsyncApp| {
                let mut async_cx = cx.clone();
                async move {
                    let result = async_cx
                        .background_spawn(async move {
                            services.load_conversation(
                                agent_context.project_slug,
                                agent_context.workspace_name,
                            )
                        })
                        .await;

                    let action = match result {
                        Ok(snapshot) => Action::ConversationLoaded {
                            workspace_id,
                            snapshot,
                        },
                        Err(message) => Action::ConversationLoadFailed {
                            workspace_id,
                            message,
                        },
                    };

                    let _ = this.update(
                        &mut async_cx,
                        |view: &mut LubanRootView, view_cx: &mut Context<LubanRootView>| {
                            view.dispatch(action, view_cx)
                        },
                    );
                }
            },
        )
        .detach();
    }

    fn run_agent_turn(
        &mut self,
        workspace_id: WorkspaceId,
        text: String,
        run_config: AgentRunConfig,
        cx: &mut Context<Self>,
    ) {
        let Some(agent_context) = workspace_agent_context(&self.state, workspace_id) else {
            self.dispatch(Action::AgentTurnFinished { workspace_id }, cx);
            return;
        };

        let generation = self.bump_turn_generation(workspace_id);
        let cancel_flag = Arc::new(AtomicBool::new(false));
        self.turn_cancel_flags
            .insert(workspace_id, cancel_flag.clone());

        let thread_id = self
            .state
            .workspace_conversation(workspace_id)
            .and_then(|c| c.thread_id.clone());
        let request = RunAgentTurnRequest {
            project_slug: agent_context.project_slug,
            workspace_name: agent_context.workspace_name,
            worktree_path: agent_context.worktree_path,
            thread_id,
            prompt: text,
            model: Some(run_config.model_id),
            model_reasoning_effort: Some(run_config.thinking_effort.as_str().to_owned()),
        };
        let services = self.services.clone();

        cx.spawn(
            move |this: gpui::WeakEntity<LubanRootView>, cx: &mut gpui::AsyncApp| {
                let mut async_cx = cx.clone();
                async move {
                    let (tx, rx) = async_channel::unbounded::<CodexThreadEvent>();

                    let tx_for_events = tx.clone();
                    let tx_for_error = tx.clone();
                    let on_event: Arc<dyn Fn(CodexThreadEvent) + Send + Sync> =
                        Arc::new(move |e| {
                            let _ = tx_for_events.send_blocking(e);
                        });

                    std::thread::spawn(move || {
                        let result =
                            services.run_agent_turn_streamed(request, cancel_flag, on_event);

                        if let Err(message) = result {
                            let _ = tx_for_error.send_blocking(CodexThreadEvent::Error { message });
                        }
                    });

                    drop(tx);

                    while let Ok(event) = rx.recv().await {
                        let _ = this.update(
                            &mut async_cx,
                            |view: &mut LubanRootView, view_cx: &mut Context<LubanRootView>| {
                                let current_generation = view
                                    .turn_generation
                                    .get(&workspace_id)
                                    .copied()
                                    .unwrap_or(0);
                                if current_generation != generation {
                                    return;
                                }

                                view.dispatch(
                                    Action::AgentEventReceived {
                                        workspace_id,
                                        event,
                                    },
                                    view_cx,
                                );
                            },
                        );
                    }

                    let _ = this.update(
                        &mut async_cx,
                        |view: &mut LubanRootView, view_cx: &mut Context<LubanRootView>| {
                            let current_generation = view
                                .turn_generation
                                .get(&workspace_id)
                                .copied()
                                .unwrap_or(0);
                            if current_generation != generation {
                                return;
                            }
                            view.dispatch(Action::AgentTurnFinished { workspace_id }, view_cx);
                        },
                    );
                }
            },
        )
        .detach();
    }

    fn show_success_toast(&mut self, message: String, cx: &mut Context<Self>) {
        self.success_toast_generation = self.success_toast_generation.wrapping_add(1);
        let generation = self.success_toast_generation;
        self.success_toast_message = Some(message);
        cx.notify();

        cx.spawn(
            move |this: gpui::WeakEntity<LubanRootView>, cx: &mut gpui::AsyncApp| {
                let mut async_cx = cx.clone();
                async move {
                    gpui::Timer::after(SUCCESS_TOAST_DURATION).await;
                    let _ = this.update(
                        &mut async_cx,
                        |view: &mut LubanRootView, cx: &mut Context<LubanRootView>| {
                            view.dismiss_success_toast(generation, cx);
                        },
                    );
                }
            },
        )
        .detach();
    }

    fn dismiss_success_toast(&mut self, generation: u64, cx: &mut Context<Self>) {
        if self.success_toast_generation != generation {
            return;
        }
        if self.success_toast_message.is_none() {
            return;
        }
        self.success_toast_message = None;
        cx.notify();
    }

    fn render_success_toast(&self, cx: &mut Context<Self>) -> AnyElement {
        let theme = cx.theme();
        let Some(message) = self.success_toast_message.as_deref() else {
            return div()
                .absolute()
                .top(px(TITLEBAR_HEIGHT))
                .left_0()
                .w(px(0.0))
                .h(px(0.0))
                .debug_selector(|| "success-toast".to_owned())
                .into_any_element();
        };

        div()
            .absolute()
            .top(px(TITLEBAR_HEIGHT))
            .left_0()
            .right_0()
            .flex()
            .justify_center()
            .pt_2()
            .debug_selector(|| "success-toast".to_owned())
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .border_1()
                    .border_color(theme.success_hover)
                    .bg(theme.success)
                    .text_color(theme.success_foreground)
                    .child(Icon::new(IconName::Check))
                    .child(div().text_sm().child(message.to_owned())),
            )
            .into_any_element()
    }
}

impl gpui::Render for LubanRootView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.ensure_terminal_resize_observer(window, cx);

        let theme = cx.theme();
        let background = theme.background;
        let foreground = theme.foreground;
        let transparent = theme.transparent;
        let muted = theme.muted;
        let is_dashboard = self.state.main_pane == MainPane::Dashboard;
        let viewport_width = window.viewport_size().width;
        let sidebar_width = self.sidebar_width(window);
        if !is_dashboard {
            self.last_sidebar_width = sidebar_width;
        }
        let sidebar_width_for_titlebar = if is_dashboard {
            let absolute_max = viewport_width - px(SIDEBAR_RESIZER_WIDTH);
            self.last_sidebar_width.min(absolute_max).max(px(0.0))
        } else {
            sidebar_width
        };
        let sidebar_width_for_layout = if is_dashboard { px(0.0) } else { sidebar_width };
        let right_pane_width = if is_dashboard {
            px(0.0)
        } else {
            self.right_pane_width(window, sidebar_width_for_layout)
        };
        let should_render_right_pane = self.terminal_enabled
            && !is_dashboard
            && self.state.right_pane == RightPane::Terminal
            && right_pane_width > px(0.0);
        let view_handle = cx.entity().downgrade();

        let content = if is_dashboard {
            min_height_zero(div().flex_1().flex().child(self.render_main(window, cx)))
        } else {
            min_height_zero(
                div()
                    .flex_1()
                    .flex()
                    .child(render_sidebar(
                        cx,
                        &self.state,
                        sidebar_width_for_layout,
                        &self.workspace_pull_request_numbers,
                        &self.projects_scroll_handle,
                        self.debug_scrollbar_enabled,
                    ))
                    .child(
                        div()
                            .w(px(SIDEBAR_RESIZER_WIDTH))
                            .h_full()
                            .flex_shrink_0()
                            .cursor(CursorStyle::ResizeLeftRight)
                            .id("sidebar-resizer")
                            .debug_selector(|| "sidebar-resizer".to_owned())
                            .bg(transparent)
                            .hover(move |s| s.bg(muted))
                            .on_drag(SidebarResizeDrag, {
                                let view_handle = view_handle.clone();
                                move |_, _offset, window, app| {
                                    let start_mouse_x = window.mouse_position().x;
                                    let start_width = sidebar_width_for_layout;
                                    let _ = view_handle.update(app, |view, cx| {
                                        view.sidebar_resize = Some(SidebarResizeState {
                                            start_mouse_x,
                                            start_width,
                                        });
                                        view.sidebar_width_preview = Some(start_width);
                                        cx.notify();
                                    });
                                    app.new(|_| SidebarResizeGhost)
                                }
                            })
                            .on_drag_move::<SidebarResizeDrag>({
                                let view_handle = view_handle.clone();
                                move |event, window, app| {
                                    let mouse_x = event.event.position.x;
                                    let viewport_width = window.viewport_size().width;
                                    let _ = view_handle.update(app, |view, cx| {
                                        let Some(state) = view.sidebar_resize else {
                                            return;
                                        };
                                        let desired =
                                            state.start_width + (mouse_x - state.start_mouse_x);
                                        let clamped =
                                            view.clamp_sidebar_width(desired, viewport_width);
                                        view.sidebar_width_preview = Some(clamped);
                                        cx.notify();
                                    });
                                }
                            })
                            .on_mouse_up(MouseButton::Left, {
                                let view_handle = view_handle.clone();
                                move |_, window, app| {
                                    let viewport_width = window.viewport_size().width;
                                    let _ = view_handle.update(app, |view, cx| {
                                        view.finish_sidebar_resize(viewport_width, cx);
                                        view.resize_workspace_terminals(window, cx);
                                    });
                                }
                            })
                            .on_mouse_up_out(MouseButton::Left, {
                                let view_handle = view_handle.clone();
                                move |_, window, app| {
                                    let viewport_width = window.viewport_size().width;
                                    let _ = view_handle.update(app, |view, cx| {
                                        view.finish_sidebar_resize(viewport_width, cx);
                                        view.resize_workspace_terminals(window, cx);
                                    });
                                }
                            }),
                    )
                    .child(self.render_main(window, cx))
                    .when(should_render_right_pane, |s| {
                        let resizer = div()
                            .w(px(TERMINAL_PANE_RESIZER_WIDTH))
                            .h_full()
                            .flex_shrink_0()
                            .cursor(CursorStyle::ResizeLeftRight)
                            .id("terminal-pane-resizer")
                            .debug_selector(|| "terminal-pane-resizer".to_owned())
                            .bg(transparent)
                            .hover(move |s| s.bg(muted))
                            .on_drag(TerminalPaneResizeDrag, {
                                let view_handle = view_handle.clone();
                                move |_, _offset, window, app| {
                                    let start_mouse_x = window.mouse_position().x;
                                    let start_width = right_pane_width;
                                    let _ = view_handle.update(app, |view, cx| {
                                        view.terminal_pane_resize = Some(TerminalPaneResizeState {
                                            start_mouse_x,
                                            start_width,
                                        });
                                        view.terminal_pane_width_preview = Some(start_width);
                                        cx.notify();
                                    });
                                    app.new(|_| TerminalPaneResizeGhost)
                                }
                            })
                            .on_drag_move::<TerminalPaneResizeDrag>({
                                let view_handle = view_handle.clone();
                                move |event, window, app| {
                                    let mouse_x = event.event.position.x;
                                    let viewport_width = window.viewport_size().width;
                                    let _ = view_handle.update(app, |view, cx| {
                                        let Some(state) = view.terminal_pane_resize else {
                                            return;
                                        };
                                        let desired =
                                            state.start_width - (mouse_x - state.start_mouse_x);
                                        let clamped = view.clamp_terminal_pane_width(
                                            desired,
                                            viewport_width,
                                            sidebar_width,
                                        );
                                        view.terminal_pane_width_preview = Some(clamped);
                                        cx.notify();
                                    });
                                }
                            })
                            .on_mouse_up(MouseButton::Left, {
                                let view_handle = view_handle.clone();
                                move |_, window, app| {
                                    let viewport_width = window.viewport_size().width;
                                    let _ = view_handle.update(app, |view, cx| {
                                        view.finish_terminal_pane_resize(
                                            viewport_width,
                                            sidebar_width,
                                            cx,
                                        );
                                        view.resize_workspace_terminals(window, cx);
                                    });
                                }
                            })
                            .on_mouse_up_out(MouseButton::Left, {
                                let view_handle = view_handle.clone();
                                move |_, window, app| {
                                    let viewport_width = window.viewport_size().width;
                                    let _ = view_handle.update(app, |view, cx| {
                                        view.finish_terminal_pane_resize(
                                            viewport_width,
                                            sidebar_width,
                                            cx,
                                        );
                                        view.resize_workspace_terminals(window, cx);
                                    });
                                }
                            });

                        s.child(resizer)
                            .child(self.render_right_pane(right_pane_width, window, cx))
                    }),
            )
        };

        div()
            .size_full()
            .flex()
            .flex_col()
            .relative()
            .bg(background)
            .text_color(foreground)
            .child(render_titlebar(
                cx,
                &self.state,
                sidebar_width_for_titlebar,
                right_pane_width,
                self.terminal_enabled,
            ))
            .child(content)
            .child(self.render_success_toast(cx))
    }
}

impl LubanRootView {
    fn ensure_terminal_resize_observer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.terminal_resize_hooked {
            return;
        }
        self.terminal_resize_hooked = true;

        let subscription = cx.observe_window_bounds(window, move |this, window, cx| {
            if !this.terminal_enabled {
                return;
            }
            this.resize_workspace_terminals(window, cx);
        });
        self._subscriptions.push(subscription);
    }

    fn sidebar_width(&self, window: &Window) -> Pixels {
        let viewport_width = window.viewport_size().width;
        let desired = self
            .sidebar_width_preview
            .or_else(|| self.state.sidebar_width.map(|v| px(v as f32)))
            .unwrap_or(px(300.0));
        self.clamp_sidebar_width(desired, viewport_width)
    }

    fn clamp_sidebar_width(&self, desired: Pixels, viewport_width: Pixels) -> Pixels {
        let divider_width = px(SIDEBAR_RESIZER_WIDTH);
        if viewport_width <= divider_width + px(1.0) {
            return px(0.0);
        }

        let min_width = px(240.0);
        let max_width = px(480.0);
        let min_main_width = px(480.0);
        let min_terminal_width = px(240.0) + px(TERMINAL_PANE_RESIZER_WIDTH);
        let reserved_right =
            if self.terminal_enabled && self.state.right_pane == RightPane::Terminal {
                min_terminal_width
            } else {
                px(0.0)
            };

        let absolute_max = viewport_width - divider_width;
        let max_by_layout = if viewport_width > divider_width + reserved_right + min_main_width {
            viewport_width - divider_width - reserved_right - min_main_width
        } else {
            px(0.0)
        };
        let layout_max = if max_by_layout > px(0.0) {
            max_by_layout
        } else {
            absolute_max
        };
        let max_allowed = max_width.min(absolute_max).min(layout_max);
        let min_allowed = min_width.min(max_allowed);

        desired.clamp(min_allowed, max_allowed)
    }

    fn finish_sidebar_resize(&mut self, viewport_width: Pixels, cx: &mut Context<Self>) {
        self.sidebar_resize = None;

        let Some(preview) = self.sidebar_width_preview.take() else {
            return;
        };

        let clamped = self.clamp_sidebar_width(preview, viewport_width);
        let width = f32::from(clamped).round().max(0.0) as u16;
        self.dispatch(Action::SidebarWidthChanged { width }, cx);
    }

    fn right_pane_width(&self, window: &Window, sidebar_width: Pixels) -> gpui::Pixels {
        let viewport = window.viewport_size().width;
        let sidebar_divider_width = px(SIDEBAR_RESIZER_WIDTH);
        let divider_width = px(TERMINAL_PANE_RESIZER_WIDTH);
        if viewport <= sidebar_width + sidebar_divider_width + divider_width + px(1.0) {
            return px(0.0);
        }

        let available = viewport - sidebar_width - sidebar_divider_width - divider_width;
        let min_main_width = px(640.0);
        let min_user_main_width = px(480.0);
        let preferred_main_width = px(900.0);
        let min_width = px(240.0);
        let max_width = px(480.0);
        let ratio_width = px((f32::from(available) * 0.34).round()).clamp(min_width, max_width);

        let clamp_user_width = |desired: Pixels| {
            let max_by_main = if available > min_user_main_width + px(1.0) {
                available - min_user_main_width
            } else {
                available
            };
            desired
                .clamp(min_width, max_width)
                .min(max_by_main)
                .min(available)
        };

        if let Some(desired) = self
            .terminal_pane_width_preview
            .or_else(|| self.state.terminal_pane_width.map(|v| px(v as f32)))
        {
            return clamp_user_width(desired);
        }

        if available > preferred_main_width + px(1.0) {
            let max_by_preferred_main = available - preferred_main_width;
            ratio_width.min(max_by_preferred_main).min(available)
        } else if available > min_main_width + px(1.0) {
            let max_by_min_main = available - min_main_width;
            ratio_width.min(max_by_min_main).min(available)
        } else {
            ratio_width.min(available)
        }
    }

    fn clamp_terminal_pane_width(
        &self,
        desired: Pixels,
        viewport_width: Pixels,
        sidebar_width: Pixels,
    ) -> Pixels {
        let sidebar_divider_width = px(SIDEBAR_RESIZER_WIDTH);
        let divider_width = px(TERMINAL_PANE_RESIZER_WIDTH);
        if viewport_width <= sidebar_width + sidebar_divider_width + divider_width + px(1.0) {
            return px(0.0);
        }

        let available = viewport_width - sidebar_width - sidebar_divider_width - divider_width;
        let min_main_width = px(480.0);
        let min_width = px(240.0);
        let max_width = px(480.0);
        let max_by_main = if available > min_main_width + px(1.0) {
            available - min_main_width
        } else {
            available
        };

        desired
            .clamp(min_width, max_width)
            .min(max_by_main)
            .min(available)
    }

    fn finish_terminal_pane_resize(
        &mut self,
        viewport_width: Pixels,
        sidebar_width: Pixels,
        cx: &mut Context<Self>,
    ) {
        self.terminal_pane_resize = None;

        let Some(preview) = self.terminal_pane_width_preview.take() else {
            return;
        };

        let clamped = self.clamp_terminal_pane_width(preview, viewport_width, sidebar_width);
        let width = f32::from(clamped).round().max(0.0) as u16;
        self.dispatch(Action::TerminalPaneWidthChanged { width }, cx);
    }

    fn dashboard_preview_width(&self, window: &Window) -> Pixels {
        let viewport_width = window.viewport_size().width;
        let desired = self
            .dashboard_preview_width_preview
            .unwrap_or(self.last_dashboard_preview_width);
        self.clamp_dashboard_preview_width(desired, viewport_width)
    }

    fn clamp_dashboard_preview_width(&self, desired: Pixels, viewport_width: Pixels) -> Pixels {
        let divider_width = px(DASHBOARD_PREVIEW_RESIZER_WIDTH);
        if viewport_width <= divider_width + px(1.0) {
            return px(0.0);
        }

        let min_width = px(320.0);
        let max_width = px(900.0);
        let absolute_max = viewport_width - divider_width;
        let max_allowed = max_width.min(absolute_max);
        let min_allowed = min_width.min(max_allowed);
        desired.clamp(min_allowed, max_allowed)
    }

    fn finish_dashboard_preview_resize(&mut self, viewport_width: Pixels, cx: &mut Context<Self>) {
        self.dashboard_preview_resize = None;

        let Some(preview) = self.dashboard_preview_width_preview.take() else {
            return;
        };

        let clamped = self.clamp_dashboard_preview_width(preview, viewport_width);
        self.last_dashboard_preview_width = px(f32::from(clamped).round().max(0.0));
        cx.notify();
    }
}

impl LubanRootView {
    fn render_main(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let view_handle = cx.entity().downgrade();

        let content = match self.state.main_pane {
            MainPane::None => {
                self.last_chat_workspace_id = None;
                self.last_chat_item_count = 0;

                div().flex_1().into_any_element()
            }
            MainPane::Dashboard => {
                if self.state.dashboard_preview_workspace_id.is_none() {
                    self.last_chat_workspace_id = None;
                    self.last_chat_item_count = 0;
                }

                self.render_dashboard(view_handle, window, cx)
            }
            MainPane::ProjectSettings(project_id) => {
                self.last_chat_workspace_id = None;
                self.last_chat_item_count = 0;

                let title = self
                    .state
                    .project(project_id)
                    .map(|p| p.name.clone())
                    .unwrap_or_else(|| "Project".to_owned());

                div()
                    .flex_1()
                    .p_4()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .max_w(px(900.0))
                    .mx_auto()
                    .child(div().text_lg().child(title))
                    .child(
                        div()
                            .text_color(cx.theme().muted_foreground)
                            .child("No settings yet."),
                    )
                    .into_any_element()
            }
            MainPane::Workspace(workspace_id) => {
                if self.state.workspace(workspace_id).is_none() {
                    return div()
                        .flex_1()
                        .p_3()
                        .child(
                            div()
                                .text_color(cx.theme().danger_foreground)
                                .child("Workspace not found"),
                        )
                        .into_any_element();
                }

                let input_state = self.ensure_chat_input(window, cx);

                let conversation = self.state.workspace_conversation(workspace_id);
                let entries: &[luban_domain::ConversationEntry] =
                    conversation.map(|c| c.entries.as_slice()).unwrap_or(&[]);
                let entries_len = conversation.map(|c| c.entries.len()).unwrap_or(0);
                let ordered_in_progress_items: Vec<&CodexThreadItem> = conversation
                    .map(|c| {
                        c.in_progress_order
                            .iter()
                            .filter_map(|id| c.in_progress_items.get(id))
                            .collect()
                    })
                    .unwrap_or_default();
                let run_status = conversation
                    .map(|c| c.run_status)
                    .unwrap_or(OperationStatus::Idle);
                let queued_prompts: Vec<luban_domain::QueuedPrompt> = conversation
                    .map(|c| c.pending_prompts.iter().cloned().collect())
                    .unwrap_or_default();
                let queue_paused = conversation.map(|c| c.queue_paused).unwrap_or(false);
                let _thread_id = conversation.and_then(|c| c.thread_id.as_deref());
                let model_id = conversation
                    .map(|c| c.agent_model_id.clone())
                    .unwrap_or_else(|| default_agent_model_id().to_owned());
                let thinking_effort = conversation
                    .map(|c| c.thinking_effort)
                    .unwrap_or(default_thinking_effort());

                let is_running = run_status == OperationStatus::Running;
                let workspace_changed = self.last_chat_workspace_id != Some(workspace_id);
                if workspace_changed {
                    let offset_y10 = self
                        .state
                        .workspace_chat_scroll_y10
                        .get(&workspace_id)
                        .copied()
                        .unwrap_or(0);
                    self.chat_scroll_handle
                        .set_offset(point(px(0.0), px(offset_y10 as f32 / 10.0)));

                    let saved_draft = conversation.map(|c| c.draft.clone()).unwrap_or_default();
                    let current_value = input_state.read(cx).value().to_owned();
                    let should_move_cursor = !saved_draft.is_empty();
                    if current_value != saved_draft.as_str() || should_move_cursor {
                        input_state.update(cx, |state, cx| {
                            if current_value != saved_draft.as_str() {
                                state.set_value(&saved_draft, window, cx);
                            }

                            if should_move_cursor {
                                let end = state.text().offset_to_position(state.text().len());
                                if state.cursor_position() != end {
                                    state.set_cursor_position(end, window, cx);
                                }
                            }
                        });
                    }
                }

                let theme = cx.theme();

                let draft_text = conversation.map(|c| c.draft.clone()).unwrap_or_default();
                let draft_attachments: Vec<luban_domain::DraftAttachment> = conversation
                    .map(|c| c.draft_attachments.clone())
                    .unwrap_or_default();
                let composed = compose_user_message_text(&draft_text, &draft_attachments);
                let pending_context_imports = self
                    .pending_context_imports
                    .get(&workspace_id)
                    .copied()
                    .unwrap_or(0);
                let send_disabled = pending_context_imports > 0 || composed.trim().is_empty();
                let running_elapsed = if is_running {
                    self.running_turn_started_at
                        .get(&workspace_id)
                        .map(|t| t.elapsed())
                } else {
                    None
                };
                let tail_duration = running_elapsed.map(|elapsed| (elapsed, true)).or_else(|| {
                    self.pending_turn_durations
                        .get(&workspace_id)
                        .copied()
                        .map(|elapsed| (elapsed, false))
                });

                let expanded = self.expanded_agent_items.clone();
                let expanded_turns = self.expanded_agent_turns.clone();
                let has_in_progress_items = !ordered_in_progress_items.is_empty();
                let force_expand_current_turn = is_running || has_in_progress_items;

                let running_turn_summary_items: Vec<&CodexThreadItem> = if force_expand_current_turn
                {
                    let turn_count = agent_turn_count(entries);
                    if self
                        .running_turn_user_message_count
                        .get(&workspace_id)
                        .copied()
                        != Some(turn_count)
                    {
                        self.running_turn_user_message_count
                            .insert(workspace_id, turn_count);
                        self.running_turn_summary_order
                            .insert(workspace_id, Vec::new());
                    }

                    let order = self
                        .running_turn_summary_order
                        .entry(workspace_id)
                        .or_default();

                    if let Some(conversation) = conversation {
                        for id in conversation.in_progress_order.iter() {
                            let Some(item) = conversation.in_progress_items.get(id) else {
                                continue;
                            };
                            if !codex_item_is_summary_item(item) {
                                continue;
                            }
                            if order.iter().any(|v| v == id) {
                                continue;
                            }
                            order.push(id.clone());
                        }
                    }

                    if let Some(last_user_message_index) = entries.iter().rposition(|e| {
                        matches!(e, luban_domain::ConversationEntry::UserMessage { .. })
                    }) {
                        for entry in &entries[(last_user_message_index + 1)..] {
                            let luban_domain::ConversationEntry::CodexItem { item } = entry else {
                                continue;
                            };
                            let item = item.as_ref();
                            if !codex_item_is_summary_item(item) {
                                continue;
                            }
                            let id = codex_item_id(item);
                            if order.iter().any(|v| v == id) {
                                continue;
                            }
                            order.push(id.to_owned());
                        }
                    }

                    let order_snapshot = order.clone();
                    let mut items = Vec::new();
                    if let Some(conversation) = conversation {
                        for id in &order_snapshot {
                            if let Some(item) = conversation.in_progress_items.get(id) {
                                if codex_item_is_summary_item(item) {
                                    items.push(item);
                                }
                                continue;
                            }

                            if let Some(item) = find_summary_item_in_current_turn(entries, id) {
                                items.push(item);
                            }
                        }
                    }
                    items
                } else {
                    self.running_turn_user_message_count.remove(&workspace_id);
                    self.running_turn_summary_order.remove(&workspace_id);
                    Vec::new()
                };

                let history_children = build_workspace_history_children(
                    entries,
                    theme,
                    &expanded,
                    &expanded_turns,
                    self.chat_column_width,
                    &view_handle,
                    &running_turn_summary_items,
                    force_expand_current_turn,
                );
                self.last_chat_workspace_id = Some(workspace_id);
                self.last_chat_item_count = entries_len;

                let debug_layout_enabled = self.debug_layout_enabled;
                let history = min_height_zero(
                    div()
                        .flex_1()
                        .id("workspace-chat-scroll")
                        .overflow_scroll()
                        .track_scroll(&self.chat_scroll_handle)
                        .overflow_x_hidden()
                        .when(debug_layout_enabled, |s| {
                            s.on_prepaint(move |bounds, window, _app| {
                                debug_layout::record(
                                    "workspace-chat-scroll",
                                    window.viewport_size(),
                                    bounds,
                                );
                            })
                        })
                        .w_full()
                        .px_4()
                        .py_3()
                        .child(min_width_zero(
                            div()
                                .debug_selector(|| "workspace-chat-column".to_owned())
                                .on_prepaint({
                                    let view_handle = view_handle.clone();
                                    move |bounds, _window, app| {
                                        let width = bounds.size.width;
                                        let _ = view_handle.update(app, |view, cx| {
                                            let should_update = match view.chat_column_width {
                                                Some(prev) => (prev - width).abs() > px(0.5),
                                                None => true,
                                            };
                                            if should_update {
                                                view.chat_column_width = Some(width);
                                                cx.notify();
                                            }
                                        });
                                    }
                                })
                                .w_full()
                                .max_w(px(900.0))
                                .mx_auto()
                                .flex()
                                .flex_col()
                                .gap_3()
                                .whitespace_normal()
                                .pb_2()
                                .children(history_children)
                                .when_some(tail_duration, |s, (elapsed, running)| {
                                    s.child(
                                        div()
                                            .debug_selector(|| "chat-tail-turn-duration".to_owned())
                                            .child(render_turn_duration_row(
                                                theme, elapsed, running,
                                            )),
                                    )
                                }),
                        )),
                );

                let queue_panel = if !queued_prompts.is_empty() {
                    let theme = cx.theme();
                    let view_handle = view_handle.clone();
                    let input_state = input_state.clone();

                    let toolbar = div()
                        .h(px(24.0))
                        .w_full()
                        .px_1()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(div().text_xs().text_color(theme.muted_foreground).child(
                            if queue_paused {
                                "Queued • Paused"
                            } else {
                                "Queued"
                            },
                        ))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_1()
                                .when(queue_paused && !is_running, |s| {
                                    let view_handle = view_handle.clone();
                                    s.child(
                                        Button::new("queued-resume")
                                            .primary()
                                            .compact()
                                            .icon(IconName::Redo2)
                                            .tooltip("Resume queued messages")
                                            .on_click(move |_, _, app| {
                                                let _ = view_handle.update(app, |view, cx| {
                                                    view.dispatch(
                                                        Action::ResumeQueuedPrompts {
                                                            workspace_id,
                                                        },
                                                        cx,
                                                    );
                                                });
                                            }),
                                    )
                                })
                                .child(
                                    Button::new("queued-clear-all")
                                        .ghost()
                                        .compact()
                                        .icon(IconName::Delete)
                                        .tooltip("Clear queued messages")
                                        .on_click({
                                            let view_handle = view_handle.clone();
                                            move |_, window, app| {
                                                let receiver = window.prompt(
                                                    PromptLevel::Warning,
                                                    "Clear queued messages?",
                                                    Some("This will remove all queued messages."),
                                                    &[
                                                        PromptButton::ok("Clear"),
                                                        PromptButton::cancel("Cancel"),
                                                    ],
                                                    app,
                                                );

                                                let view_handle = view_handle.clone();
                                                app.spawn(move |cx: &mut gpui::AsyncApp| {
                                                    let mut async_cx = cx.clone();
                                                    async move {
                                                        let Ok(choice) = receiver.await else {
                                                            return;
                                                        };
                                                        if choice != 0 {
                                                            return;
                                                        }
                                                        let _ = view_handle.update(
                                                            &mut async_cx,
                                                            |view: &mut LubanRootView, view_cx| {
                                                                view.dispatch(
                                                                    Action::ClearQueuedPrompts {
                                                                        workspace_id,
                                                                    },
                                                                    view_cx,
                                                                );
                                                            },
                                                        );
                                                    }
                                                })
                                                .detach();
                                            }
                                        }),
                                ),
                        );

                    let content = div().pt_2().px_2().flex().flex_col().gap_1().children(
                        queued_prompts.iter().enumerate().map(|(idx, queued)| {
                            let view_handle_for_edit = view_handle.clone();
                            let view_handle_for_remove = view_handle.clone();
                            let input_state = input_state.clone();
                            let text = queued.text.clone();
                            div()
                                .h(px(28.0))
                                .w_full()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(
                                    div()
                                        .flex_1()
                                        .truncate()
                                        .text_color(theme.muted_foreground)
                                        .child(text.clone()),
                                )
                                .child(
                                    Button::new(format!("queued-edit-{idx}"))
                                        .ghost()
                                        .compact()
                                        .icon(IconName::Replace)
                                        .tooltip("Move to input and remove from queue")
                                        .on_click(move |_, window, app| {
                                            let (draft_text, attachments) =
                                                draft_text_and_attachments_from_message_text(&text);
                                            input_state.update(app, |state, cx| {
                                                state.set_value(&draft_text, window, cx);
                                                let end = state
                                                    .text()
                                                    .offset_to_position(state.text().len());
                                                state.set_cursor_position(end, window, cx);
                                            });
                                            let _ = view_handle_for_edit.update(app, |view, cx| {
                                                let existing_ids = view
                                                    .state
                                                    .workspace_conversation(workspace_id)
                                                    .map(|c| {
                                                        c.draft_attachments
                                                            .iter()
                                                            .map(|a| a.id)
                                                            .collect::<Vec<_>>()
                                                    })
                                                    .unwrap_or_default();
                                                for id in existing_ids {
                                                    view.dispatch(
                                                        Action::ChatDraftAttachmentRemoved {
                                                            workspace_id,
                                                            id,
                                                        },
                                                        cx,
                                                    );
                                                }
                                                view.dispatch(
                                                    Action::ChatDraftChanged {
                                                        workspace_id,
                                                        text: draft_text.clone(),
                                                    },
                                                    cx,
                                                );
                                                for (kind, anchor, path) in attachments {
                                                    let id = next_pending_context_id();
                                                    view.dispatch(
                                                        Action::ChatDraftAttachmentAdded {
                                                            workspace_id,
                                                            id,
                                                            kind,
                                                            anchor,
                                                        },
                                                        cx,
                                                    );
                                                    view.dispatch(
                                                        Action::ChatDraftAttachmentResolved {
                                                            workspace_id,
                                                            id,
                                                            path,
                                                        },
                                                        cx,
                                                    );
                                                }
                                                view.dispatch(
                                                    Action::RemoveQueuedPrompt {
                                                        workspace_id,
                                                        index: idx,
                                                    },
                                                    cx,
                                                );
                                            });
                                        }),
                                )
                                .child({
                                    Button::new(format!("queued-remove-{idx}"))
                                        .ghost()
                                        .compact()
                                        .icon(IconName::Close)
                                        .tooltip("Remove from queue")
                                        .on_click(move |_, _, app| {
                                            let _ =
                                                view_handle_for_remove.update(app, |view, cx| {
                                                    view.dispatch(
                                                        Action::RemoveQueuedPrompt {
                                                            workspace_id,
                                                            index: idx,
                                                        },
                                                        cx,
                                                    );
                                                });
                                        })
                                })
                                .into_any_element()
                        }),
                    );

                    div()
                        .w_full()
                        .child(toolbar)
                        .child(content)
                        .into_any_element()
                } else {
                    div().hidden().into_any_element()
                };

                let debug_layout_enabled = self.debug_layout_enabled;
                let pending_drop_paths: Rc<RefCell<Option<Vec<PathBuf>>>> =
                    Rc::new(RefCell::new(None));
                let composer = div()
                    .debug_selector(|| "workspace-chat-composer".to_owned())
                    .when(debug_layout_enabled, |s| {
                        s.on_prepaint(move |bounds, window, _app| {
                            debug_layout::record(
                                "workspace-chat-composer",
                                window.viewport_size(),
                                bounds,
                            );
                        })
                    })
                    .w_full()
                    .flex_shrink_0()
                    .px_4()
                    .pb_4()
	                    .child(
	                        div()
	                            .w_full()
	                            .max_w(px(900.0))
	                            .mx_auto()
	                            .debug_selector(|| "chat-composer-surface".to_owned())
                                .capture_action({
                                    let view_handle = view_handle.clone();
                                    let input_state = input_state.clone();
                                    move |_: &gpui_component::input::Paste,
                                          window: &mut Window,
                                          app: &mut gpui::App| {
                                        let Some(clipboard) = app.read_from_clipboard() else {
                                            return;
                                        };

                                        let (inline_text, imports) =
                                            context_import_plan_from_clipboard(&clipboard);
                                        if imports.is_empty() {
                                            return;
                                        }

                                        app.stop_propagation();

                                        if let Some(text) = inline_text.as_deref()
                                            && !text.is_empty()
                                        {
                                            let inline_insert = text.to_owned();
                                            input_state.update(app, move |state, cx| {
                                                state.replace(&inline_insert, window, cx);
                                            });
                                        }

                                        let draft_text = input_state.read(app).value().to_owned();
                                        let anchor = input_state.read(app).cursor();

                                        let _ = view_handle.update(app, move |view, cx| {
                                            view.dispatch(
                                                Action::ChatDraftChanged {
                                                    workspace_id,
                                                    text: draft_text.to_string(),
                                                },
                                                cx,
                                            );

                                            for spec in imports {
                                                let id = next_pending_context_id();
                                                let kind = match &spec {
                                                    ContextImportSpec::Image { .. } => {
                                                        luban_domain::ContextTokenKind::Image
                                                    }
                                                    ContextImportSpec::Text { .. } => {
                                                        luban_domain::ContextTokenKind::Text
                                                    }
                                                    ContextImportSpec::File { .. } => {
                                                        luban_domain::ContextTokenKind::File
                                                    }
                                                };
                                                view.dispatch(
                                                    Action::ChatDraftAttachmentAdded {
                                                        workspace_id,
                                                        id,
                                                        kind,
                                                        anchor,
                                                    },
                                                    cx,
                                                );
                                                view.enqueue_context_import(
                                                    workspace_id,
                                                    id,
                                                    kind,
                                                    spec,
                                                    cx,
                                                );
                                            }
                                        });
                                    }
                                })
                                .on_drop({
                                    let view_handle = view_handle.clone();
                                    let pending_drop_paths = pending_drop_paths.clone();
                                    let input_state = input_state.clone();
                                    move |event: &FileDropEvent, _window: &mut Window, app: &mut gpui::App| {
                                        match event {
                                            FileDropEvent::Entered { paths, .. } => {
                                                *pending_drop_paths.borrow_mut() = Some(
                                                    paths.paths()
                                                        .iter()
                                                        .map(|p| p.to_path_buf())
                                                        .collect(),
                                                );
                                            }
                                            FileDropEvent::Exited => {
                                                pending_drop_paths.borrow_mut().take();
                                            }
                                            FileDropEvent::Submit { .. } => {
                                                let Some(paths) = pending_drop_paths.borrow_mut().take() else {
                                                    return;
                                                };

                                                let mut imports = Vec::new();
                                                for path in paths {
                                                    if !is_text_like_extension(&path) {
                                                        continue;
                                                    }
                                                    imports.push(ContextImportSpec::File { source_path: path });
                                                }

                                                if imports.is_empty() {
                                                    return;
                                                }
                                        let draft_text = input_state.read(app).value().to_owned();
                                        let anchor = input_state.read(app).cursor();
                                        let _ = view_handle.update(app, move |view, cx| {
                                            view.dispatch(
                                                Action::ChatDraftChanged {
                                                    workspace_id,
                                                    text: draft_text.to_string(),
                                                },
                                                cx,
                                            );
                                                    for spec in imports {
                                                        let id = next_pending_context_id();
                                                        view.dispatch(
                                                            Action::ChatDraftAttachmentAdded {
                                                                workspace_id,
                                                                id,
                                                                kind: luban_domain::ContextTokenKind::File,
                                                                anchor,
                                                            },
                                                            cx,
                                                        );
                                                        view.enqueue_context_import(
                                                            workspace_id,
                                                            id,
                                                            luban_domain::ContextTokenKind::File,
                                                            spec,
                                                            cx,
                                                        );
                                                    }
                                                });
                                            }
                                            FileDropEvent::Pending { .. } => {}
                                        }
                                    }
                                })
	                            .p_1()
	                            .rounded_lg()
	                            .bg(theme.background)
	                            .border_1()
	                            .border_color(theme.border)
                            .child(
                                div()
                                    .w_full()
                                    .flex()
                                    .flex_col()
                                    .gap_2()
                                    .child(queue_panel)
                                    .child(
                                        div()
                                            .w_full()
                                            .flex()
                                            .flex_col()
                                            .gap_2()
	                                            .when_some(
	                                                chat_composer_attachments_row(
	                                                    workspace_id,
	                                                    &draft_attachments,
	                                                    &view_handle,
	                                                    theme,
	                                                ),
	                                                |s, row| s.child(row),
	                                            )
	                                            .child(
		                                                div()
		                                                    .w_full()
		                                                    .debug_selector(|| "chat-composer-input".to_owned())
		                                                    .child(
		                                                        Input::new(&input_state)
		                                                            .px_4()
		                                                            .appearance(false)
		                                                            .with_size(Size::Large),
		                                                    ),
		                                            )
	                                            .child({
	                                                let view_handle = view_handle.clone();
	                                                let current_model_id = model_id.clone();
	                                                let current_thinking_effort = thinking_effort;
                                                let model_label = agent_model_label(&current_model_id)
                                                    .unwrap_or(current_model_id.as_str())
                                                    .to_owned();

                                                let model_selector = Popover::new("chat-model-popover")
                                                    .appearance(true)
                                                    .anchor(gpui::Corner::TopLeft)
                                                    .trigger(
                                                        Button::new("chat-model-selector")
                                                            .outline()
                                                            .compact()
                                                            .with_size(Size::Small)
                                                            .icon(Icon::new(IconName::Bot))
                                                            .label(model_label),
                                                    )
                                                    .content({
                                                        let view_handle = view_handle.clone();
                                                        let current_model_id = current_model_id.clone();
                                                        move |_popover_state, _window, cx| {
                                                            let theme = cx.theme();
                                                            let popover_handle = cx.entity();
                                                            let items = agent_models().iter().map(|spec| {
                                                                let selected = spec.id == current_model_id;
                                                                let view_handle = view_handle.clone();
                                                                let model_id = spec.id.to_owned();
                                                                let popover_handle = popover_handle.clone();
                                                                div()
                                                                    .h(px(32.0))
                                                                    .w_full()
                                                                    .px_2()
                                                                    .rounded_md()
                                                                    .flex()
                                                                    .items_center()
                                                                    .justify_between()
                                                                    .cursor_pointer()
                                                                    .hover(move |s| s.bg(theme.list_hover))
                                                                    .on_mouse_down(MouseButton::Left, move |_, window, app| {
                                                                        let _ = view_handle.update(app, |view, cx| {
                                                                            view.dispatch(
                                                                                Action::ChatModelChanged {
                                                                                    workspace_id,
                                                                                    model_id: model_id.clone(),
                                                                                },
                                                                                cx,
                                                                            );
                                                                        });
                                                                        popover_handle.update(app, |state, cx| {
                                                                            state.dismiss(window, cx);
                                                                        });
                                                                    })
                                                                    .child(div().child(spec.label))
                                                                    .when(selected, |s| {
                                                                        s.child(
                                                                            Icon::new(IconName::Check)
                                                                                .with_size(Size::Small)
                                                                                .text_color(theme.muted_foreground),
                                                                        )
                                                                    })
                                                                    .into_any_element()
                                                            });

                                                            div()
                                                                .w(px(260.0))
                                                                .p_2()
                                                                .flex()
                                                                .flex_col()
                                                                .gap_1()
                                                                .children(items)
                                                                .into_any_element()
                                                        }
                                                    });

                                                let effort_selector = Popover::new("chat-thinking-effort-popover")
                                                    .appearance(true)
                                                    .anchor(gpui::Corner::TopLeft)
                                                    .trigger({
                                                        let label = current_thinking_effort.label();
                                                        Button::new("chat-thinking-effort-selector")
                                                            .outline()
                                                            .compact()
                                                            .with_size(Size::Small)
                                                            .icon(Icon::new(Icon::empty().path("icons/brain.svg")))
                                                            .label(label)
                                                    })
                                                    .content({
                                                        let view_handle = view_handle.clone();
                                                        let current_model_id = current_model_id.clone();
                                                        move |_popover_state, _window, cx| {
                                                            let theme = cx.theme();
                                                            let popover_handle = cx.entity();
                                                            let items = ThinkingEffort::ALL.into_iter().map(|effort| {
                                                                let selected = effort == current_thinking_effort;
                                                                let enabled = thinking_effort_supported(&current_model_id, effort);
                                                                let view_handle = view_handle.clone();
                                                                let popover_handle = popover_handle.clone();
                                                                div()
                                                                    .h(px(32.0))
                                                                    .w_full()
                                                                    .px_2()
                                                                    .rounded_md()
                                                                    .flex()
                                                                    .items_center()
                                                                    .justify_between()
                                                                    .when(enabled, |s| {
                                                                        s.cursor_pointer()
                                                                            .hover(move |s| s.bg(theme.list_hover))
                                                                            .on_mouse_down(MouseButton::Left, move |_, window, app| {
                                                                                let _ = view_handle.update(app, |view, cx| {
                                                                                    view.dispatch(
                                                                                        Action::ThinkingEffortChanged {
                                                                                            workspace_id,
                                                                                            thinking_effort: effort,
                                                                                        },
                                                                                        cx,
                                                                                    );
                                                                                });
                                                                                popover_handle.update(app, |state, cx| {
                                                                                    state.dismiss(window, cx);
                                                                                });
                                                                            })
                                                                    })
                                                                    .when(!enabled, |s| s.text_color(theme.muted_foreground))
                                                                    .child(div().child(effort.label()))
                                                                    .when(selected, |s| {
                                                                        s.child(
                                                                            Icon::new(IconName::Check)
                                                                                .with_size(Size::Small)
                                                                                .text_color(theme.muted_foreground),
                                                                        )
                                                                    })
                                                                    .into_any_element()
                                                            });

                                                            div()
                                                                .w(px(220.0))
                                                                .p_2()
                                                                .flex()
                                                                .flex_col()
                                                                .gap_1()
                                                                .children(items)
                                                                .into_any_element()
                                                        }
                                                    });

                                                let send_controls = div()
                                                    .flex()
                                                    .items_center()
                                                    .gap_2()
                                                    .child(
                                                        div()
                                                            .debug_selector(|| "chat-send-message".to_owned())
                                                            .child({
                                                                let view_handle = view_handle.clone();
                                                                let input_state = input_state.clone();
                                                                let composed = composed.clone();
                                                                Button::new("chat-send-message")
                                                                    .primary()
                                                                    .compact()
                                                                    .disabled(send_disabled)
                                                                    .icon(Icon::new(IconName::ArrowUp))
                                                                    .tooltip(if is_running { "Queue" } else { "Send" })
                                                                    .on_click(move |_, window, app| {
                                                                        if composed.trim().is_empty() {
                                                                            return;
                                                                        }

                                                                        input_state.update(app, |state, cx| {
                                                                            state.set_value("", window, cx);
                                                                        });

                                                                        let _ = view_handle.update(app, |view, cx| {
                                                                            view.dispatch(
                                                                                Action::SendAgentMessage {
                                                                                    workspace_id,
                                                                                    text: composed.clone(),
                                                                                },
                                                                                cx,
                                                                            );
                                                                        });
                                                                    })
                                                                    .into_any_element()
                                                            }),
                                                    )
                                                    .when(is_running, |s| {
                                                        let view_handle = view_handle.clone();
                                                        s.child(
                                                            Button::new("chat-cancel-turn")
                                                                .danger()
                                                                .compact()
                                                                .icon(Icon::new(IconName::CircleX))
                                                                .tooltip("Cancel")
                                                                .on_click(move |_, _, app| {
                                                                    let _ = view_handle.update(app, |view, cx| {
                                                                        view.dispatch(
                                                                            Action::CancelAgentTurn { workspace_id },
                                                                            cx,
                                                                        );
                                                                    });
                                                                }),
                                                        )
                                                    });

	                                                div()
	                                                    .w_full()
	                                                    .flex()
	                                                    .px_4()
	                                                    .items_center()
	                                                    .justify_between()
	                                                    .child(
	                                                        div()
                                                            .flex()
                                                            .items_center()
                                                            .gap_2()
                                                            .child(
                                                                div()
                                                                    .debug_selector(|| {
                                                                        "chat-model-selector"
                                                                            .to_owned()
                                                                    })
                                                                    .child(model_selector),
                                                            )
                                                            .child(
                                                                div()
                                                                    .debug_selector(|| {
                                                                        "chat-thinking-effort-selector"
                                                                            .to_owned()
                                                                    })
                                                                    .child(effort_selector),
                                                            ),
                                                    )
                                                    .child(send_controls)
                                                    .into_any_element()
                                            }),
                                    ),
                            ),
                    );

                min_height_zero(
                    div()
                        .flex_1()
                        .flex()
                        .flex_col()
                        .child(history)
                        .child(composer),
                )
                .into_any_element()
            }
        };

        let theme = cx.theme();
        let debug_layout_enabled = self.debug_layout_enabled;

        min_width_zero(min_height_zero(
            div()
                .debug_selector(|| "main-pane".to_owned())
                .when(debug_layout_enabled, |s| {
                    s.on_prepaint(move |bounds, window, _app| {
                        debug_layout::record("main-pane", window.viewport_size(), bounds);
                    })
                })
                .flex_1()
                .h_full()
                .flex()
                .flex_col()
                .bg(theme.background)
                .when_some(self.state.last_error.clone(), |s, message| {
                    let theme = cx.theme();
                    let view_handle = cx.entity().downgrade();
                    s.child(
                        div()
                            .mx_4()
                            .mt_3()
                            .p_3()
                            .rounded_md()
                            .bg(theme.danger)
                            .border_1()
                            .border_color(theme.danger_hover)
                            .flex()
                            .items_center()
                            .justify_between()
                            .text_color(theme.danger_foreground)
                            .child(div().child(message))
                            .child(
                                div().debug_selector(|| "error-dismiss".to_owned()).child(
                                    Button::new("error-dismiss")
                                        .ghost()
                                        .compact()
                                        .label("Dismiss")
                                        .on_click(move |_, _, app| {
                                            let _ = view_handle.update(app, |view, cx| {
                                                view.dispatch(Action::ClearError, cx);
                                            });
                                        }),
                                ),
                            ),
                    )
                })
                .child(content),
        ))
        .into_any_element()
    }
}

fn main_pane_title(state: &AppState, pane: MainPane) -> String {
    match pane {
        MainPane::None => String::new(),
        MainPane::Dashboard => "Dashboard".to_owned(),
        MainPane::ProjectSettings(project_id) => state
            .project(project_id)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "Project Settings".to_owned()),
        MainPane::Workspace(workspace_id) => state
            .workspace(workspace_id)
            .map(|w| w.workspace_name.clone())
            .unwrap_or_else(|| "Workspace".to_owned()),
    }
}

fn render_conversation_entry(
    entry_index: usize,
    entry: &luban_domain::ConversationEntry,
    theme: &gpui_component::Theme,
    expanded_items: &HashSet<String>,
    chat_column_width: Option<Pixels>,
    view_handle: &gpui::WeakEntity<LubanRootView>,
) -> AnyElement {
    match entry {
        luban_domain::ConversationEntry::UserMessage { text } => {
            let is_short_single_line = text.lines().nth(1).is_none() && text.chars().count() <= 80;
            let wrap_width = if is_short_single_line {
                None
            } else {
                chat_column_width
                    .map(|w| w.min(px(680.0)))
                    .map(|w| (w - px(32.0)).max(px(0.0)))
            };
            let message = user_message_view_with_context_tokens(
                entry_index,
                text,
                wrap_width,
                theme.foreground,
                theme.border,
            );
            let bubble = min_width_zero(
                div()
                    .max_w(px(680.0))
                    .overflow_x_hidden()
                    .p_2()
                    .rounded_md()
                    .bg(theme.accent)
                    .border_1()
                    .border_color(theme.border)
                    .child(min_width_zero(
                        div().w_full().whitespace_normal().child(message),
                    )),
            );

            div()
                .debug_selector(move || format!("conversation-user-row-{entry_index}"))
                .id(format!("conversation-user-{entry_index}"))
                .w_full()
                .overflow_x_hidden()
                .flex()
                .flex_row()
                .justify_end()
                .child(
                    bubble
                        .debug_selector(move || format!("conversation-user-bubble-{entry_index}")),
                )
                .into_any_element()
        }
        luban_domain::ConversationEntry::CodexItem { item } => div()
            .id(format!(
                "conversation-codex-{}-{entry_index}",
                codex_item_id(item)
            ))
            .w_full()
            .child(render_codex_item(
                &format!("entry-{entry_index}-{}", codex_item_id(item.as_ref())),
                item.as_ref(),
                theme,
                false,
                expanded_items,
                chat_column_width,
                view_handle,
            ))
            .into_any_element(),
        luban_domain::ConversationEntry::TurnUsage { usage: _ } => div()
            .id(format!("conversation-usage-{entry_index}"))
            .hidden()
            .into_any_element(),
        luban_domain::ConversationEntry::TurnDuration { duration_ms } => div()
            .debug_selector(move || format!("turn-duration-{entry_index}"))
            .id(format!("conversation-duration-{entry_index}"))
            .child(render_turn_duration_row(
                theme,
                Duration::from_millis(*duration_ms),
                false,
            ))
            .into_any_element(),
        luban_domain::ConversationEntry::TurnCanceled => div()
            .id(format!("conversation-canceled-{entry_index}"))
            .p_2()
            .rounded_md()
            .bg(theme.muted)
            .border_1()
            .border_color(theme.border)
            .text_color(theme.muted_foreground)
            .child(div().child("Canceled"))
            .into_any_element(),
        luban_domain::ConversationEntry::TurnError { message } => div()
            .id(format!("conversation-error-{entry_index}"))
            .p_2()
            .rounded_md()
            .bg(theme.danger)
            .border_1()
            .border_color(theme.danger_hover)
            .text_color(theme.danger_foreground)
            .child(div().child(message.clone()))
            .into_any_element(),
    }
}

fn user_message_view_with_context_tokens(
    entry_index: usize,
    text: &str,
    wrap_width: Option<Pixels>,
    text_color: gpui::Hsla,
    border_color: gpui::Hsla,
) -> AnyElement {
    let tokens = luban_domain::find_context_tokens(text);
    if tokens.is_empty() {
        return chat_message_view(
            &format!("user-message-{entry_index}"),
            text,
            wrap_width,
            text_color,
        );
    }

    let mut children: Vec<AnyElement> = Vec::new();
    let mut cursor = 0usize;

    for (attachment_index, token) in tokens.into_iter().enumerate() {
        if token.range.start > cursor {
            let segment = &text[cursor..token.range.start];
            if !segment.trim().is_empty() {
                children.push(chat_message_view(
                    &format!("user-message-{entry_index}-seg-{attachment_index}"),
                    segment,
                    wrap_width,
                    text_color,
                ));
            }
        }

        let debug_id = format!("conversation-user-attachment-{entry_index}-{attachment_index}");
        let attachment = match token.kind {
            luban_domain::ContextTokenKind::Image => {
                let path = token.path;
                gpui::img(path)
                    .w_full()
                    .h(px(220.0))
                    .rounded_md()
                    .border_1()
                    .border_color(border_color)
                    .object_fit(gpui::ObjectFit::Contain)
                    .with_loading(|| Spinner::new().with_size(Size::Small).into_any_element())
                    .with_fallback(|| {
                        div()
                            .px_2()
                            .py_2()
                            .rounded_md()
                            .border_1()
                            .child("Missing image")
                            .into_any_element()
                    })
                    .into_any_element()
            }
            luban_domain::ContextTokenKind::Text | luban_domain::ContextTokenKind::File => {
                let filename = token
                    .path
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "attachment".to_owned());
                div()
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .border_1()
                    .border_color(border_color)
                    .child(format!("Attachment: {filename}"))
                    .into_any_element()
            }
        };

        children.push(
            div()
                .debug_selector(move || debug_id.clone())
                .child(attachment)
                .into_any_element(),
        );

        cursor = token.range.end;
    }

    if cursor < text.len() {
        let tail = &text[cursor..];
        if !tail.trim().is_empty() {
            children.push(chat_message_view(
                &format!("user-message-{entry_index}-tail"),
                tail,
                wrap_width,
                text_color,
            ));
        }
    }

    div()
        .id(format!("user-message-{entry_index}-with-context"))
        .w_full()
        .flex()
        .flex_col()
        .gap_2()
        .children(children)
        .into_any_element()
}

fn min_width_zero<E: gpui::Styled>(mut element: E) -> E {
    element.style().min_size.width = Some(px(0.0).into());
    element
}

fn min_height_zero<E: gpui::Styled>(mut element: E) -> E {
    element.style().min_size.height = Some(px(0.0).into());
    element
}

fn quantize_pixels_y10(pixels: Pixels) -> i32 {
    (f32::from(pixels) * 10.0).round() as i32
}

mod debug_layout {
    use gpui::{Bounds, Pixels, Size};
    use std::{
        collections::HashMap,
        sync::{Mutex, OnceLock},
    };

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct LayoutSample {
        viewport_w10: i32,
        viewport_h10: i32,
        x10: i32,
        y10: i32,
        w10: i32,
        h10: i32,
    }

    impl LayoutSample {
        fn new(viewport: Size<Pixels>, bounds: Bounds<Pixels>) -> Self {
            Self {
                viewport_w10: quantize(viewport.width),
                viewport_h10: quantize(viewport.height),
                x10: quantize(bounds.origin.x),
                y10: quantize(bounds.origin.y),
                w10: quantize(bounds.size.width),
                h10: quantize(bounds.size.height),
            }
        }

        fn to_f32(v10: i32) -> f32 {
            v10 as f32 / 10.0
        }
    }

    fn quantize(pixels: Pixels) -> i32 {
        (f32::from(pixels) * 10.0).round() as i32
    }

    fn store() -> &'static Mutex<HashMap<&'static str, LayoutSample>> {
        static STORE: OnceLock<Mutex<HashMap<&'static str, LayoutSample>>> = OnceLock::new();
        STORE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub(super) fn enabled_from_env() -> bool {
        parse_enabled(std::env::var("LUBAN_DEBUG_LAYOUT").ok().as_deref())
    }

    pub(super) fn parse_enabled(value: Option<&str>) -> bool {
        let Some(raw) = value else {
            return false;
        };

        let normalized = raw.trim().to_ascii_lowercase();
        matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
    }

    pub(super) fn record(label: &'static str, viewport: Size<Pixels>, bounds: Bounds<Pixels>) {
        let sample = LayoutSample::new(viewport, bounds);
        let mut map = store().lock().unwrap();

        if map.get(label).copied() == Some(sample) {
            return;
        }
        map.insert(label, sample);

        eprintln!(
            "layout {label} viewport={:.1}x{:.1} bounds=({:.1},{:.1}) {:.1}x{:.1}",
            LayoutSample::to_f32(sample.viewport_w10),
            LayoutSample::to_f32(sample.viewport_h10),
            LayoutSample::to_f32(sample.x10),
            LayoutSample::to_f32(sample.y10),
            LayoutSample::to_f32(sample.w10),
            LayoutSample::to_f32(sample.h10),
        );
    }
}

mod debug_scrollbar {
    use gpui::{Bounds, Pixels, ScrollHandle, Size};
    use std::{
        collections::HashMap,
        sync::{Mutex, OnceLock},
    };

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct ScrollSample {
        viewport_w10: i32,
        viewport_h10: i32,
        x10: i32,
        y10: i32,
        w10: i32,
        h10: i32,
        offset_x10: i32,
        offset_y10: i32,
        max_x10: i32,
        max_y10: i32,
    }

    impl ScrollSample {
        fn new(viewport: Size<Pixels>, bounds: Bounds<Pixels>, handle: &ScrollHandle) -> Self {
            let offset = handle.offset();
            let max = handle.max_offset();
            Self {
                viewport_w10: quantize(viewport.width),
                viewport_h10: quantize(viewport.height),
                x10: quantize(bounds.origin.x),
                y10: quantize(bounds.origin.y),
                w10: quantize(bounds.size.width),
                h10: quantize(bounds.size.height),
                offset_x10: quantize(offset.x),
                offset_y10: quantize(offset.y),
                max_x10: quantize(max.width),
                max_y10: quantize(max.height),
            }
        }

        fn to_f32(v10: i32) -> f32 {
            v10 as f32 / 10.0
        }
    }

    fn quantize(pixels: Pixels) -> i32 {
        (f32::from(pixels) * 10.0).round() as i32
    }

    fn store() -> &'static Mutex<HashMap<&'static str, ScrollSample>> {
        static STORE: OnceLock<Mutex<HashMap<&'static str, ScrollSample>>> = OnceLock::new();
        STORE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub(super) fn enabled_from_env() -> bool {
        parse_enabled(std::env::var("LUBAN_DEBUG_SCROLLBAR").ok().as_deref())
    }

    fn parse_enabled(value: Option<&str>) -> bool {
        let Some(raw) = value else {
            return false;
        };
        let normalized = raw.trim().to_ascii_lowercase();
        matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
    }

    pub(super) fn record(
        label: &'static str,
        viewport: Size<Pixels>,
        bounds: Bounds<Pixels>,
        handle: &ScrollHandle,
    ) {
        let sample = ScrollSample::new(viewport, bounds, handle);
        let mut map = store().lock().unwrap();
        if map.get(label).copied() == Some(sample) {
            return;
        }
        map.insert(label, sample);

        let content_w10 = sample.w10 + sample.max_x10;
        let content_h10 = sample.h10 + sample.max_y10;

        eprintln!(
            "scroll {label} viewport={:.1}x{:.1} bounds=({:.1},{:.1}) {:.1}x{:.1} offset=({:.1},{:.1}) max=({:.1},{:.1}) content={:.1}x{:.1}",
            ScrollSample::to_f32(sample.viewport_w10),
            ScrollSample::to_f32(sample.viewport_h10),
            ScrollSample::to_f32(sample.x10),
            ScrollSample::to_f32(sample.y10),
            ScrollSample::to_f32(sample.w10),
            ScrollSample::to_f32(sample.h10),
            ScrollSample::to_f32(sample.offset_x10),
            ScrollSample::to_f32(sample.offset_y10),
            ScrollSample::to_f32(sample.max_x10),
            ScrollSample::to_f32(sample.max_y10),
            ScrollSample::to_f32(content_w10),
            ScrollSample::to_f32(content_h10),
        );
    }
}

#[derive(Clone, Copy)]
struct TurnSummaryCounts {
    tool_calls: usize,
    reasonings: usize,
}

fn format_agent_turn_summary(counts: TurnSummaryCounts) -> String {
    format!(
        "{} tool calls, {} thinking",
        counts.tool_calls, counts.reasonings
    )
}

fn format_agent_turn_summary_header(counts: TurnSummaryCounts, in_progress: bool) -> String {
    let _ = in_progress;
    format_agent_turn_summary(counts)
}

fn agent_turn_count(entries: &[luban_domain::ConversationEntry]) -> usize {
    entries
        .iter()
        .filter(|e| matches!(e, luban_domain::ConversationEntry::UserMessage { .. }))
        .count()
}

fn latest_agent_turn_id(entries: &[luban_domain::ConversationEntry]) -> Option<String> {
    let turn_count = agent_turn_count(entries);
    if turn_count == 0 {
        return None;
    }
    Some(format!("agent-turn-{}", turn_count - 1))
}

fn codex_item_is_summary_item(item: &CodexThreadItem) -> bool {
    matches!(
        item,
        CodexThreadItem::Reasoning { .. }
            | CodexThreadItem::TodoList { .. }
            | CodexThreadItem::Error { .. }
    ) || codex_item_is_tool_call(item)
}

fn find_summary_item_in_current_turn<'a>(
    entries: &'a [luban_domain::ConversationEntry],
    item_id: &str,
) -> Option<&'a CodexThreadItem> {
    for entry in entries.iter().rev() {
        match entry {
            luban_domain::ConversationEntry::UserMessage { .. } => break,
            luban_domain::ConversationEntry::CodexItem { item } => {
                let item = item.as_ref();
                if codex_item_id(item) == item_id && codex_item_is_summary_item(item) {
                    return Some(item);
                }
            }
            _ => {}
        }
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn build_workspace_history_children(
    entries: &[luban_domain::ConversationEntry],
    theme: &gpui_component::Theme,
    expanded_items: &HashSet<String>,
    expanded_turns: &HashSet<String>,
    chat_column_width: Option<Pixels>,
    view_handle: &gpui::WeakEntity<LubanRootView>,
    running_turn_summary_items: &[&CodexThreadItem],
    force_expand_current_turn: bool,
) -> Vec<AnyElement> {
    struct TurnAccumulator<'a> {
        id: String,
        tool_calls: usize,
        reasonings: usize,
        summary_items: Vec<&'a CodexThreadItem>,
        agent_messages: Vec<&'a CodexThreadItem>,
    }

    let mut children = Vec::new();
    let mut turn_index = 0usize;
    let mut current_turn: Option<TurnAccumulator<'_>> = None;

    let flush_turn =
        |turn: TurnAccumulator<'_>, children: &mut Vec<AnyElement>, in_progress: bool| {
            if !in_progress && turn.summary_items.is_empty() && turn.agent_messages.is_empty() {
                return;
            }

            let turn_container_id = turn.id.clone();
            let turn_id = turn.id.clone();
            let allow_toggle = !in_progress;
            let expanded = in_progress || expanded_turns.contains(&turn.id);
            let header = render_agent_turn_summary_row(
                &turn.id,
                TurnSummaryCounts {
                    tool_calls: turn.tool_calls,
                    reasonings: turn.reasonings,
                },
                !turn.summary_items.is_empty() || in_progress,
                expanded,
                in_progress,
                allow_toggle,
                theme,
                view_handle,
            );
            let mut summary_children = Vec::with_capacity(turn.summary_items.len());
            for item in turn.summary_items {
                summary_children.push(render_tool_summary_item(
                    &turn_id,
                    item,
                    theme,
                    expanded_items,
                    chat_column_width,
                    view_handle,
                ));
            }
            let content = div()
                .pl_4()
                .flex()
                .flex_col()
                .gap_2()
                .children(summary_children);

            children.push(
                div()
                    .id(format!("conversation-turn-{turn_container_id}"))
                    .w_full()
                    .child(
                        Collapsible::new()
                            .open(expanded)
                            .w_full()
                            .child(header)
                            .content(content),
                    )
                    .into_any_element(),
            );

            for item in turn.agent_messages {
                children.push(render_codex_item(
                    &format!("{}-{}", turn_id, codex_item_id(item)),
                    item,
                    theme,
                    false,
                    expanded_items,
                    chat_column_width,
                    view_handle,
                ));
            }
        };

    for (entry_index, entry) in entries.iter().enumerate() {
        match entry {
            luban_domain::ConversationEntry::UserMessage { text: _ } => {
                if let Some(turn) = current_turn.take() {
                    flush_turn(turn, &mut children, false);
                }

                children.push(render_conversation_entry(
                    entry_index,
                    entry,
                    theme,
                    expanded_items,
                    chat_column_width,
                    view_handle,
                ));
                current_turn = Some(TurnAccumulator {
                    id: format!("agent-turn-{turn_index}"),
                    tool_calls: 0,
                    reasonings: 0,
                    summary_items: Vec::new(),
                    agent_messages: Vec::new(),
                });
                turn_index += 1;
            }
            luban_domain::ConversationEntry::CodexItem { item } => {
                let item = item.as_ref();
                if let Some(turn) = &mut current_turn {
                    if matches!(item, CodexThreadItem::AgentMessage { .. }) {
                        turn.agent_messages.push(item);
                        continue;
                    }

                    if matches!(item, CodexThreadItem::Reasoning { .. }) {
                        turn.reasonings += 1;
                        turn.summary_items.push(item);
                        continue;
                    }

                    if matches!(item, CodexThreadItem::TodoList { .. }) {
                        turn.summary_items.push(item);
                        continue;
                    }

                    if matches!(item, CodexThreadItem::Error { .. }) {
                        turn.summary_items.push(item);
                        continue;
                    }

                    if codex_item_is_tool_call(item) {
                        turn.tool_calls += 1;
                        turn.summary_items.push(item);
                    }
                    continue;
                }

                children.push(render_codex_item(
                    &format!("entry-{entry_index}-{}", codex_item_id(item)),
                    item,
                    theme,
                    false,
                    expanded_items,
                    chat_column_width,
                    view_handle,
                ));
            }
            luban_domain::ConversationEntry::TurnUsage { .. } => {
                if let Some(turn) = current_turn.take() {
                    flush_turn(turn, &mut children, false);
                }
            }
            luban_domain::ConversationEntry::TurnDuration { .. }
            | luban_domain::ConversationEntry::TurnCanceled
            | luban_domain::ConversationEntry::TurnError { .. } => {
                if let Some(turn) = current_turn.take() {
                    flush_turn(turn, &mut children, false);
                }
                children.push(render_conversation_entry(
                    entry_index,
                    entry,
                    theme,
                    expanded_items,
                    chat_column_width,
                    view_handle,
                ));
            }
        }
    }

    if let Some(mut turn) = current_turn.take() {
        if force_expand_current_turn {
            turn.tool_calls = 0;
            turn.reasonings = 0;
            turn.summary_items.clear();

            for item in running_turn_summary_items {
                if !codex_item_is_summary_item(item) {
                    continue;
                }
                if matches!(item, CodexThreadItem::Reasoning { .. }) {
                    turn.reasonings += 1;
                }
                if codex_item_is_tool_call(item) {
                    turn.tool_calls += 1;
                }
                turn.summary_items.push(item);
            }
        }

        flush_turn(turn, &mut children, force_expand_current_turn);
    }

    children
}

#[allow(clippy::too_many_arguments)]
fn render_agent_turn_summary_row(
    id: &str,
    counts: TurnSummaryCounts,
    has_ops: bool,
    expanded: bool,
    in_progress: bool,
    allow_toggle: bool,
    theme: &gpui_component::Theme,
    view_handle: &gpui::WeakEntity<LubanRootView>,
) -> AnyElement {
    let debug_id = format!("agent-turn-summary-{id}");
    let view_handle_for_click = view_handle.clone();
    let id_for_click = id.to_owned();

    let row = div()
        .debug_selector(move || debug_id.clone())
        .h(px(28.0))
        .w_full()
        .px_2()
        .flex()
        .items_center()
        .gap_2()
        .group("")
        .when(has_ops && allow_toggle, move |s| {
            let view_handle = view_handle_for_click.clone();
            let id = id_for_click.clone();
            s.cursor_pointer()
                .on_mouse_down(MouseButton::Left, move |_, _, app| {
                    let _ = view_handle.update(app, |view, cx| {
                        view.toggle_agent_turn_expanded(&id);
                        cx.notify();
                    });
                })
        });

    let disclosure_icon = if expanded {
        IconName::ChevronDown
    } else {
        IconName::ChevronRight
    };

    row.child(
        div()
            .flex()
            .items_center()
            .gap_2()
            .child(min_width_zero(
                div()
                    .flex_1()
                    .truncate()
                    .text_left()
                    .text_color(theme.muted_foreground)
                    .child(format_agent_turn_summary_header(counts, in_progress)),
            ))
            .child(div().w(px(16.0)).when(has_ops && allow_toggle, |s| {
                let debug_id = format!("agent-turn-toggle-{id}");
                s.debug_selector(move || debug_id.clone())
                    .invisible()
                    .when(expanded, |s| s.visible())
                    .group_hover("", |s| s.visible())
                    .child(
                        Icon::new(disclosure_icon)
                            .with_size(Size::Small)
                            .text_color(theme.muted_foreground),
                    )
            })),
    )
    .into_any_element()
}

fn render_tool_summary_item(
    turn_id: &str,
    item: &CodexThreadItem,
    theme: &gpui_component::Theme,
    expanded_items: &HashSet<String>,
    chat_column_width: Option<Pixels>,
    view_handle: &gpui::WeakEntity<LubanRootView>,
) -> AnyElement {
    let item_id = codex_item_id(item);
    let item_key = format!("{turn_id}::{item_id}");
    let expanded = expanded_items.contains(&item_key);
    let element_id = format!("conversation-turn-item-{}", item_key.replace("::", "-"));
    let debug_id = format!("agent-turn-item-summary-{turn_id}-{item_id}");

    let (title, summary) = codex_item_summary(item, false);
    let icon = Icon::empty()
        .path(codex_item_icon_path(item))
        .with_size(Size::Small)
        .text_color(theme.muted_foreground);

    let disclosure_icon = if expanded {
        IconName::ChevronDown
    } else {
        IconName::ChevronRight
    };

    let view_handle_for_click = view_handle.clone();
    let item_key_for_click = item_key.clone();
    let header = div()
        .debug_selector(move || debug_id.clone())
        .h(px(28.0))
        .w_full()
        .px_2()
        .flex()
        .flex_row()
        .items_center()
        .gap_2()
        .group("")
        .cursor_pointer()
        .on_mouse_down(MouseButton::Left, move |_, _, app| {
            let _ = view_handle_for_click.update(app, |view, cx| {
                view.toggle_agent_item_expanded(&item_key_for_click);
                cx.notify();
            });
        })
        .child(icon)
        .child(
            div()
                .text_color(theme.muted_foreground)
                .child(format!("{title}:")),
        )
        .child(min_width_zero(
            div()
                .flex_1()
                .truncate()
                .text_color(theme.muted_foreground)
                .child(summary),
        ))
        .child(
            div()
                .w(px(16.0))
                .invisible()
                .when(expanded, |s| s.visible())
                .group_hover("", |s| s.visible())
                .child(
                    Icon::new(disclosure_icon)
                        .with_size(Size::Small)
                        .text_color(theme.muted_foreground),
                ),
        );

    let details = div()
        .w_full()
        .overflow_x_hidden()
        .whitespace_normal()
        .pl_6()
        .child(render_codex_item_details(
            &element_id,
            item,
            theme,
            chat_column_width,
            view_handle,
        ));

    div()
        .id(element_id)
        .w_full()
        .child(
            Collapsible::new()
                .open(expanded)
                .w_full()
                .child(header)
                .content(details),
        )
        .into_any_element()
}

fn render_codex_item(
    render_id: &str,
    item: &CodexThreadItem,
    theme: &gpui_component::Theme,
    in_progress: bool,
    expanded_items: &HashSet<String>,
    chat_column_width: Option<Pixels>,
    view_handle: &gpui::WeakEntity<LubanRootView>,
) -> AnyElement {
    let item_id = codex_item_id(item);
    if !in_progress && let CodexThreadItem::AgentMessage { id: _, text } = item {
        let wrap_width = chat_column_width.map(|w| (w - px(32.0)).max(px(0.0)));
        let message = chat_message_view(
            &format!("agent-message-{render_id}"),
            text,
            wrap_width,
            theme.foreground,
        );
        let debug_id = format!("conversation-agent-message-{render_id}");
        return div()
            .debug_selector(move || debug_id.clone())
            .id(format!("codex-agent-message-{render_id}"))
            .w_full()
            .overflow_x_hidden()
            .px_2()
            .py_1()
            .flex()
            .flex_col()
            .child(min_width_zero(
                div().w_full().whitespace_normal().child(message),
            ))
            .into_any_element();
    }

    let always_expanded = matches!(item, CodexThreadItem::AgentMessage { .. });
    let expanded = always_expanded || expanded_items.contains(item_id);

    let (title, summary) = codex_item_summary(item, in_progress);

    let toggle_button = if always_expanded {
        None
    } else {
        let view_handle = view_handle.clone();
        let id = item_id.to_owned();
        let icon = if expanded {
            IconName::ChevronDown
        } else {
            IconName::ChevronRight
        };
        let tooltip = if expanded { "Hide" } else { "Show" };
        Some(
            Button::new(format!("agent-item-toggle-{render_id}"))
                .ghost()
                .compact()
                .icon(icon)
                .tooltip(tooltip)
                .on_click(move |_, _, app| {
                    let _ = view_handle.update(app, |view, cx| {
                        view.toggle_agent_item_expanded(&id);
                        cx.notify();
                    });
                }),
        )
    };

    if in_progress && !expanded && !always_expanded {
        let (label, text) = codex_item_compact_summary(item);
        let item_icon = if matches!(item, CodexThreadItem::Reasoning { .. }) {
            Spinner::new()
                .with_size(Size::Small)
                .color(theme.muted_foreground)
                .into_any_element()
        } else {
            Icon::empty()
                .path(codex_item_icon_path(item))
                .with_size(Size::Small)
                .text_color(theme.muted_foreground)
                .into_any_element()
        };
        return div()
            .id(format!("codex-compact-{render_id}"))
            .h(px(28.0))
            .w_full()
            .px_1()
            .flex()
            .items_center()
            .gap_2()
            .child(item_icon)
            .child(
                div()
                    .text_color(theme.muted_foreground)
                    .child(format!("{label}:")),
            )
            .child(min_width_zero(
                div()
                    .flex_1()
                    .truncate()
                    .text_color(theme.muted_foreground)
                    .child(text),
            ))
            .when_some(toggle_button, |s, b| s.child(b))
            .into_any_element();
    }

    let header = div()
        .w_full()
        .flex()
        .items_center()
        .justify_between()
        .gap_2()
        .child(min_width_zero(
            div()
                .flex_1()
                .flex()
                .flex_col()
                .gap_1()
                .child(div().text_color(theme.muted_foreground).child(title))
                .child(min_width_zero(div().truncate().child(summary))),
        ))
        .when_some(toggle_button, |s, b| s.child(b));

    div()
        .id(format!("codex-item-{render_id}"))
        .w_full()
        .child(
            Collapsible::new()
                .open(expanded)
                .w_full()
                .p_2()
                .rounded_md()
                .bg(theme.secondary)
                .border_1()
                .border_color(theme.border)
                .child(header)
                .content(render_codex_item_details(
                    render_id,
                    item,
                    theme,
                    chat_column_width,
                    view_handle,
                )),
        )
        .into_any_element()
}

fn render_codex_item_details(
    render_id: &str,
    item: &CodexThreadItem,
    theme: &gpui_component::Theme,
    chat_column_width: Option<Pixels>,
    _view_handle: &gpui::WeakEntity<LubanRootView>,
) -> AnyElement {
    match item {
        CodexThreadItem::AgentMessage { id: _, text } => {
            let wrap_width = chat_column_width.map(|w| (w - px(80.0)).max(px(0.0)));
            let message = chat_message_view(
                &format!("agent-message-{render_id}-details"),
                text,
                wrap_width,
                theme.foreground,
            );
            div()
                .mt_2()
                .w_full()
                .overflow_x_hidden()
                .child(min_width_zero(
                    div().w_full().whitespace_normal().child(message),
                ))
                .into_any_element()
        }
        CodexThreadItem::Reasoning { id: _, text } => {
            let wrap_width = chat_column_width.map(|w| (w - px(80.0)).max(px(0.0)));
            let message = chat_message_view(
                &format!("reasoning-{render_id}-details"),
                text,
                wrap_width,
                theme.muted_foreground,
            );
            div()
                .mt_2()
                .w_full()
                .overflow_x_hidden()
                .child(min_width_zero(
                    div().w_full().whitespace_normal().child(message),
                ))
                .into_any_element()
        }
        CodexThreadItem::CommandExecution {
            id: _,
            command,
            aggregated_output,
            exit_code,
            ..
        } => div()
            .mt_2()
            .w_full()
            .overflow_x_hidden()
            .whitespace_normal()
            .flex()
            .flex_col()
            .gap_2()
            .child(min_width_zero(
                div()
                    .w_full()
                    .overflow_x_hidden()
                    .whitespace_normal()
                    .child(
                        chat_markdown_view(
                            &format!("command-{render_id}-details"),
                            &fenced_code_block("sh", command),
                            chat_column_width.map(|w| (w - px(80.0)).max(px(0.0))),
                        )
                        .text_color(theme.foreground),
                    ),
            ))
            .when(!aggregated_output.trim().is_empty(), |s| {
                s.child(min_width_zero(
                    div()
                        .w_full()
                        .overflow_x_hidden()
                        .whitespace_normal()
                        .child(
                            chat_markdown_view(
                                &format!("command-{render_id}-output"),
                                &fenced_code_block("", aggregated_output),
                                chat_column_width.map(|w| (w - px(80.0)).max(px(0.0))),
                            )
                            .text_color(theme.muted_foreground),
                        ),
                ))
            })
            .when_some(*exit_code, |s, code| {
                s.child(
                    div()
                        .whitespace_normal()
                        .text_color(theme.muted_foreground)
                        .child(format!("Exit: {code}")),
                )
            })
            .into_any_element(),
        CodexThreadItem::FileChange { changes, .. } => div()
            .mt_2()
            .w_full()
            .overflow_x_hidden()
            .whitespace_normal()
            .flex()
            .flex_col()
            .gap_1()
            .children(changes.iter().map(|c| {
                div()
                    .w_full()
                    .overflow_x_hidden()
                    .whitespace_normal()
                    .text_color(theme.muted_foreground)
                    .child(format!("{:?}: {}", c.kind, c.path))
            }))
            .into_any_element(),
        CodexThreadItem::TodoList { items, .. } => div()
            .mt_2()
            .w_full()
            .overflow_x_hidden()
            .whitespace_normal()
            .flex()
            .flex_col()
            .gap_1()
            .children(items.iter().map(|i| {
                let prefix = if i.completed { "[x]" } else { "[ ]" };
                div()
                    .w_full()
                    .overflow_x_hidden()
                    .whitespace_normal()
                    .text_color(theme.muted_foreground)
                    .child(format!("{prefix} {}", i.text))
            }))
            .into_any_element(),
        CodexThreadItem::WebSearch { query, .. } => div()
            .mt_2()
            .w_full()
            .overflow_x_hidden()
            .whitespace_normal()
            .child(div().whitespace_normal().child(query.clone()))
            .into_any_element(),
        CodexThreadItem::McpToolCall {
            server,
            tool,
            status,
            ..
        } => div()
            .mt_2()
            .w_full()
            .overflow_x_hidden()
            .whitespace_normal()
            .flex()
            .flex_col()
            .gap_1()
            .child(div().whitespace_normal().child(format!("{server}::{tool}")))
            .child(
                div()
                    .whitespace_normal()
                    .text_color(theme.muted_foreground)
                    .child(format!("{status:?}")),
            )
            .into_any_element(),
        CodexThreadItem::Error { message, .. } => div()
            .mt_2()
            .w_full()
            .overflow_x_hidden()
            .whitespace_normal()
            .text_color(theme.danger_foreground)
            .child(message.clone())
            .into_any_element(),
    }
}

fn chat_markdown_view(id: &str, source: &str, wrap_width: Option<Pixels>) -> TextView {
    let mut code_block_style = gpui::StyleRefinement::default();
    code_block_style.size.width = Some(gpui::relative(1.).into());
    code_block_style.max_size.width = Some(gpui::relative(1.).into());
    code_block_style.min_size.width = Some(px(0.0).into());

    let mut view = TextView::markdown(
        ElementId::Name(SharedString::from(format!("{id}-markdown"))),
        source.to_owned(),
    )
    .style(
        TextViewStyle::default()
            .paragraph_gap(rems(0.5))
            .code_block(code_block_style),
    )
    .selectable(true)
    .text_size(px(16.0))
    .whitespace_normal()
    .flex()
    .flex_col();

    gpui::Styled::style(&mut view).align_items = Some(gpui::AlignItems::Stretch);

    if let Some(wrap_width) = wrap_width {
        view.w(wrap_width)
    } else {
        view
    }
}

fn fenced_code_block(lang: &str, code: &str) -> String {
    let mut max_ticks = 0usize;
    let mut current = 0usize;
    for ch in code.chars() {
        if ch == '`' {
            current += 1;
            max_ticks = max_ticks.max(current);
        } else {
            current = 0;
        }
    }

    let fence_len = (max_ticks + 1).max(3);
    let fence = "`".repeat(fence_len);

    if lang.is_empty() {
        format!("{fence}\n{code}\n{fence}")
    } else {
        format!("{fence}{lang}\n{code}\n{fence}")
    }
}

fn chat_message_view(
    id: &str,
    source: &str,
    wrap_width: Option<Pixels>,
    text_color: gpui::Hsla,
) -> AnyElement {
    let markdown_like = source.contains("```")
        || source.contains("**")
        || source.contains('`')
        || source.contains("](")
        || source
            .lines()
            .any(|line| line.starts_with("# ") || line.starts_with("- ") || line.starts_with("* "));

    if markdown_like {
        return chat_markdown_view(id, source, wrap_width)
            .text_color(text_color)
            .into_any_element();
    }

    let plain_debug_selector = format!("{id}-plain-text");
    let mut container = div()
        .debug_selector(move || plain_debug_selector.clone())
        .id(ElementId::Name(SharedString::from(format!("{id}-text"))))
        .text_size(px(16.0))
        .whitespace_normal()
        .text_color(text_color)
        .child(SelectablePlainText::new(
            SharedString::from(format!("{id}-plain")),
            source.to_owned(),
        ));

    if let Some(wrap_width) = wrap_width {
        container = container.w(wrap_width);
    }

    container.into_any_element()
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

fn codex_item_summary(item: &CodexThreadItem, in_progress: bool) -> (&'static str, String) {
    let progress_suffix = if in_progress { " (in progress)" } else { "" };
    match item {
        CodexThreadItem::AgentMessage { text, .. } => {
            ("Agent", text.lines().next().unwrap_or("").to_owned())
        }
        CodexThreadItem::Reasoning { text, .. } => (
            if in_progress {
                "Reasoning (in progress)"
            } else {
                "Reasoning"
            },
            if text.trim().is_empty() {
                "…".to_owned()
            } else {
                collapse_inline_markdown_for_summary(text.lines().next().unwrap_or(""))
            },
        ),
        CodexThreadItem::CommandExecution {
            command, status, ..
        } => (
            "Command",
            format!(
                "{status:?}{progress_suffix}: {}",
                command.lines().next().unwrap_or("")
            ),
        ),
        CodexThreadItem::FileChange {
            changes, status, ..
        } => (
            "File change",
            format!("{status:?}{progress_suffix}: {} file(s)", changes.len()),
        ),
        CodexThreadItem::McpToolCall {
            server,
            tool,
            status,
            ..
        } => (
            "MCP tool call",
            format!("{status:?}{progress_suffix}: {server}::{tool}"),
        ),
        CodexThreadItem::WebSearch { query, .. } => (
            "Web search",
            format!(
                "{}{}",
                progress_suffix,
                if query.is_empty() { "" } else { ": " }
            ) + query,
        ),
        CodexThreadItem::TodoList { items, .. } => (
            "Todo list",
            format!("{progress_suffix}: {} item(s)", items.len()),
        ),
        CodexThreadItem::Error { message, .. } => ("Error", message.clone()),
    }
}

fn collapse_inline_markdown_for_summary(text: &str) -> String {
    text.replace("**", "")
        .replace("__", "")
        .replace("`", "")
        .replace('*', "")
        .trim()
        .to_owned()
}

fn codex_item_compact_summary(item: &CodexThreadItem) -> (&'static str, String) {
    match item {
        CodexThreadItem::AgentMessage { text, .. } => {
            ("Agent", text.lines().next().unwrap_or("").to_owned())
        }
        CodexThreadItem::Reasoning { text, .. } => {
            let summary = if text.trim().is_empty() {
                "…".to_owned()
            } else {
                collapse_inline_markdown_for_summary(text.lines().next().unwrap_or(""))
            };
            ("Thinking", summary)
        }
        CodexThreadItem::CommandExecution { command, .. } => {
            ("Bash", command.lines().next().unwrap_or("").to_owned())
        }
        CodexThreadItem::FileChange { changes, .. } => {
            ("Patch", format!("{} file(s)", changes.len()))
        }
        CodexThreadItem::McpToolCall { server, tool, .. } => ("MCP", format!("{server}::{tool}")),
        CodexThreadItem::WebSearch { query, .. } => ("Search", query.clone()),
        CodexThreadItem::TodoList { items, .. } => ("Todo", format!("{} item(s)", items.len())),
        CodexThreadItem::Error { message, .. } => ("Error", message.clone()),
    }
}

fn codex_item_icon_path(item: &CodexThreadItem) -> SharedString {
    match item {
        CodexThreadItem::AgentMessage { .. } => IconName::Bot.path(),
        CodexThreadItem::Reasoning { .. } => "icons/brain.svg".into(),
        CodexThreadItem::CommandExecution { .. } => IconName::SquareTerminal.path(),
        CodexThreadItem::FileChange { .. } => IconName::File.path(),
        CodexThreadItem::McpToolCall { .. } => IconName::Settings2.path(),
        CodexThreadItem::WebSearch { .. } => IconName::Globe.path(),
        CodexThreadItem::TodoList { .. } => IconName::Check.path(),
        CodexThreadItem::Error { .. } => IconName::TriangleAlert.path(),
    }
}

fn codex_item_is_tool_call(item: &CodexThreadItem) -> bool {
    matches!(
        item,
        CodexThreadItem::CommandExecution { .. }
            | CodexThreadItem::FileChange { .. }
            | CodexThreadItem::McpToolCall { .. }
            | CodexThreadItem::WebSearch { .. }
    )
}

fn render_turn_duration_row(
    theme: &gpui_component::Theme,
    elapsed: Duration,
    in_progress: bool,
) -> AnyElement {
    let icon = if in_progress {
        Spinner::new()
            .with_size(Size::Small)
            .color(theme.muted_foreground)
            .into_any_element()
    } else {
        Icon::empty()
            .path("icons/timer.svg")
            .with_size(Size::Small)
            .text_color(theme.muted_foreground)
            .into_any_element()
    };
    div()
        .h(px(24.0))
        .w_full()
        .px_2()
        .flex()
        .items_center()
        .gap_2()
        .text_color(theme.muted_foreground)
        .child(icon)
        .child(
            div()
                .flex_1()
                .truncate()
                .child(format_duration_compact(elapsed)),
        )
        .into_any_element()
}

fn format_duration_compact(duration: Duration) -> String {
    let ms = duration.as_millis() as u64;
    let secs = ms / 1000;

    if secs < 60 {
        let tenths = (ms % 1000) / 100;
        if secs == 0 && tenths == 0 {
            return "0.0s".to_owned();
        }
        return format!("{secs}.{tenths}s");
    }

    let mins = secs / 60;
    let rem_secs = secs % 60;
    if mins < 60 {
        return format!("{mins}m{rem_secs:02}s");
    }

    let hours = mins / 60;
    let rem_mins = mins % 60;
    format!("{hours}h{rem_mins:02}m")
}

fn workspace_context(state: &AppState, workspace_id: WorkspaceId) -> Option<(PathBuf, PathBuf)> {
    for project in &state.projects {
        for workspace in &project.workspaces {
            if workspace.id == workspace_id && workspace.status == WorkspaceStatus::Active {
                return Some((project.path.clone(), workspace.worktree_path.clone()));
            }
        }
    }
    None
}

struct WorkspaceAgentContext {
    project_slug: String,
    workspace_name: String,
    worktree_path: PathBuf,
}

fn workspace_agent_context(
    state: &AppState,
    workspace_id: WorkspaceId,
) -> Option<WorkspaceAgentContext> {
    for project in &state.projects {
        for workspace in &project.workspaces {
            if workspace.id == workspace_id && workspace.status == WorkspaceStatus::Active {
                return Some(WorkspaceAgentContext {
                    project_slug: project.slug.clone(),
                    workspace_name: workspace.workspace_name.clone(),
                    worktree_path: workspace.worktree_path.clone(),
                });
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{
        Modifiers, MouseButton, MouseDownEvent, ScrollDelta, ScrollWheelEvent, point, px, size,
    };
    use luban_domain::{
        ConversationEntry, ConversationSnapshot, CreatedWorkspace, PersistedAppState,
        PullRequestState,
    };
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;
    use std::sync::atomic::{AtomicUsize, Ordering};

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

    #[test]
    fn agent_turn_summary_uses_thinking_label_and_omits_messages() {
        let summary = format_agent_turn_summary(TurnSummaryCounts {
            tool_calls: 2,
            reasonings: 3,
        });
        assert_eq!(summary, "2 tool calls, 3 thinking");
        assert!(!summary.contains("message"));
        assert!(!summary.contains("reasoning"));
    }

    #[test]
    fn debug_layout_env_parsing() {
        assert!(!debug_layout::parse_enabled(None));
        assert!(!debug_layout::parse_enabled(Some("")));
        assert!(!debug_layout::parse_enabled(Some("0")));
        assert!(!debug_layout::parse_enabled(Some("false")));
        assert!(!debug_layout::parse_enabled(Some("off")));
        assert!(!debug_layout::parse_enabled(Some("no")));

        assert!(debug_layout::parse_enabled(Some("1")));
        assert!(debug_layout::parse_enabled(Some("true")));
        assert!(debug_layout::parse_enabled(Some("yes")));
        assert!(debug_layout::parse_enabled(Some("on")));

        assert!(debug_layout::parse_enabled(Some(" TRUE ")));
        assert!(debug_layout::parse_enabled(Some("Yes")));
        assert!(debug_layout::parse_enabled(Some("ON")));
    }

    #[gpui::test]
    async fn scroll_wheel_events_are_delivered(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let counter = Arc::new(AtomicUsize::new(0));

        struct TestView {
            counter: Arc<AtomicUsize>,
        }

        impl gpui::Render for TestView {
            fn render(
                &mut self,
                _window: &mut Window,
                _cx: &mut Context<Self>,
            ) -> impl IntoElement {
                let counter = self.counter.clone();
                div()
                    .flex_1()
                    .w_full()
                    .h_full()
                    .on_scroll_wheel(move |_, _, _app| {
                        counter.fetch_add(1, Ordering::SeqCst);
                    })
                    .child("scroll-target")
            }
        }

        let (_view, window_cx) = cx.add_window_view(|_, _cx| TestView {
            counter: counter.clone(),
        });
        window_cx.simulate_resize(size(px(200.0), px(200.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let position = point(px(100.0), px(100.0));
        window_cx.simulate_mouse_move(position, None, Modifiers::none());
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();
        window_cx.simulate_event(ScrollWheelEvent {
            position,
            delta: ScrollDelta::Pixels(point(px(0.0), px(30.0))),
            ..Default::default()
        });
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        assert!(
            counter.load(Ordering::SeqCst) > 0,
            "expected scroll wheel listener to fire at least once"
        );
    }

    #[derive(Default)]
    struct FakeService;

    impl ProjectWorkspaceService for FakeService {
        fn load_app_state(&self) -> Result<PersistedAppState, String> {
            Ok(PersistedAppState {
                projects: Vec::new(),
                sidebar_width: None,
                terminal_pane_width: None,
                last_open_workspace_id: None,
                workspace_chat_scroll_y10: HashMap::new(),
            })
        }

        fn save_app_state(&self, _snapshot: PersistedAppState) -> Result<(), String> {
            Ok(())
        }

        fn create_workspace(
            &self,
            _project_path: PathBuf,
            _project_slug: String,
        ) -> Result<CreatedWorkspace, String> {
            Ok(CreatedWorkspace {
                workspace_name: "abandon-about".to_owned(),
                branch_name: "luban/abandon-about".to_owned(),
                worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
            })
        }

        fn open_workspace_in_ide(&self, _worktree_path: PathBuf) -> Result<(), String> {
            Ok(())
        }

        fn archive_workspace(
            &self,
            _project_path: PathBuf,
            _worktree_path: PathBuf,
        ) -> Result<(), String> {
            Ok(())
        }

        fn ensure_conversation(
            &self,
            _project_slug: String,
            _workspace_name: String,
        ) -> Result<(), String> {
            Ok(())
        }

        fn load_conversation(
            &self,
            _project_slug: String,
            _workspace_name: String,
        ) -> Result<ConversationSnapshot, String> {
            Ok(ConversationSnapshot {
                thread_id: None,
                entries: Vec::new(),
            })
        }

        fn store_context_image(
            &self,
            _project_slug: String,
            _workspace_name: String,
            image: luban_domain::ContextImage,
        ) -> Result<PathBuf, String> {
            Ok(PathBuf::from(format!(
                "/tmp/luban/context/{}.{}",
                image.bytes.len(),
                image.extension
            )))
        }

        fn store_context_text(
            &self,
            _project_slug: String,
            _workspace_name: String,
            text: String,
            extension: String,
        ) -> Result<PathBuf, String> {
            Ok(PathBuf::from(format!(
                "/tmp/luban/context/{}.{}",
                text.len(),
                extension
            )))
        }

        fn store_context_file(
            &self,
            _project_slug: String,
            _workspace_name: String,
            source_path: PathBuf,
        ) -> Result<PathBuf, String> {
            Ok(source_path)
        }

        fn run_agent_turn_streamed(
            &self,
            request: RunAgentTurnRequest,
            _cancel: Arc<AtomicBool>,
            on_event: Arc<dyn Fn(CodexThreadEvent) + Send + Sync>,
        ) -> Result<(), String> {
            let thread_id = request.thread_id.unwrap_or_else(|| "thread-1".to_owned());
            on_event(CodexThreadEvent::ThreadStarted {
                thread_id: thread_id.clone(),
            });
            on_event(CodexThreadEvent::ItemStarted {
                item: CodexThreadItem::CommandExecution {
                    id: "cmd-1".to_owned(),
                    command: "echo hello".to_owned(),
                    aggregated_output: "".to_owned(),
                    exit_code: None,
                    status: luban_domain::CodexCommandExecutionStatus::InProgress,
                },
            });
            on_event(CodexThreadEvent::ItemCompleted {
                item: CodexThreadItem::AgentMessage {
                    id: "item-1".to_owned(),
                    text: format!("Echo: {}", request.prompt),
                },
            });
            on_event(CodexThreadEvent::TurnCompleted {
                usage: luban_domain::CodexUsage {
                    input_tokens: 1,
                    cached_input_tokens: 0,
                    output_tokens: 1,
                },
            });
            Ok(())
        }

        fn gh_is_authorized(&self) -> Result<bool, String> {
            Ok(false)
        }

        fn gh_pull_request_info(
            &self,
            _worktree_path: PathBuf,
        ) -> Result<Option<PullRequestInfo>, String> {
            Ok(None)
        }
    }

    #[test]
    fn compact_item_summary_is_stable() {
        let item = CodexThreadItem::CommandExecution {
            id: "cmd-1".to_owned(),
            command: "echo hello\necho world".to_owned(),
            aggregated_output: String::new(),
            exit_code: None,
            status: luban_domain::CodexCommandExecutionStatus::InProgress,
        };
        assert_eq!(
            codex_item_compact_summary(&item),
            ("Bash", "echo hello".to_owned())
        );

        let item = CodexThreadItem::Reasoning {
            id: "r-1".to_owned(),
            text: "\n".to_owned(),
        };
        assert_eq!(
            codex_item_compact_summary(&item),
            ("Thinking", "…".to_owned())
        );
    }

    #[test]
    fn codex_item_icon_paths_are_stable() {
        let item = CodexThreadItem::Reasoning {
            id: "r-1".to_owned(),
            text: "x".to_owned(),
        };
        assert_eq!(codex_item_icon_path(&item).as_ref(), "icons/brain.svg");
    }

    #[test]
    fn duration_format_is_compact() {
        assert_eq!(
            format_duration_compact(Duration::from_millis(1234)),
            "1.2s".to_owned()
        );
        assert_eq!(
            format_duration_compact(Duration::from_secs(62)),
            "1m02s".to_owned()
        );
    }

    #[test]
    fn main_pane_title_tracks_selected_context() {
        let mut state = AppState::new();
        assert_eq!(main_pane_title(&state, MainPane::None), String::new());

        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        let project_name = state.projects[0].name.clone();

        assert_eq!(
            main_pane_title(&state, MainPane::ProjectSettings(project_id)),
            project_name
        );

        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "luban/abandon-about".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");

        assert_eq!(
            main_pane_title(&state, MainPane::Workspace(workspace_id)),
            "abandon-about".to_owned()
        );
    }

    #[test]
    fn sidebar_workspace_title_uses_branch_name() {
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

        let workspace = state
            .projects
            .iter()
            .flat_map(|p| &p.workspaces)
            .find(|w| w.status == WorkspaceStatus::Active && w.workspace_name == "w1")
            .expect("missing workspace w1");

        assert_eq!(
            sidebar::sidebar_workspace_title(workspace),
            "repo/w1".to_owned()
        );
    }

    #[test]
    fn sidebar_workspace_metadata_uses_workspace_name() {
        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project = &state.projects[0];
        let workspace = project
            .workspaces
            .iter()
            .find(|w| w.status == WorkspaceStatus::Active && w.worktree_path == project.path)
            .expect("missing main workspace");

        assert_eq!(
            sidebar::sidebar_workspace_metadata(workspace),
            "main".to_owned()
        );
    }

    #[test]
    fn titlebar_context_tracks_selected_workspace() {
        let mut state = AppState::new();
        assert_eq!(
            titlebar::titlebar_context(&state),
            titlebar::TitlebarContext {
                branch_label: String::new(),
                ide_workspace_id: None,
            }
        );

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

        let context = titlebar::titlebar_context(&state);
        assert_eq!(context.branch_label, "luban/abandon-about".to_owned());
        assert_eq!(context.ide_workspace_id, Some(workspace_id));
    }

    #[gpui::test]
    async fn titlebar_buttons_keep_terminal_toggle_on_far_right(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "b".repeat(256),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");
        state.apply(Action::OpenWorkspace { workspace_id });

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        let window_size = size(px(900.0), px(240.0));
        window_cx.simulate_resize(window_size);
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let toggle_bounds = window_cx
            .debug_bounds("titlebar-toggle-terminal")
            .expect("missing titlebar terminal toggle button");

        assert!(
            toggle_bounds.right() >= window_size.width - px(24.0),
            "toggle={:?} window={:?}",
            toggle_bounds,
            window_size
        );
    }

    #[gpui::test]
    async fn terminal_title_is_rendered_in_titlebar_when_visible(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "repo/branch".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");
        state.main_pane = MainPane::Workspace(workspace_id);
        state.right_pane = RightPane::Terminal;

        let (view, window_cx) = cx.add_window_view(|_window, cx| {
            let mut view = LubanRootView::with_state(services, state, cx);
            view.terminal_enabled = true;
            view.workspace_terminal_errors
                .insert(workspace_id, "stub terminal".to_owned());
            view
        });
        window_cx.simulate_resize(size(px(900.0), px(240.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        assert!(
            window_cx.debug_bounds("titlebar-terminal").is_some(),
            "expected terminal header to be rendered in titlebar"
        );
        assert!(
            window_cx
                .debug_bounds("titlebar-terminal-divider")
                .is_some(),
            "expected divider to be rendered when terminal is visible"
        );
        let divider = window_cx
            .debug_bounds("titlebar-terminal-divider")
            .expect("missing divider bounds");
        assert!(
            divider.size.width >= px(0.9),
            "expected divider to be visible: {divider:?}"
        );

        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                view.dispatch(Action::ToggleTerminalPane, cx);
            });
        });
        for _ in 0..3 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }
        let right_pane = view.read_with(window_cx, |v, _| v.debug_state().right_pane);
        assert_eq!(right_pane, RightPane::None);
        let divider = window_cx
            .debug_bounds("titlebar-terminal-divider")
            .expect("missing divider bounds after collapse");
        assert!(
            divider.size.width <= px(0.1),
            "expected divider to be hidden when terminal is collapsed: {divider:?}"
        );
    }

    #[gpui::test]
    async fn titlebar_workspace_title_does_not_render_prefix_icon(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "repo/branch".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");
        state.apply(Action::OpenWorkspace { workspace_id });

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(900.0), px(240.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        assert!(
            window_cx.debug_bounds("titlebar-branch-symbol").is_none(),
            "expected titlebar to avoid rendering a prefix icon"
        );
        assert!(
            window_cx
                .debug_bounds("titlebar-branch-indicator")
                .is_some(),
            "expected titlebar workspace title to remain rendered"
        );
    }

    #[gpui::test]
    async fn titlebar_double_click_triggers_window_action(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);
        let state = AppState::new();

        let (_view, window_cx) =
            cx.add_window_view(|_window, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(900.0), px(240.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let zoom_bounds = window_cx
            .debug_bounds("titlebar-zoom-area")
            .expect("missing titlebar zoom area");

        assert!(
            !window_cx.update(|window, _| window.is_fullscreen()),
            "expected test window to start not fullscreen"
        );

        window_cx.simulate_event(MouseDownEvent {
            position: zoom_bounds.center(),
            modifiers: Modifiers::none(),
            button: MouseButton::Left,
            click_count: 1,
            first_mouse: false,
        });
        assert!(
            !window_cx.update(|window, _| window.is_fullscreen()),
            "single click should not trigger titlebar double-click action"
        );

        window_cx.simulate_event(MouseDownEvent {
            position: zoom_bounds.center(),
            modifiers: Modifiers::none(),
            button: MouseButton::Left,
            click_count: 2,
            first_mouse: false,
        });
        assert!(
            window_cx.update(|window, _| window.is_fullscreen()),
            "double click should trigger titlebar double-click action"
        );
    }

    #[gpui::test]
    async fn open_button_is_in_titlebar_for_workspace(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(900.0), px(240.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        assert!(
            window_cx.debug_bounds("workspace-pane-header").is_none(),
            "workspace header should not be rendered when controls are in titlebar"
        );

        let titlebar_bounds = window_cx
            .debug_bounds("titlebar-main")
            .expect("missing titlebar main segment");
        let title_bounds = window_cx
            .debug_bounds("titlebar-branch-indicator")
            .expect("missing titlebar branch indicator");
        let open_bounds = window_cx
            .debug_bounds("titlebar-open-in-zed")
            .expect("missing titlebar open button");

        let gap = open_bounds.left() - title_bounds.right();
        assert!(
            gap >= px(-1.0) && gap <= px(32.0),
            "open should be placed next to the workspace title: gap={gap:?} title={title_bounds:?} open={open_bounds:?}",
        );
        assert!(
            open_bounds.right() <= titlebar_bounds.right() + px(2.0),
            "open={:?} titlebar={:?}",
            open_bounds,
            titlebar_bounds
        );
    }

    #[gpui::test]
    async fn clicking_project_header_toggles_expanded(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::ToggleProjectExpanded { project_id });

        let (view, cx) = cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        cx.refresh().unwrap();

        let bounds = cx
            .debug_bounds("project-header-0")
            .expect("missing debug bounds for project-header-0");
        cx.simulate_click(bounds.center(), Modifiers::none());
        cx.refresh().unwrap();

        let expanded = view.read_with(cx, |v, _| v.debug_state().projects[0].expanded);
        assert!(!expanded);
    }

    #[gpui::test]
    async fn main_workspace_row_is_rendered_and_is_not_archivable(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::ToggleProjectExpanded { project_id });

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(900.0), px(240.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let main_bounds = window_cx
            .debug_bounds("workspace-main-row-0")
            .expect("missing main workspace row");
        assert!(
            window_cx.debug_bounds("workspace-main-badge-0").is_none(),
            "main workspace should not render a separate badge label"
        );
        assert!(
            window_cx.debug_bounds("workspace-main-icon-0").is_some(),
            "main workspace should render a leading icon"
        );
        assert!(
            window_cx.debug_bounds("workspace-row-0-0").is_none(),
            "main workspace should not be rendered as a normal workspace row"
        );
        assert!(
            window_cx.debug_bounds("workspace-archive-0-0").is_none(),
            "main workspace should not be archivable"
        );

        let main_workspace_id =
            view.read_with(window_cx, |v, _| main_workspace_id(v.debug_state()));

        window_cx.simulate_click(main_bounds.center(), Modifiers::none());
        window_cx.refresh().unwrap();

        let selected = view.read_with(window_cx, |v, _| v.debug_state().main_pane);
        assert!(
            matches!(selected, MainPane::Workspace(id) if id == main_workspace_id),
            "expected main workspace to be selected after click"
        );
    }

    #[gpui::test]
    async fn archiving_workspace_shows_prompt_and_updates_state(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::ToggleProjectExpanded { project_id });
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "luban/abandon-about".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });

        let (view, cx) = cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        cx.refresh().unwrap();

        let row_bounds = cx
            .debug_bounds("workspace-row-0-0")
            .expect("missing debug bounds for workspace-row-0-0");
        cx.simulate_mouse_move(row_bounds.center(), None, Modifiers::none());
        cx.refresh().unwrap();

        let bounds = cx
            .debug_bounds("workspace-archive-0-0")
            .expect("missing debug bounds for workspace-archive-0-0");
        cx.simulate_click(bounds.center(), Modifiers::none());
        assert!(cx.has_pending_prompt());
        cx.simulate_prompt_answer("Cancel");
        cx.run_until_parked();
        cx.refresh().unwrap();

        let status = view.read_with(cx, |v, _| {
            v.debug_state().projects[0]
                .workspaces
                .iter()
                .find(|w| w.workspace_name == "abandon-about")
                .expect("missing abandon-about workspace")
                .status
        });
        assert_eq!(status, WorkspaceStatus::Active);

        let row_bounds = cx
            .debug_bounds("workspace-row-0-0")
            .expect("missing debug bounds for workspace-row-0-0");
        cx.simulate_mouse_move(row_bounds.center(), None, Modifiers::none());
        cx.refresh().unwrap();

        let bounds = cx
            .debug_bounds("workspace-archive-0-0")
            .expect("missing debug bounds for workspace-archive-0-0");
        cx.simulate_click(bounds.center(), Modifiers::none());
        assert!(cx.has_pending_prompt());
        cx.simulate_prompt_answer("Archive");
        cx.run_until_parked();
        cx.refresh().unwrap();

        let status = view.read_with(cx, |v, _| {
            v.debug_state().projects[0]
                .workspaces
                .iter()
                .find(|w| w.workspace_name == "abandon-about")
                .expect("missing abandon-about workspace")
                .status
        });
        assert_eq!(status, WorkspaceStatus::Archived);
    }

    #[gpui::test]
    async fn markdown_messages_render_in_workspace(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![
                    ConversationEntry::UserMessage {
                        text: "Hello **world**\n\n- a\n- b\n\n`inline`".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "item-1".to_owned(),
                            text: "Reply:\n\n- one\n- two\n\n[gpui](https://example.com)"
                                .to_owned(),
                        }),
                    },
                ],
            },
        });

        let (_, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.refresh().unwrap();

        let bounds = window_cx
            .debug_bounds("conversation-agent-message-agent-turn-0-item-1")
            .expect("missing debug bounds for conversation-agent-message-agent-turn-0-item-1");
        assert!(bounds.size.height > px(0.0));
    }

    #[gpui::test]
    async fn duplicate_agent_message_ids_render_independently(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![
                    ConversationEntry::UserMessage {
                        text: "First".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "item-1".to_owned(),
                            text: "First reply".to_owned(),
                        }),
                    },
                    ConversationEntry::UserMessage {
                        text: "Second".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "item-1".to_owned(),
                            text: "Second reply".to_owned(),
                        }),
                    },
                ],
            },
        });

        let (_, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.refresh().unwrap();

        let first = window_cx
            .debug_bounds("conversation-agent-message-agent-turn-0-item-1")
            .expect("missing debug bounds for conversation-agent-message-agent-turn-0-item-1");
        let second = window_cx
            .debug_bounds("conversation-agent-message-agent-turn-1-item-1")
            .expect("missing debug bounds for conversation-agent-message-agent-turn-1-item-1");

        assert!(first.size.height > px(0.0));
        assert!(second.size.height > px(0.0));
        assert!(second.top() > first.top());
    }

    #[gpui::test]
    async fn clicking_turn_summary_row_toggles_expanded(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![
                    ConversationEntry::UserMessage {
                        text: "Test".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::CommandExecution {
                            id: "item-1".to_owned(),
                            command: "echo hello".to_owned(),
                            aggregated_output: "hello".to_owned(),
                            exit_code: Some(0),
                            status: luban_domain::CodexCommandExecutionStatus::Completed,
                        }),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "item-2".to_owned(),
                            text: "Reply".to_owned(),
                        }),
                    },
                ],
            },
        });

        let (view, cx) = cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        cx.refresh().unwrap();

        let expanded = view.read_with(cx, |v, _| v.expanded_agent_turns.contains("agent-turn-0"));
        assert!(!expanded);

        let row_bounds = cx
            .debug_bounds("agent-turn-summary-agent-turn-0")
            .expect("missing debug bounds for agent-turn-summary-agent-turn-0");
        cx.simulate_click(row_bounds.center(), Modifiers::none());
        cx.refresh().unwrap();

        let expanded = view.read_with(cx, |v, _| v.expanded_agent_turns.contains("agent-turn-0"));
        assert!(expanded);
    }

    #[gpui::test]
    async fn clicking_turn_item_summary_row_toggles_expanded(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![
                    ConversationEntry::UserMessage {
                        text: "Test".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::Reasoning {
                            id: "item-1".to_owned(),
                            text: "Reasoning details".to_owned(),
                        }),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "item-2".to_owned(),
                            text: "Reply".to_owned(),
                        }),
                    },
                ],
            },
        });

        let (view, cx) = cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        cx.refresh().unwrap();

        let row_bounds = cx
            .debug_bounds("agent-turn-summary-agent-turn-0")
            .expect("missing debug bounds for agent-turn-summary-agent-turn-0");
        cx.simulate_click(row_bounds.center(), Modifiers::none());
        cx.refresh().unwrap();

        let expanded = view.read_with(cx, |v, _| v.expanded_agent_turns.contains("agent-turn-0"));
        assert!(expanded);

        let item_bounds = cx
            .debug_bounds("agent-turn-item-summary-agent-turn-0-item-1")
            .expect("missing debug bounds for agent-turn-item-summary-agent-turn-0-item-1");
        cx.simulate_click(item_bounds.center(), Modifiers::none());
        cx.refresh().unwrap();

        let expanded = view.read_with(cx, |v, _| {
            v.expanded_agent_items.contains("agent-turn-0::item-1")
        });
        assert!(expanded);
    }

    #[gpui::test]
    async fn running_turn_summary_is_expanded_and_not_toggleable(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Test".to_owned(),
        });
        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::ItemStarted {
                item: CodexThreadItem::Reasoning {
                    id: "item-1".to_owned(),
                    text: "x".to_owned(),
                },
            },
        });

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.refresh().unwrap();

        window_cx
            .debug_bounds("agent-turn-summary-agent-turn-0")
            .expect("missing running turn summary row");
        window_cx
            .debug_bounds("agent-turn-item-summary-agent-turn-0-item-1")
            .expect("missing running summary item row");

        let expanded = view.read_with(window_cx, |v, _| {
            v.expanded_agent_turns.contains("agent-turn-0")
        });
        assert!(!expanded);

        let header_bounds = window_cx
            .debug_bounds("agent-turn-summary-agent-turn-0")
            .expect("missing running turn summary row");
        window_cx.simulate_click(header_bounds.center(), Modifiers::none());
        window_cx.refresh().unwrap();

        let expanded = view.read_with(window_cx, |v, _| {
            v.expanded_agent_turns.contains("agent-turn-0")
        });
        assert!(!expanded);

        window_cx
            .debug_bounds("agent-turn-item-summary-agent-turn-0-item-1")
            .expect("missing running summary item row after click");
    }

    #[gpui::test]
    async fn running_turn_summary_keeps_completed_items_visible_while_running(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Test".to_owned(),
        });
        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::ItemStarted {
                item: CodexThreadItem::Reasoning {
                    id: "item-1".to_owned(),
                    text: "x".to_owned(),
                },
            },
        });

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.refresh().unwrap();

        window_cx
            .debug_bounds("agent-turn-item-summary-agent-turn-0-item-1")
            .expect("missing running summary item row");

        view.update(window_cx, |view, cx| {
            view.dispatch(
                Action::AgentEventReceived {
                    workspace_id,
                    event: CodexThreadEvent::ItemCompleted {
                        item: CodexThreadItem::Reasoning {
                            id: "item-1".to_owned(),
                            text: "final".to_owned(),
                        },
                    },
                },
                cx,
            );
        });
        window_cx.refresh().unwrap();

        window_cx
            .debug_bounds("agent-turn-item-summary-agent-turn-0-item-1")
            .expect("missing completed summary item row while running");
    }

    #[gpui::test]
    async fn running_turn_summary_auto_collapses_on_turn_end(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Test".to_owned(),
        });

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.refresh().unwrap();

        view.update(window_cx, |view, cx| {
            view.expanded_agent_turns.insert("agent-turn-0".to_owned());
            view.expanded_agent_items
                .insert("agent-turn-0::item-1".to_owned());
            view.dispatch(
                Action::AgentEventReceived {
                    workspace_id,
                    event: CodexThreadEvent::TurnCompleted {
                        usage: luban_domain::CodexUsage {
                            input_tokens: 0,
                            cached_input_tokens: 0,
                            output_tokens: 0,
                        },
                    },
                },
                cx,
            );
        });
        window_cx.refresh().unwrap();

        let expanded = view.read_with(window_cx, |v, _| {
            v.expanded_agent_turns.contains("agent-turn-0")
        });
        assert!(!expanded);

        let item_expanded = view.read_with(window_cx, |v, _| {
            v.expanded_agent_items.contains("agent-turn-0::item-1")
        });
        assert!(!item_expanded);

        assert!(
            window_cx
                .debug_bounds("agent-turn-item-summary-agent-turn-0-item-1")
                .is_none()
        );
    }

    #[gpui::test]
    async fn turn_summary_includes_error_items(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![
                    ConversationEntry::UserMessage {
                        text: "Test".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::Error {
                            id: "err-1".to_owned(),
                            message: "reconnecting ...1/5".to_owned(),
                        }),
                    },
                ],
            },
        });

        let (view, cx) = cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        cx.refresh().unwrap();

        let row_bounds = cx
            .debug_bounds("agent-turn-summary-agent-turn-0")
            .expect("missing debug bounds for agent-turn-summary-agent-turn-0");
        cx.simulate_click(row_bounds.center(), Modifiers::none());
        cx.refresh().unwrap();

        let expanded = view.read_with(cx, |v, _| v.expanded_agent_turns.contains("agent-turn-0"));
        assert!(expanded);

        let _ = cx
            .debug_bounds("agent-turn-item-summary-agent-turn-0-err-1")
            .expect("missing debug bounds for agent-turn-item-summary-agent-turn-0-err-1");
    }

    #[gpui::test]
    async fn user_message_context_attachments_render_in_order(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        let message = concat!(
            "hello\n",
            "<<context:text:/tmp/a.txt>>>\n",
            "world\n",
            "<<context:text:/tmp/b.txt>>>\n"
        );

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: None,
                entries: vec![ConversationEntry::UserMessage {
                    text: message.to_owned(),
                }],
            },
        });

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.refresh().unwrap();

        let first = window_cx
            .debug_bounds("conversation-user-attachment-0-0")
            .expect("missing first attachment");
        let second = window_cx
            .debug_bounds("conversation-user-attachment-0-1")
            .expect("missing second attachment");

        assert!(
            first.origin.y < second.origin.y,
            "expected first attachment to be above second"
        );
    }

    #[gpui::test]
    async fn user_message_reflows_on_window_resize(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        let long_text = std::iter::repeat_n("word", 200)
            .collect::<Vec<_>>()
            .join(" ");
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage { text: long_text }],
            },
        });

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));

        window_cx.simulate_resize(size(px(1200.0), px(800.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();
        let wide_column = window_cx
            .debug_bounds("workspace-chat-column")
            .expect("missing debug bounds for workspace-chat-column");
        let wide_bubble = window_cx
            .debug_bounds("conversation-user-bubble-0")
            .expect("missing debug bounds for conversation-user-bubble-0");

        window_cx.simulate_resize(size(px(520.0), px(800.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();
        let narrow_column = window_cx
            .debug_bounds("workspace-chat-column")
            .expect("missing debug bounds for workspace-chat-column");
        let narrow_bubble = window_cx
            .debug_bounds("conversation-user-bubble-0")
            .expect("missing debug bounds for conversation-user-bubble-0");

        assert!(narrow_column.size.width < wide_column.size.width);
        assert!(
            narrow_bubble.size.height > wide_bubble.size.height,
            "wide={:?} narrow={:?}",
            wide_bubble.size,
            narrow_bubble.size
        );
        assert!(narrow_bubble.right() <= narrow_column.right() + px(2.0));
        assert!(narrow_bubble.right() >= narrow_column.right() - px(8.0));
    }

    #[gpui::test]
    async fn user_message_text_can_be_selected_and_copied(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        let message = "select me".to_owned();
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: message.clone(),
                }],
            },
        });

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(720.0), px(400.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let text_bounds = window_cx
            .debug_bounds("user-message-0-plain-text")
            .expect("missing debug bounds for user-message-0-plain-text");
        let y = text_bounds.center().y;
        let start = point(text_bounds.left() + px(1.0), y);
        let end = point(text_bounds.right() + px(200.0), y);

        window_cx.simulate_mouse_down(start, gpui::MouseButton::Left, Modifiers::none());
        window_cx.simulate_mouse_move(end, Some(gpui::MouseButton::Left), Modifiers::none());
        window_cx.simulate_mouse_up(end, gpui::MouseButton::Left, Modifiers::none());
        window_cx.refresh().unwrap();

        window_cx.simulate_keystrokes("cmd-c");
        window_cx.run_until_parked();

        let copied = window_cx.read_from_clipboard().and_then(|item| item.text());
        assert_eq!(copied, Some(message));
    }

    #[gpui::test]
    async fn chat_composer_is_visible_in_workspace(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: "Test".to_owned(),
                }],
            },
        });

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(720.0), px(400.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        window_cx
            .debug_bounds("chat-send-message")
            .expect("missing chat composer send button");
    }

    #[gpui::test]
    async fn chat_composer_renders_model_and_effort_selectors(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: "Test".to_owned(),
                }],
            },
        });

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(720.0), px(400.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        window_cx
            .debug_bounds("chat-model-selector")
            .expect("missing chat model selector");
        window_cx
            .debug_bounds("chat-thinking-effort-selector")
            .expect("missing chat thinking effort selector");

        let surface_bounds = window_cx
            .debug_bounds("chat-composer-surface")
            .expect("missing chat composer surface");
        let model_bounds = window_cx
            .debug_bounds("chat-model-selector")
            .expect("missing chat model selector");
        let send_bounds = window_cx
            .debug_bounds("chat-send-message")
            .expect("missing chat composer send button");

        let left_inset = model_bounds.left() - surface_bounds.left();
        let right_inset = surface_bounds.right() - send_bounds.right();
        assert!(
            left_inset >= px(18.0) && left_inset <= px(28.0),
            "unexpected chat composer inset: left={left_inset:?} surface={surface_bounds:?} model={model_bounds:?}",
        );
        let inset_diff = if left_inset > right_inset {
            left_inset - right_inset
        } else {
            right_inset - left_inset
        };
        assert!(
            inset_diff <= px(4.0),
            "expected symmetric insets: left={left_inset:?} right={right_inset:?} diff={inset_diff:?}",
        );
    }

    #[gpui::test]
    async fn chat_composer_renders_attachments_inside_surface_in_order(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: "Test".to_owned(),
                }],
            },
        });

        state.apply(Action::ChatDraftAttachmentAdded {
            workspace_id,
            id: 1,
            kind: luban_domain::ContextTokenKind::Image,
            anchor: 8,
        });
        state.apply(Action::ChatDraftAttachmentResolved {
            workspace_id,
            id: 1,
            path: PathBuf::from("/tmp/missing.png"),
        });
        state.apply(Action::ChatDraftAttachmentAdded {
            workspace_id,
            id: 2,
            kind: luban_domain::ContextTokenKind::Text,
            anchor: 0,
        });
        state.apply(Action::ChatDraftAttachmentResolved {
            workspace_id,
            id: 2,
            path: PathBuf::from("/tmp/missing.txt"),
        });

        state.apply(Action::ChatDraftChanged {
            workspace_id,
            text: "Hello world".to_owned(),
        });

        let (_view, window_cx) = cx.add_window_view(|window, cx| {
            let view = cx.new(|cx| LubanRootView::with_state(services, state, cx));
            gpui_component::Root::new(view, window, cx)
        });
        window_cx.simulate_resize(size(px(720.0), px(420.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let surface = window_cx
            .debug_bounds("chat-composer-surface")
            .expect("missing chat composer surface");
        let attachments_row = window_cx
            .debug_bounds("chat-composer-attachments-row")
            .expect("missing chat composer attachments row");
        let input = window_cx
            .debug_bounds("chat-composer-input")
            .expect("missing chat composer input");
        let first = window_cx
            .debug_bounds("chat-composer-attachment-2")
            .expect("missing first attachment item");
        let second = window_cx
            .debug_bounds("chat-composer-attachment-1")
            .expect("missing second attachment item");

        assert!(
            first.top() >= surface.top() && first.bottom() <= surface.bottom(),
            "expected attachment to render inside composer surface: surface={surface:?} first={first:?}",
        );
        assert!(
            first.left() < second.left(),
            "expected attachments to render in anchor order: first={first:?} second={second:?}"
        );

        let top_inset = first.top() - surface.top();
        assert!(
            top_inset >= px(8.0),
            "expected attachment thumbnails to be inset from surface top: inset={top_inset:?} surface={surface:?} first={first:?}",
        );

        let gap_to_input = input.top() - first.bottom();
        assert!(
            gap_to_input >= px(10.0),
            "expected visible spacing between attachment thumbnails and input: gap={gap_to_input:?} first={first:?} input={input:?}",
        );

        let row_to_input_gap = input.top() - attachments_row.bottom();
        assert!(
            row_to_input_gap >= px(6.0),
            "expected attachment row to be separated from input: gap={row_to_input_gap:?} row={attachments_row:?} input={input:?}",
        );
    }

    #[gpui::test]
    async fn chat_composer_can_send_attachments_without_text(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: Vec::new(),
            },
        });
        state.apply(Action::ChatDraftAttachmentAdded {
            workspace_id,
            id: 1,
            kind: luban_domain::ContextTokenKind::Image,
            anchor: 0,
        });
        state.apply(Action::ChatDraftAttachmentResolved {
            workspace_id,
            id: 1,
            path: PathBuf::from("/tmp/a.png"),
        });
        state.apply(Action::ChatDraftAttachmentAdded {
            workspace_id,
            id: 2,
            kind: luban_domain::ContextTokenKind::Text,
            anchor: 0,
        });
        state.apply(Action::ChatDraftAttachmentResolved {
            workspace_id,
            id: 2,
            path: PathBuf::from("/tmp/b.txt"),
        });
        state.apply(Action::ChatDraftChanged {
            workspace_id,
            text: String::new(),
        });

        let view_slot: Arc<std::sync::Mutex<Option<gpui::Entity<LubanRootView>>>> =
            Arc::new(std::sync::Mutex::new(None));
        let view_slot_for_window = view_slot.clone();

        let (_, window_cx) = cx.add_window_view(|window, cx| {
            let view = cx.new(|cx| LubanRootView::with_state(services, state, cx));
            *view_slot_for_window.lock().expect("poisoned mutex") = Some(view.clone());
            gpui_component::Root::new(view, window, cx)
        });
        let view = view_slot
            .lock()
            .expect("poisoned mutex")
            .clone()
            .expect("missing view handle");

        window_cx.simulate_resize(size(px(720.0), px(420.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let send_bounds = window_cx
            .debug_bounds("chat-send-message")
            .expect("missing chat send button");
        window_cx.simulate_click(send_bounds.center(), Modifiers::none());
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let attachment_count = view.read_with(window_cx, |view, _| {
            view.debug_state()
                .workspace_conversation(workspace_id)
                .map(|c| c.draft_attachments.len())
                .unwrap_or(0)
        });
        assert_eq!(
            attachment_count, 0,
            "expected attachments to be cleared in state"
        );

        // `debug_bounds` can retain the last known bounds for removed elements. Prefer asserting on
        // state-level invariants for this behavior.

        let (entries, entries_len) = view.read_with(window_cx, |view, _| {
            let Some(conversation) = view.debug_state().workspace_conversation(workspace_id) else {
                return (Vec::new(), 0);
            };
            (conversation.entries.clone(), conversation.entries.len())
        });
        let last_user = entries.iter().rev().find_map(|entry| {
            let luban_domain::ConversationEntry::UserMessage { text } = entry else {
                return None;
            };
            Some(text.clone())
        });
        let expected = format!(
            "{}\n{}",
            context_token("image", "/tmp/a.png"),
            context_token("text", "/tmp/b.txt")
        );
        assert_eq!(
            last_user.as_deref(),
            Some(expected.as_str()),
            "expected latest user message to match (entries_len={entries_len})"
        );
    }

    #[gpui::test]
    async fn chat_composer_inserts_attachments_at_anchor_positions(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: Vec::new(),
            },
        });
        state.apply(Action::ChatDraftChanged {
            workspace_id,
            text: "HelloWorld".to_owned(),
        });
        state.apply(Action::ChatDraftAttachmentAdded {
            workspace_id,
            id: 1,
            kind: luban_domain::ContextTokenKind::Image,
            anchor: 5,
        });
        state.apply(Action::ChatDraftAttachmentResolved {
            workspace_id,
            id: 1,
            path: PathBuf::from("/tmp/a.png"),
        });

        let view_slot: Arc<std::sync::Mutex<Option<gpui::Entity<LubanRootView>>>> =
            Arc::new(std::sync::Mutex::new(None));
        let view_slot_for_window = view_slot.clone();

        let (_, window_cx) = cx.add_window_view(|window, cx| {
            let view = cx.new(|cx| LubanRootView::with_state(services, state, cx));
            *view_slot_for_window.lock().expect("poisoned mutex") = Some(view.clone());
            gpui_component::Root::new(view, window, cx)
        });
        let view = view_slot
            .lock()
            .expect("poisoned mutex")
            .clone()
            .expect("missing view handle");

        window_cx.simulate_resize(size(px(720.0), px(420.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let send_bounds = window_cx
            .debug_bounds("chat-send-message")
            .expect("missing chat send button");
        window_cx.simulate_click(send_bounds.center(), Modifiers::none());
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let last_user = view.read_with(window_cx, |view, _| {
            let conversation = view
                .debug_state()
                .workspace_conversation(workspace_id)
                .expect("missing conversation");
            conversation.entries.iter().rev().find_map(|entry| {
                let luban_domain::ConversationEntry::UserMessage { text } = entry else {
                    return None;
                };
                Some(text.clone())
            })
        });

        let expected = format!("Hello\n{}\nWorld", context_token("image", "/tmp/a.png"));
        assert_eq!(last_user.as_deref(), Some(expected.as_str()));
    }

    #[gpui::test]
    async fn user_messages_render_context_tokens_in_order(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: format!(
                        "before\n{}\nafter",
                        context_token("image", "/tmp/missing.png")
                    ),
                }],
            },
        });

        let (_view, window_cx) = cx.add_window_view(|window, cx| {
            let view = cx.new(|cx| LubanRootView::with_state(services, state, cx));
            gpui_component::Root::new(view, window, cx)
        });
        window_cx.simulate_resize(size(px(720.0), px(480.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let before = window_cx
            .debug_bounds("user-message-0-seg-0-plain-text")
            .expect("missing message segment before token");
        let attachment = window_cx
            .debug_bounds("conversation-user-attachment-0-0")
            .expect("missing attachment element");
        let after = window_cx
            .debug_bounds("user-message-0-tail-plain-text")
            .expect("missing message segment after token");

        assert!(
            before.top() < attachment.top() && attachment.top() < after.top(),
            "expected segments and token to render in order: before={before:?} attachment={attachment:?} after={after:?}",
        );
    }

    #[gpui::test]
    async fn chat_composer_remains_visible_with_long_history(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        let long_markdownish = std::iter::repeat_n(
            "- A very long bullet line that should wrap and force the history to overflow and scroll.\n",
            40,
        )
        .collect::<String>();

        let mut entries = Vec::new();
        for i in 0..12 {
            entries.push(ConversationEntry::UserMessage {
                text: format!("message {i} {long_markdownish}"),
            });
            entries.push(ConversationEntry::TurnDuration { duration_ms: 1000 });
        }

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries,
            },
        });

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        for _ in 0..3 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let send_bounds = window_cx
            .debug_bounds("chat-send-message")
            .expect("missing chat composer send button");
        let main_bounds = window_cx
            .debug_bounds("main-pane")
            .expect("missing debug bounds for main-pane");
        assert!(send_bounds.size.height > px(0.0));
        assert!(
            main_bounds.bottom() <= px(720.0) + px(1.0),
            "main={:?}",
            main_bounds
        );
        assert!(send_bounds.bottom() <= px(720.0) + px(1.0));
    }

    #[gpui::test]
    async fn chat_scroll_position_is_saved_and_restored(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        let long_markdownish = std::iter::repeat_n(
            "- A very long bullet line that should wrap and force the history to overflow and scroll.\n",
            40,
        )
        .collect::<String>();

        let mut entries = Vec::new();
        for i in 0..24 {
            entries.push(ConversationEntry::UserMessage {
                text: format!("message {i} {long_markdownish}"),
            });
            entries.push(ConversationEntry::TurnDuration { duration_ms: 1000 });
        }

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries,
            },
        });

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(900.0), px(320.0)));
        for _ in 0..3 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let max_y10 = view.read_with(window_cx, |v, _| v.debug_chat_scroll_max_offset_y10());
        assert!(max_y10 > 0, "expected a scrollable chat history");

        let desired_offset_y10 = -((max_y10 / 2).max(10));
        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                view.chat_scroll_handle
                    .set_offset(point(px(0.0), px(desired_offset_y10 as f32 / 10.0)));
                cx.notify();
            });
        });
        for _ in 0..3 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let current_offset_y10 = view.read_with(window_cx, |v, _| v.debug_chat_scroll_offset_y10());
        assert!(current_offset_y10 < 0, "expected a non-zero scroll offset");

        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                view.dispatch(Action::OpenDashboard, cx);
            });
        });
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let saved_offset_y10 = view.read_with(window_cx, |v, _| {
            v.debug_state()
                .workspace_chat_scroll_y10
                .get(&workspace_id)
                .copied()
        });
        assert_eq!(saved_offset_y10, Some(current_offset_y10));

        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                view.chat_scroll_handle.set_offset(point(px(0.0), px(0.0)));
                view.dispatch(Action::OpenWorkspace { workspace_id }, cx);
            });
        });
        for _ in 0..3 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let restored_offset_y10 =
            view.read_with(window_cx, |v, _| v.debug_chat_scroll_offset_y10());
        assert_eq!(restored_offset_y10, current_offset_y10);
    }

    #[gpui::test]
    async fn chat_composer_stays_in_viewport_with_terminal_and_long_history(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.right_pane = RightPane::Terminal;

        let long_text = std::iter::repeat_n(
            "This is a long message that should wrap and increase history height.\n",
            120,
        )
        .collect::<String>();

        let mut entries = Vec::new();
        for i in 0..18 {
            entries.push(ConversationEntry::UserMessage {
                text: format!("message {i}\n{long_text}"),
            });
            entries.push(ConversationEntry::TurnDuration { duration_ms: 1000 });
        }

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries,
            },
        });

        let (_view, window_cx) = cx.add_window_view(|_window, cx| {
            let mut view = LubanRootView::with_state(services, state, cx);
            view.terminal_enabled = true;
            view.workspace_terminal_errors
                .insert(workspace_id, "stub terminal".to_owned());
            view
        });

        let window_size = size(px(1200.0), px(801.0));
        window_cx.simulate_resize(window_size);

        for _ in 0..4 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let main_bounds = window_cx
            .debug_bounds("main-pane")
            .expect("missing debug bounds for main-pane");
        assert!(
            main_bounds.bottom() <= window_size.height + px(1.0),
            "main={:?}",
            main_bounds
        );

        let send_bounds = window_cx
            .debug_bounds("chat-send-message")
            .expect("missing chat composer send button");
        assert!(send_bounds.size.height > px(0.0));
        assert!(
            send_bounds.bottom() <= window_size.height + px(1.0),
            "send={:?} main={:?}",
            send_bounds,
            main_bounds
        );
    }

    #[gpui::test]
    async fn sidebar_buttons_remain_visible_with_long_titles(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.projects[0].name = "a".repeat(256);
        state.apply(Action::ToggleProjectExpanded { project_id });

        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w".repeat(128),
            branch_name: "repo/branch".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w1"),
        });

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(320.0), px(480.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let header_bounds = window_cx
            .debug_bounds("project-header-0")
            .expect("missing debug bounds for project-header-0");
        let title_bounds = window_cx
            .debug_bounds("project-title-0")
            .expect("missing debug bounds for project-title-0");

        window_cx.simulate_mouse_move(header_bounds.center(), None, Modifiers::none());
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let toggle_bounds = window_cx
            .debug_bounds("project-toggle-0")
            .expect("missing debug bounds for project-toggle-0");
        let create_bounds = window_cx
            .debug_bounds("project-create-workspace-0")
            .expect("missing debug bounds for project-create-workspace-0");
        let settings_bounds = window_cx
            .debug_bounds("project-settings-0")
            .expect("missing debug bounds for project-settings-0");

        assert!(settings_bounds.right() <= header_bounds.right() + px(2.0));
        assert!(create_bounds.right() <= settings_bounds.left() + px(4.0));
        assert!(toggle_bounds.left() <= title_bounds.right() + px(8.0));

        let row_bounds = window_cx
            .debug_bounds("workspace-row-0-0")
            .expect("missing debug bounds for workspace-row-0-0");
        let archive_bounds = window_cx
            .debug_bounds("workspace-archive-0-0")
            .expect("missing debug bounds for workspace-archive-0-0");
        assert!(archive_bounds.right() <= row_bounds.right() + px(2.0));
    }

    #[gpui::test]
    async fn workspace_icons_are_vertically_centered_in_rows(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::ToggleProjectExpanded { project_id });
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w1".to_owned(),
            branch_name: "repo/w1".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w1"),
        });

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(420.0), px(360.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let main_row = window_cx
            .debug_bounds("workspace-main-row-0")
            .expect("missing main workspace row");
        let main_icon = window_cx
            .debug_bounds("workspace-main-icon-0")
            .expect("missing main workspace icon");
        let main_dy = (main_icon.center().y - main_row.center().y).abs();
        assert!(
            main_dy <= px(2.0),
            "main icon should be vertically centered: icon={:?} row={:?}",
            main_icon,
            main_row
        );

        let row = window_cx
            .debug_bounds("workspace-row-0-0")
            .expect("missing workspace row");
        let icon = window_cx
            .debug_bounds("workspace-git-icon-branch-0-0")
            .expect("missing workspace icon");
        let dy = (icon.center().y - row.center().y).abs();
        assert!(
            dy <= px(2.0),
            "workspace icon should be vertically centered: icon={:?} row={:?}",
            icon,
            row
        );
    }

    #[gpui::test]
    async fn dashboard_uses_full_window_and_renders_horizontal_columns(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w2".to_owned(),
            branch_name: "repo/w2".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w2"),
        });
        state.apply(Action::OpenDashboard);

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        assert!(
            window_cx.debug_bounds("sidebar").is_none(),
            "dashboard should not render the sidebar"
        );
        assert!(
            window_cx.debug_bounds("sidebar-resizer").is_none(),
            "dashboard should not render the sidebar resizer"
        );

        let titlebar = window_cx
            .debug_bounds("titlebar-sidebar")
            .expect("missing sidebar titlebar");
        let title = window_cx
            .debug_bounds("titlebar-dashboard-title")
            .expect("missing dashboard toggle");
        let center_dx = (title.center().x - titlebar.center().x).abs();
        assert!(
            center_dx <= px(2.0),
            "dashboard toggle should be centered in sidebar titlebar: title={:?} titlebar={:?}",
            title,
            titlebar
        );

        assert!(
            window_cx.debug_bounds("add-project-button").is_none(),
            "dashboard should not render add project button"
        );
        assert!(
            window_cx.debug_bounds("titlebar-dashboard-label").is_some(),
            "dashboard toggle label should switch to dashboard"
        );

        let start = window_cx
            .debug_bounds("dashboard-column-start")
            .expect("missing start column");
        let running = window_cx
            .debug_bounds("dashboard-column-running")
            .expect("missing running column");
        assert!(
            start.center().x < running.center().x,
            "dashboard columns should lay out horizontally: start={:?} running={:?}",
            start,
            running
        );

        let w1 = window_cx
            .debug_bounds("dashboard-card-0-w1")
            .expect("missing w1 card");
        let w2 = window_cx
            .debug_bounds("dashboard-card-0-w2")
            .expect("missing w2 card");
        let dx = (w1.center().x - w2.center().x).abs();
        let dy = (w1.center().y - w2.center().y).abs();
        assert!(
            dx <= px(2.0) && dy > px(8.0),
            "dashboard cards should stack vertically within a column: w1={:?} w2={:?}",
            w1,
            w2
        );
    }

    #[gpui::test]
    async fn dashboard_toggle_returns_to_workspace_without_moving(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        let w1 = workspace_id_by_name(&state, "w1");
        state.apply(Action::OpenWorkspace { workspace_id: w1 });

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(980.0), px(640.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let last_workspace = view.read_with(window_cx, |v, _| v.last_chat_workspace_id);
        assert_eq!(
            last_workspace,
            Some(w1),
            "expected last chat workspace to be set after rendering a workspace"
        );

        let initial_toggle = window_cx
            .debug_bounds("titlebar-dashboard-title")
            .expect("missing dashboard toggle");
        let initial_center_x = initial_toggle.center().x;

        window_cx.simulate_click(initial_toggle.center(), Modifiers::none());
        window_cx.refresh().unwrap();

        let selected = view.read_with(window_cx, |v, _| v.debug_state().main_pane);
        assert!(
            matches!(selected, MainPane::Dashboard),
            "expected dashboard to open after clicking the toggle"
        );

        let last_workspace = view.read_with(window_cx, |v, _| v.last_workspace_before_dashboard);
        assert_eq!(
            last_workspace,
            Some(w1),
            "expected the dashboard toggle to remember the previous workspace"
        );

        let dashboard_toggle = window_cx
            .debug_bounds("titlebar-dashboard-title")
            .expect("missing dashboard toggle on dashboard");
        let dashboard_center_x = dashboard_toggle.center().x;
        assert!(
            (dashboard_center_x - initial_center_x).abs() <= px(2.0),
            "toggle should not move when entering dashboard: before={:?} after={:?}",
            initial_toggle,
            dashboard_toggle
        );
        assert!(
            window_cx.debug_bounds("titlebar-dashboard-label").is_some(),
            "expected toggle label to switch to dashboard on dashboard"
        );

        window_cx.simulate_click(dashboard_toggle.center(), Modifiers::none());
        window_cx.refresh().unwrap();

        let selected = view.read_with(window_cx, |v, _| v.debug_state().main_pane);
        assert!(
            matches!(selected, MainPane::Workspace(id) if id == w1),
            "expected workspace view to return after clicking the toggle on dashboard"
        );
    }

    #[gpui::test]
    async fn dashboard_renders_kanban_cards_and_preview(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::ToggleProjectExpanded { project_id });
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w1".to_owned(),
            branch_name: "repo/w1".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w1"),
        });
        let w1 = workspace_id_by_name(&state, "w1");

        state.apply(Action::ConversationLoaded {
            workspace_id: w1,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![
                    ConversationEntry::UserMessage {
                        text: "Hello".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "item-1".to_owned(),
                            text: "Hi from agent".to_owned(),
                        }),
                    },
                ],
            },
        });

        state.apply(Action::OpenDashboard);

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        assert!(
            window_cx.debug_bounds("dashboard-column-start").is_some(),
            "expected start column to be rendered"
        );
        assert!(
            window_cx.debug_bounds("dashboard-card-0-main").is_none(),
            "main workspace should not be rendered in the dashboard"
        );
        let card_bounds = window_cx
            .debug_bounds("dashboard-card-0-w1")
            .expect("missing dashboard card for w1");

        window_cx.simulate_click(card_bounds.center(), Modifiers::none());
        window_cx.refresh().unwrap();

        assert!(
            window_cx.debug_bounds("dashboard-preview").is_some(),
            "expected preview to be rendered after clicking a card"
        );
        assert!(
            window_cx.debug_bounds("workspace-chat-composer").is_some(),
            "expected the preview panel to render an editable chat composer"
        );

        let surface_bounds = window_cx
            .debug_bounds("chat-composer-surface")
            .expect("missing preview chat composer surface");
        let model_bounds = window_cx
            .debug_bounds("chat-model-selector")
            .expect("missing preview chat model selector");
        let send_bounds = window_cx
            .debug_bounds("chat-send-message")
            .expect("missing preview chat composer send button");

        let left_inset = model_bounds.left() - surface_bounds.left();
        let right_inset = surface_bounds.right() - send_bounds.right();
        let inset_diff = if left_inset > right_inset {
            left_inset - right_inset
        } else {
            right_inset - left_inset
        };
        assert!(
            left_inset >= px(14.0) && left_inset <= px(22.0),
            "unexpected preview chat composer inset: left={left_inset:?} surface={surface_bounds:?} model={model_bounds:?}",
        );
        assert!(
            inset_diff <= px(4.0),
            "expected symmetric preview insets: left={left_inset:?} right={right_inset:?} diff={inset_diff:?}",
        );

        let open_bounds = window_cx
            .debug_bounds("dashboard-preview-open-task")
            .expect("missing preview open button");
        window_cx.simulate_click(open_bounds.center(), Modifiers::none());
        window_cx.refresh().unwrap();

        let selected = view.read_with(window_cx, |v, _| v.debug_state().main_pane);
        assert!(
            matches!(selected, MainPane::Workspace(id) if id == w1),
            "expected task view to open when clicking preview open button"
        );
    }

    #[gpui::test]
    async fn dashboard_preview_panel_can_be_resized(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::ToggleProjectExpanded { project_id });
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w1".to_owned(),
            branch_name: "repo/w1".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w1"),
        });
        let w1 = workspace_id_by_name(&state, "w1");
        state.apply(Action::ConversationLoaded {
            workspace_id: w1,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: "Hello".to_owned(),
                }],
            },
        });
        state.apply(Action::OpenDashboard);

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let card_bounds = window_cx
            .debug_bounds("dashboard-card-0-w1")
            .expect("missing dashboard card for w1");
        window_cx.simulate_click(card_bounds.center(), Modifiers::none());
        window_cx.refresh().unwrap();

        let panel_before = view
            .read_with(window_cx, |v, _| {
                v.debug_inspector_bounds("dashboard-preview-panel")
            })
            .expect("missing preview panel");
        let resizer_bounds = view
            .read_with(window_cx, |v, _| {
                v.debug_inspector_bounds("dashboard-preview-resizer")
            })
            .expect("missing preview resizer");

        let start = resizer_bounds.center();
        let mid = point(start.x - px(24.0), start.y);
        let end = point(start.x - px(120.0), start.y);

        window_cx.simulate_mouse_down(start, MouseButton::Left, Modifiers::none());
        window_cx.simulate_mouse_move(mid, Some(MouseButton::Left), Modifiers::none());
        window_cx.simulate_mouse_move(end, Some(MouseButton::Left), Modifiers::none());
        window_cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::none());
        for _ in 0..3 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let panel_after = view
            .read_with(window_cx, |v, _| {
                v.debug_inspector_bounds("dashboard-preview-panel")
            })
            .expect("missing preview panel after resize");
        assert!(
            panel_after.size.width > panel_before.size.width + px(40.0),
            "expected preview panel width to increase after dragging resizer: before={:?} after={:?}",
            panel_before.size,
            panel_after.size
        );
    }

    #[gpui::test]
    async fn dashboard_preview_updates_chat_draft(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::ToggleProjectExpanded { project_id });
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w1".to_owned(),
            branch_name: "repo/w1".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w1"),
        });
        let w1 = workspace_id_by_name(&state, "w1");
        state.apply(Action::ConversationLoaded {
            workspace_id: w1,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: "Hello".to_owned(),
                }],
            },
        });
        state.apply(Action::OpenDashboard);

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let card_bounds = window_cx
            .debug_bounds("dashboard-card-0-w1")
            .expect("missing dashboard card for w1");
        window_cx.simulate_click(card_bounds.center(), Modifiers::none());
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let draft_text = "Draft from dashboard preview".to_owned();
        window_cx.update(|window, app| {
            view.update(app, |view, cx| {
                let input = view.ensure_chat_input(window, cx);
                input.update(cx, |state, cx| {
                    state.set_value(&draft_text, window, cx);
                });
            });
        });
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let saved = view.read_with(window_cx, |view, _| {
            view.debug_state()
                .workspace_conversation(w1)
                .map(|c| c.draft.clone())
        });
        assert_eq!(saved.as_deref(), Some(draft_text.as_str()));
    }

    #[gpui::test]
    async fn dashboard_columns_show_inset_and_card_spacing(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::ToggleProjectExpanded { project_id });
        for name in ["w1", "w2", "w3"] {
            state.apply(Action::WorkspaceCreated {
                project_id,
                workspace_name: name.to_owned(),
                branch_name: format!("repo/{name}"),
                worktree_path: PathBuf::from(format!("/tmp/luban/worktrees/repo/{name}")),
            });
        }
        state.apply(Action::OpenDashboard);

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let column_bounds = window_cx
            .debug_bounds("dashboard-column-start")
            .expect("missing dashboard start column");

        let mut card_bounds = [
            window_cx
                .debug_bounds("dashboard-card-0-w1")
                .expect("missing dashboard card for w1"),
            window_cx
                .debug_bounds("dashboard-card-0-w2")
                .expect("missing dashboard card for w2"),
            window_cx
                .debug_bounds("dashboard-card-0-w3")
                .expect("missing dashboard card for w3"),
        ];
        card_bounds.sort_by(|a, b| a.top().partial_cmp(&b.top()).unwrap());

        let first = card_bounds[0];
        assert!(
            first.left() >= column_bounds.left() + px(6.0),
            "expected card inset within column: card={first:?} column={column_bounds:?}",
        );
        assert!(
            first.right() <= column_bounds.right() - px(6.0),
            "expected card inset within column: card={first:?} column={column_bounds:?}",
        );

        for window in card_bounds.windows(2) {
            let prev = window[0];
            let next = window[1];
            let gap = next.top() - prev.bottom();
            assert!(
                gap >= px(6.0),
                "expected visible gap between dashboard cards: prev={prev:?} next={next:?} gap={gap:?}",
            );
        }
    }

    #[gpui::test]
    async fn dashboard_preview_closes_when_clicking_outside(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::ToggleProjectExpanded { project_id });
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w1".to_owned(),
            branch_name: "repo/w1".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w1"),
        });
        let w1 = workspace_id_by_name(&state, "w1");
        state.apply(Action::ConversationLoaded {
            workspace_id: w1,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: "Hello".to_owned(),
                }],
            },
        });
        state.apply(Action::OpenDashboard);

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let card_bounds = window_cx
            .debug_bounds("dashboard-card-0-w1")
            .expect("missing dashboard card for w1");
        window_cx.simulate_click(card_bounds.center(), Modifiers::none());
        window_cx.refresh().unwrap();

        assert!(
            window_cx.debug_bounds("dashboard-preview").is_some(),
            "expected preview to be rendered after clicking a card"
        );
        assert!(
            view.read_with(window_cx, |v, _| v
                .debug_state()
                .dashboard_preview_workspace_id)
                .is_some(),
            "expected selected preview workspace to be set"
        );

        let backdrop_bounds = window_cx
            .debug_bounds("dashboard-preview-backdrop")
            .expect("missing preview backdrop");
        window_cx.simulate_event(MouseDownEvent {
            position: backdrop_bounds.center(),
            modifiers: Modifiers::none(),
            button: MouseButton::Left,
            click_count: 1,
            first_mouse: false,
        });
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let preview_state_after_backdrop = view.read_with(window_cx, |v, _| {
            v.debug_state().dashboard_preview_workspace_id
        });
        assert!(
            preview_state_after_backdrop.is_none(),
            "expected preview workspace to clear after closing: backdrop={backdrop_bounds:?} state={preview_state_after_backdrop:?}"
        );

        window_cx.simulate_click(card_bounds.center(), Modifiers::none());
        window_cx.refresh().unwrap();

        assert!(
            view.read_with(window_cx, |v, _| v
                .debug_state()
                .dashboard_preview_workspace_id)
                .is_some(),
            "expected preview to be re-openable after closing"
        );

        let titlebar_bounds = window_cx
            .debug_bounds("titlebar-main")
            .expect("missing titlebar main segment");
        window_cx.simulate_click(titlebar_bounds.center(), Modifiers::none());
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        assert!(
            view.read_with(window_cx, |v, _| v
                .debug_state()
                .dashboard_preview_workspace_id)
                .is_none(),
            "expected preview to close after clicking titlebar"
        );
    }

    #[gpui::test]
    async fn dashboard_preview_blocks_kanban_scroll(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::ToggleProjectExpanded { project_id });
        for i in 0..24 {
            state.apply(Action::WorkspaceCreated {
                project_id,
                workspace_name: format!("w{i}"),
                branch_name: format!("repo/w{i}"),
                worktree_path: PathBuf::from(format!("/tmp/luban/worktrees/repo/w{i}")),
            });
        }
        state.apply(Action::OpenDashboard);

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let root_bounds = window_cx
            .debug_bounds("dashboard-root")
            .expect("missing dashboard root");
        window_cx.simulate_mouse_move(root_bounds.center(), None, Modifiers::none());
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();
        let count_before =
            view.read_with(window_cx, |v, _| v.debug_dashboard_scroll_wheel_events());
        window_cx.simulate_event(ScrollWheelEvent {
            position: root_bounds.center(),
            delta: ScrollDelta::Pixels(point(px(0.0), px(200.0))),
            ..Default::default()
        });
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let card_after_scroll =
            view.read_with(window_cx, |v, _| v.debug_dashboard_scroll_wheel_events());
        assert!(
            card_after_scroll > count_before,
            "expected scroll wheel event to reach kanban: before={count_before} after={card_after_scroll}",
        );

        view.update(window_cx, |view, cx| {
            let workspace_id = workspace_id_by_name(&view.state, "w0");
            view.dispatch(Action::DashboardPreviewOpened { workspace_id }, cx);
        });
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let count_before_overlay_scroll =
            view.read_with(window_cx, |v, _| v.debug_dashboard_scroll_wheel_events());
        let backdrop_bounds = window_cx
            .debug_bounds("dashboard-preview-backdrop")
            .expect("missing preview backdrop");

        window_cx.simulate_mouse_move(backdrop_bounds.center(), None, Modifiers::none());
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();
        window_cx.simulate_event(ScrollWheelEvent {
            position: backdrop_bounds.center(),
            delta: ScrollDelta::Pixels(point(px(0.0), px(200.0))),
            ..Default::default()
        });
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let card_after_overlay_scroll =
            view.read_with(window_cx, |v, _| v.debug_dashboard_scroll_wheel_events());
        assert!(
            card_after_overlay_scroll == count_before_overlay_scroll,
            "expected kanban scroll to be disabled while preview is open: before={count_before_overlay_scroll} after={card_after_overlay_scroll}",
        );
    }

    #[gpui::test]
    async fn chat_column_remains_primary_when_terminal_is_visible(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.right_pane = RightPane::Terminal;

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: "Test".to_owned(),
                }],
            },
        });

        let (_view, window_cx) = cx.add_window_view(|_window, cx| {
            let mut view = LubanRootView::with_state(services, state, cx);
            view.terminal_enabled = true;
            view.workspace_terminal_errors
                .insert(workspace_id, "stub terminal".to_owned());
            view
        });

        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let chat_bounds = window_cx
            .debug_bounds("workspace-chat-column")
            .expect("missing debug bounds for workspace-chat-column");
        let main_bounds = window_cx
            .debug_bounds("main-pane")
            .expect("missing debug bounds for main-pane");
        let right_pane_bounds = window_cx
            .debug_bounds("workspace-right-pane")
            .expect("missing debug bounds for workspace-right-pane");

        assert!(
            main_bounds.size.width >= px(640.0),
            "main={:?} right_pane={:?}",
            main_bounds.size,
            right_pane_bounds.size
        );
        assert!(
            chat_bounds.size.width >= px(600.0),
            "chat={:?} right_pane={:?}",
            chat_bounds.size,
            right_pane_bounds.size
        );
        assert!(
            chat_bounds.size.width >= right_pane_bounds.size.width + px(120.0),
            "chat={:?} right_pane={:?}",
            chat_bounds.size,
            right_pane_bounds.size
        );
    }

    #[gpui::test]
    async fn terminal_pane_has_reasonable_default_width(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "repo/branch".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");
        state.main_pane = MainPane::Workspace(workspace_id);
        state.right_pane = RightPane::Terminal;

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: "Test".to_owned(),
                }],
            },
        });

        let (_view, window_cx) = cx.add_window_view(|_window, cx| {
            let mut view = LubanRootView::with_state(services, state, cx);
            view.terminal_enabled = true;
            view.workspace_terminal_errors
                .insert(workspace_id, "stub terminal".to_owned());
            view
        });

        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let right_pane_bounds = window_cx
            .debug_bounds("workspace-right-pane")
            .expect("missing debug bounds for workspace-right-pane");
        assert!(
            right_pane_bounds.size.width >= px(240.0),
            "right_pane={:?}",
            right_pane_bounds.size
        );
    }

    #[gpui::test]
    async fn terminal_pane_can_be_resized_by_dragging_divider(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "repo/branch".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");
        state.main_pane = MainPane::Workspace(workspace_id);
        state.right_pane = RightPane::Terminal;

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: "Test".to_owned(),
                }],
            },
        });

        let (view, window_cx) = cx.add_window_view(|_window, cx| {
            let mut view = LubanRootView::with_state(services, state, cx);
            view.terminal_enabled = true;
            view.workspace_terminal_errors
                .insert(workspace_id, "stub terminal".to_owned());
            view
        });

        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let initial_right_pane = window_cx
            .debug_bounds("workspace-right-pane")
            .expect("missing debug bounds for workspace-right-pane");
        let initial_grid = view
            .read_with(window_cx, |v, _| v.debug_last_terminal_grid_size())
            .expect("missing initial terminal grid size");
        let resizer = window_cx
            .debug_bounds("terminal-pane-resizer")
            .expect("missing terminal pane resizer");

        let start = resizer.center();
        let mid = point(start.x - px(24.0), start.y);
        let end = point(start.x - px(200.0), start.y);

        window_cx.simulate_mouse_down(start, gpui::MouseButton::Left, Modifiers::none());
        window_cx.simulate_mouse_move(mid, Some(gpui::MouseButton::Left), Modifiers::none());
        window_cx.simulate_mouse_move(end, Some(gpui::MouseButton::Left), Modifiers::none());
        window_cx.simulate_mouse_up(end, gpui::MouseButton::Left, Modifiers::none());

        for _ in 0..3 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let resized_right_pane = window_cx
            .debug_bounds("workspace-right-pane")
            .expect("missing debug bounds for workspace-right-pane");
        assert!(
            resized_right_pane.size.width >= initial_right_pane.size.width + px(120.0),
            "initial={:?} resized={:?}",
            initial_right_pane.size,
            resized_right_pane.size
        );

        let resized_grid = view
            .read_with(window_cx, |v, _| v.debug_last_terminal_grid_size())
            .expect("missing resized terminal grid size");
        assert!(
            resized_grid.0 > initial_grid.0,
            "initial={initial_grid:?} resized={resized_grid:?}"
        );
    }

    #[gpui::test]
    async fn terminal_is_reinitialized_after_session_exits(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        if std::path::Path::new("/bin/bash").exists() {
            unsafe {
                std::env::set_var("SHELL", "/bin/bash");
            }
        }

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "repo/branch".to_owned(),
            worktree_path: PathBuf::from("/tmp"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");
        state.main_pane = MainPane::Workspace(workspace_id);
        state.right_pane = RightPane::Terminal;

        let (view, window_cx) = cx.add_window_view(|_window, cx| {
            let mut view = LubanRootView::with_state(services, state, cx);
            view.terminal_enabled = true;
            view
        });

        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        for _ in 0..12 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let initial_closed = view.read_with(window_cx, |view, _| {
            view.workspace_terminals
                .get(&workspace_id)
                .map(|t| t.is_closed())
        });
        assert_eq!(
            initial_closed,
            Some(false),
            "expected a running terminal session for the workspace"
        );

        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                if let Some(terminal) = view.workspace_terminals.get_mut(&workspace_id) {
                    terminal.kill();
                }
                cx.notify();
            });
        });

        for _ in 0..24 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let after_closed = view.read_with(window_cx, |view, _| {
            view.workspace_terminals
                .get(&workspace_id)
                .map(|t| t.is_closed())
        });
        assert_eq!(
            after_closed,
            Some(false),
            "expected terminal to be reinitialized after session exit"
        );
        assert!(
            view.read_with(window_cx, |view, _| {
                !view.workspace_terminal_errors.contains_key(&workspace_id)
            }),
            "expected terminal to reinitialize without errors"
        );
    }

    #[gpui::test]
    async fn project_header_has_extra_spacing_before_main_workspace(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::ToggleProjectExpanded { project_id });

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(900.0), px(240.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let header = window_cx
            .debug_bounds("project-header-0")
            .expect("missing project header");
        let main_row = window_cx
            .debug_bounds("workspace-main-row-0")
            .expect("missing main workspace row");
        let gap = main_row.top() - header.bottom();
        assert!(
            gap >= px(4.0),
            "expected extra spacing between project header and main row: gap={gap:?} header={header:?} main={main_row:?}"
        );
    }

    #[gpui::test]
    async fn sidebar_can_be_resized_by_dragging_divider(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "repo/branch".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");
        state.main_pane = MainPane::Workspace(workspace_id);

        let (view, window_cx) = cx.add_window_view(|_window, cx| {
            let mut view = LubanRootView::with_state(services, state, cx);
            view.terminal_enabled = true;
            view
        });

        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let initial_sidebar = window_cx
            .debug_bounds("sidebar")
            .expect("missing debug bounds for sidebar");
        let resizer = window_cx
            .debug_bounds("sidebar-resizer")
            .expect("missing debug bounds for sidebar-resizer");

        let start = resizer.center();
        let mid = point(start.x + px(24.0), start.y);
        let end = point(start.x + px(200.0), start.y);

        window_cx.simulate_mouse_down(start, gpui::MouseButton::Left, Modifiers::none());
        window_cx.simulate_mouse_move(mid, Some(gpui::MouseButton::Left), Modifiers::none());
        window_cx.simulate_mouse_move(end, Some(gpui::MouseButton::Left), Modifiers::none());
        window_cx.simulate_mouse_up(end, gpui::MouseButton::Left, Modifiers::none());

        for _ in 0..3 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let resized_sidebar = window_cx
            .debug_bounds("sidebar")
            .expect("missing debug bounds for sidebar");
        assert!(
            resized_sidebar.size.width >= initial_sidebar.size.width + px(120.0),
            "initial={:?} resized={:?}",
            initial_sidebar.size,
            resized_sidebar.size
        );

        let saved_width = view.read_with(window_cx, |v, _| v.debug_state().sidebar_width);
        assert!(saved_width.is_some());
    }

    #[gpui::test]
    async fn sidebar_projects_list_renders_scrollbar_when_overflowing(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        for i in 0..48 {
            state.apply(Action::AddProject {
                path: PathBuf::from(format!("/tmp/repo-{i}")),
            });
        }

        let (_view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(900.0), px(240.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        assert!(
            window_cx.debug_bounds("projects-scrollbar").is_some(),
            "expected a scrollbar for the projects list"
        );
    }

    #[gpui::test]
    async fn terminal_grid_updates_after_sidebar_resize(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

        let mut state = AppState::new();
        state.apply(Action::AddProject {
            path: PathBuf::from("/tmp/repo"),
        });
        let project_id = state.projects[0].id;
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "abandon-about".to_owned(),
            branch_name: "repo/branch".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
        });
        let workspace_id = workspace_id_by_name(&state, "abandon-about");
        state.main_pane = MainPane::Workspace(workspace_id);
        state.right_pane = RightPane::Terminal;

        let (view, window_cx) = cx.add_window_view(|_window, cx| {
            let mut view = LubanRootView::with_state(services, state, cx);
            view.terminal_enabled = true;
            view.workspace_terminal_errors
                .insert(workspace_id, "stub terminal".to_owned());
            view
        });

        window_cx.simulate_resize(size(px(1200.0), px(720.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let initial_grid = view
            .read_with(window_cx, |v, _| v.debug_last_terminal_grid_size())
            .expect("missing initial terminal grid size");
        let resizer = window_cx
            .debug_bounds("sidebar-resizer")
            .expect("missing debug bounds for sidebar-resizer");

        let start = resizer.center();
        let mid = point(start.x + px(24.0), start.y);
        let end = point(start.x + px(160.0), start.y);
        window_cx.simulate_mouse_down(start, gpui::MouseButton::Left, Modifiers::none());
        window_cx.simulate_mouse_move(mid, Some(gpui::MouseButton::Left), Modifiers::none());
        window_cx.simulate_mouse_move(end, Some(gpui::MouseButton::Left), Modifiers::none());
        window_cx.simulate_mouse_up(end, gpui::MouseButton::Left, Modifiers::none());

        for _ in 0..3 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let resized_grid = view
            .read_with(window_cx, |v, _| v.debug_last_terminal_grid_size())
            .expect("missing resized terminal grid size");
        assert_ne!(resized_grid, initial_grid);
    }

    #[gpui::test]
    async fn short_user_message_does_not_fill_max_width(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: "Test".to_owned(),
                }],
            },
        });

        let (_, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(1200.0), px(800.0)));
        window_cx.run_until_parked();
        window_cx.refresh().unwrap();

        let bubble = window_cx
            .debug_bounds("conversation-user-bubble-0")
            .expect("missing debug bounds for conversation-user-bubble-0");
        assert!(bubble.size.width < px(300.0), "bubble={:?}", bubble.size);
    }

    #[gpui::test]
    async fn long_in_progress_reasoning_does_not_expand_chat_column(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        state.apply(Action::SendAgentMessage {
            workspace_id,
            text: "Test".to_owned(),
        });
        state.apply(Action::AgentEventReceived {
            workspace_id,
            event: CodexThreadEvent::ItemStarted {
                item: CodexThreadItem::Reasoning {
                    id: "item-1".to_owned(),
                    text: "a".repeat(16_384),
                },
            },
        });

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(720.0), px(800.0)));
        window_cx.refresh().unwrap();

        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                view.expanded_agent_items.insert("item-1".to_owned());
                cx.notify();
            });
        });
        window_cx.refresh().unwrap();

        let column = window_cx
            .debug_bounds("workspace-chat-column")
            .expect("missing debug bounds for workspace-chat-column");
        assert!(column.size.width <= px(720.0));

        let bubble = window_cx
            .debug_bounds("conversation-user-bubble-0")
            .expect("missing debug bounds for conversation-user-bubble-0");
        assert!(bubble.right() <= column.right() + px(2.0));
        assert!(bubble.right() >= column.right() - px(8.0));
    }

    #[gpui::test]
    async fn long_command_execution_does_not_expand_chat_column(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);

        let long_command = format!(
            "bash -lc 'echo {} && echo \"{}\" && printf \"%s\" {}'",
            "a".repeat(4096),
            "b".repeat(4096),
            "c".repeat(4096)
        );
        let long_output = format!("{}\n{}", "x".repeat(4096), "y".repeat(4096));

        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![
                    ConversationEntry::UserMessage {
                        text: "Test".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::CommandExecution {
                            id: "item-1".to_owned(),
                            command: long_command,
                            aggregated_output: long_output,
                            exit_code: Some(0),
                            status: luban_domain::CodexCommandExecutionStatus::Completed,
                        }),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "item-2".to_owned(),
                            text: "Reply".to_owned(),
                        }),
                    },
                ],
            },
        });

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(720.0), px(800.0)));
        window_cx.refresh().unwrap();

        let turn_bounds = window_cx
            .debug_bounds("agent-turn-summary-agent-turn-0")
            .expect("missing debug bounds for agent-turn-summary-agent-turn-0");
        window_cx.simulate_click(turn_bounds.center(), Modifiers::none());
        window_cx.refresh().unwrap();

        let row_bounds = window_cx
            .debug_bounds("agent-turn-item-summary-agent-turn-0-item-1")
            .expect("missing debug bounds for agent-turn-item-summary-agent-turn-0-item-1");
        window_cx.simulate_click(row_bounds.center(), Modifiers::none());
        window_cx.refresh().unwrap();

        let expanded = view.read_with(window_cx, |v, _| {
            v.expanded_agent_items.contains("agent-turn-0::item-1")
        });
        assert!(expanded);

        let column = window_cx
            .debug_bounds("workspace-chat-column")
            .expect("missing debug bounds for workspace-chat-column");
        assert!(column.size.width <= px(720.0));

        let bubble = window_cx
            .debug_bounds("conversation-user-bubble-0")
            .expect("missing debug bounds for conversation-user-bubble-0");
        assert!(bubble.right() <= column.right() + px(2.0));
        assert!(bubble.right() >= column.right() - px(8.0));
    }

    #[gpui::test]
    async fn turn_duration_renders_below_messages(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![
                    ConversationEntry::UserMessage {
                        text: "Test".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "item-1".to_owned(),
                            text: "Reply".to_owned(),
                        }),
                    },
                    ConversationEntry::TurnDuration { duration_ms: 6300 },
                ],
            },
        });

        let (_, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.refresh().unwrap();

        let bounds = window_cx
            .debug_bounds("turn-duration-2")
            .expect("missing debug bounds for turn-duration-2");
        assert!(bounds.size.width > px(0.0));
    }

    #[gpui::test]
    async fn tail_turn_duration_renders_from_view_pending_state(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![ConversationEntry::UserMessage {
                    text: "Test".to_owned(),
                }],
            },
        });

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));

        view.update(window_cx, |v, cx| {
            v.pending_turn_durations
                .insert(workspace_id, Duration::from_millis(1234));
            cx.notify();
        });
        window_cx.refresh().unwrap();

        let bounds = window_cx
            .debug_bounds("chat-tail-turn-duration")
            .expect("missing debug bounds for chat-tail-turn-duration");
        assert!(bounds.size.width > px(0.0));
    }

    #[gpui::test]
    async fn agent_messages_with_scoped_ids_render_in_multiple_turns(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![
                    ConversationEntry::UserMessage {
                        text: "First".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "turn-a/item_0".to_owned(),
                            text: "A".to_owned(),
                        }),
                    },
                    ConversationEntry::TurnDuration { duration_ms: 1000 },
                    ConversationEntry::UserMessage {
                        text: "Second".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "turn-b/item_0".to_owned(),
                            text: "B".to_owned(),
                        }),
                    },
                    ConversationEntry::TurnDuration { duration_ms: 2000 },
                ],
            },
        });

        let (_, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.refresh().unwrap();

        let a = window_cx
            .debug_bounds("conversation-agent-message-agent-turn-0-turn-a/item_0")
            .expect("missing agent message A");
        let b = window_cx
            .debug_bounds("conversation-agent-message-agent-turn-1-turn-b/item_0")
            .expect("missing agent message B");
        assert!(a.size.width > px(0.0));
        assert!(b.size.width > px(0.0));
    }

    #[gpui::test]
    async fn chat_new_items_badge_is_not_rendered(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.main_pane = MainPane::Workspace(workspace_id);
        state.apply(Action::ConversationLoaded {
            workspace_id,
            snapshot: ConversationSnapshot {
                thread_id: Some("thread-1".to_owned()),
                entries: vec![
                    ConversationEntry::UserMessage {
                        text: "First".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "turn-a/item_0".to_owned(),
                            text: "A".to_owned(),
                        }),
                    },
                    ConversationEntry::TurnDuration { duration_ms: 1000 },
                    ConversationEntry::UserMessage {
                        text: "Second".to_owned(),
                    },
                    ConversationEntry::CodexItem {
                        item: Box::new(CodexThreadItem::AgentMessage {
                            id: "turn-b/item_0".to_owned(),
                            text: "B".to_owned(),
                        }),
                    },
                ],
            },
        });

        let (_, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.refresh().unwrap();

        assert!(window_cx.debug_bounds("chat-new-items").is_none());
        assert!(window_cx.debug_bounds("chat-new-items-button").is_none());
    }

    #[gpui::test]
    async fn chat_input_draft_is_isolated_per_workspace(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w2".to_owned(),
            branch_name: "repo/w2".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w2"),
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
        state.main_pane = MainPane::Workspace(w1);

        let view_slot: Arc<std::sync::Mutex<Option<gpui::Entity<LubanRootView>>>> =
            Arc::new(std::sync::Mutex::new(None));
        let view_slot_for_window = view_slot.clone();

        let (_, window_cx) = cx.add_window_view(|window, cx| {
            let view = cx.new(|cx| LubanRootView::with_state(services, state, cx));
            *view_slot_for_window.lock().expect("poisoned mutex") = Some(view.clone());
            gpui_component::Root::new(view, window, cx)
        });
        let view = view_slot
            .lock()
            .expect("poisoned mutex")
            .clone()
            .expect("missing view handle");
        window_cx.refresh().unwrap();

        let value = view.read_with(window_cx, |v, cx| {
            v.chat_input
                .as_ref()
                .map(|input| input.read(cx).value().to_string())
        });
        assert_eq!(value, Some("draft-1".to_owned()));

        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                view.dispatch(Action::OpenWorkspace { workspace_id: w2 }, cx);
            });
        });
        window_cx.refresh().unwrap();

        let value = view.read_with(window_cx, |v, cx| {
            v.chat_input
                .as_ref()
                .map(|input| input.read(cx).value().to_string())
        });
        assert_eq!(value, Some("draft-2".to_owned()));

        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                view.dispatch(Action::OpenWorkspace { workspace_id: w1 }, cx);
            });
        });
        window_cx.refresh().unwrap();

        let value = view.read_with(window_cx, |v, cx| {
            v.chat_input
                .as_ref()
                .map(|input| input.read(cx).value().to_string())
        });
        assert_eq!(value, Some("draft-1".to_owned()));
    }

    #[gpui::test]
    async fn chat_input_cursor_moves_to_end_on_workspace_switch(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);

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
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w2".to_owned(),
            branch_name: "repo/w2".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w2"),
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
        state.main_pane = MainPane::Workspace(w1);

        let view_slot: Arc<std::sync::Mutex<Option<gpui::Entity<LubanRootView>>>> =
            Arc::new(std::sync::Mutex::new(None));
        let view_slot_for_window = view_slot.clone();

        let (_, window_cx) = cx.add_window_view(|window, cx| {
            let view = cx.new(|cx| LubanRootView::with_state(services, state, cx));
            *view_slot_for_window.lock().expect("poisoned mutex") = Some(view.clone());
            gpui_component::Root::new(view, window, cx)
        });
        let view = view_slot
            .lock()
            .expect("poisoned mutex")
            .clone()
            .expect("missing view handle");
        window_cx.refresh().unwrap();

        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                view.dispatch(Action::OpenWorkspace { workspace_id: w2 }, cx);
            });
        });
        window_cx.refresh().unwrap();

        let (value, cursor_at_end) = view.read_with(window_cx, |v, cx| {
            let Some(input) = v.chat_input.as_ref() else {
                return (None, false);
            };
            let state = input.read(cx);
            let value = state.value().to_string();
            let end = state.text().offset_to_position(state.text().len());
            (Some(value), state.cursor_position() == end)
        });
        assert_eq!(value, Some("draft-2".to_owned()));
        assert!(cursor_at_end);
    }

    struct FakeGhService {
        pr_numbers: HashMap<PathBuf, Option<PullRequestInfo>>,
    }

    impl ProjectWorkspaceService for FakeGhService {
        fn load_app_state(&self) -> Result<PersistedAppState, String> {
            Ok(PersistedAppState {
                projects: Vec::new(),
                sidebar_width: None,
                terminal_pane_width: None,
                last_open_workspace_id: None,
                workspace_chat_scroll_y10: HashMap::new(),
            })
        }

        fn save_app_state(&self, _snapshot: PersistedAppState) -> Result<(), String> {
            Ok(())
        }

        fn create_workspace(
            &self,
            _project_path: PathBuf,
            _project_slug: String,
        ) -> Result<CreatedWorkspace, String> {
            Ok(CreatedWorkspace {
                workspace_name: "abandon-about".to_owned(),
                branch_name: "luban/abandon-about".to_owned(),
                worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/abandon-about"),
            })
        }

        fn open_workspace_in_ide(&self, _worktree_path: PathBuf) -> Result<(), String> {
            Ok(())
        }

        fn archive_workspace(
            &self,
            _project_path: PathBuf,
            _worktree_path: PathBuf,
        ) -> Result<(), String> {
            Ok(())
        }

        fn ensure_conversation(
            &self,
            _project_slug: String,
            _workspace_name: String,
        ) -> Result<(), String> {
            Ok(())
        }

        fn load_conversation(
            &self,
            _project_slug: String,
            _workspace_name: String,
        ) -> Result<ConversationSnapshot, String> {
            Ok(ConversationSnapshot {
                thread_id: None,
                entries: Vec::new(),
            })
        }

        fn store_context_image(
            &self,
            project_slug: String,
            workspace_name: String,
            image: luban_domain::ContextImage,
        ) -> Result<PathBuf, String> {
            FakeService.store_context_image(project_slug, workspace_name, image)
        }

        fn store_context_text(
            &self,
            project_slug: String,
            workspace_name: String,
            text: String,
            extension: String,
        ) -> Result<PathBuf, String> {
            FakeService.store_context_text(project_slug, workspace_name, text, extension)
        }

        fn store_context_file(
            &self,
            project_slug: String,
            workspace_name: String,
            source_path: PathBuf,
        ) -> Result<PathBuf, String> {
            FakeService.store_context_file(project_slug, workspace_name, source_path)
        }

        fn run_agent_turn_streamed(
            &self,
            request: RunAgentTurnRequest,
            cancel: Arc<AtomicBool>,
            on_event: Arc<dyn Fn(CodexThreadEvent) + Send + Sync>,
        ) -> Result<(), String> {
            FakeService.run_agent_turn_streamed(request, cancel, on_event)
        }

        fn gh_is_authorized(&self) -> Result<bool, String> {
            Ok(true)
        }

        fn gh_pull_request_info(
            &self,
            worktree_path: PathBuf,
        ) -> Result<Option<PullRequestInfo>, String> {
            Ok(self.pr_numbers.get(&worktree_path).copied().flatten())
        }
    }

    #[gpui::test]
    async fn workspace_row_shows_pull_request_number_when_available(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

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
        state.apply(Action::WorkspaceCreated {
            project_id,
            workspace_name: "w2".to_owned(),
            branch_name: "repo/w2".to_owned(),
            worktree_path: PathBuf::from("/tmp/luban/worktrees/repo/w2"),
        });
        state.projects[0].expanded = true;

        let mut pr_numbers = HashMap::new();
        pr_numbers.insert(
            PathBuf::from("/tmp/luban/worktrees/repo/w1"),
            Some(PullRequestInfo {
                number: 123,
                is_draft: false,
                state: PullRequestState::Open,
            }),
        );
        pr_numbers.insert(PathBuf::from("/tmp/luban/worktrees/repo/w2"), None);
        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeGhService { pr_numbers });

        let view_slot: Arc<std::sync::Mutex<Option<gpui::Entity<LubanRootView>>>> =
            Arc::new(std::sync::Mutex::new(None));
        let view_slot_for_window = view_slot.clone();

        let (_, window_cx) = cx.add_window_view(|window, cx| {
            let view = cx.new(|cx| LubanRootView::with_state(services, state, cx));
            *view_slot_for_window.lock().expect("poisoned mutex") = Some(view.clone());
            gpui_component::Root::new(view, window, cx)
        });
        let view = view_slot
            .lock()
            .expect("poisoned mutex")
            .clone()
            .expect("missing view handle");

        window_cx.refresh().unwrap();
        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                view.dispatch(Action::ClearError, cx);
            });
        });

        for _ in 0..8 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        assert!(
            window_cx.debug_bounds("workspace-pr-0-0").is_some(),
            "expected PR label to be rendered for workspace with PR number"
        );
        assert!(
            window_cx.debug_bounds("workspace-pr-0-1").is_none(),
            "expected PR label to be hidden for workspace without PR number"
        );
        assert!(
            window_cx
                .debug_bounds("workspace-git-icon-pr-0-0")
                .is_some(),
            "expected PR icon for workspace with PR number"
        );
        assert!(
            window_cx
                .debug_bounds("workspace-git-icon-branch-0-1")
                .is_some(),
            "expected branch icon for workspace without PR number"
        );
    }

    #[gpui::test]
    async fn success_toast_is_shown_and_auto_dismissed(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);

        let services: Arc<dyn ProjectWorkspaceService> = Arc::new(FakeService);
        let state = AppState::new();

        let (view, window_cx) =
            cx.add_window_view(|_, cx| LubanRootView::with_state(services, state, cx));
        window_cx.simulate_resize(size(px(900.0), px(320.0)));

        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                view.dispatch(
                    Action::AddProject {
                        path: PathBuf::from("/tmp/repo"),
                    },
                    cx,
                );
            });
        });

        for _ in 0..3 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let toast_bounds = window_cx
            .debug_bounds("success-toast")
            .expect("missing success toast bounds");
        assert!(
            toast_bounds.size.height > px(0.0),
            "expected success toast to be visible after AddProject: {toast_bounds:?}"
        );

        let generation = view.read_with(window_cx, |view, _| view.success_toast_generation);
        window_cx.update(|_, app| {
            view.update(app, |view, cx| {
                view.dismiss_success_toast(generation, cx);
            });
        });
        for _ in 0..3 {
            window_cx.run_until_parked();
            window_cx.refresh().unwrap();
        }

        let toast_cleared =
            view.read_with(window_cx, |view, _| view.success_toast_message.is_none());
        assert!(
            toast_cleared,
            "expected success toast message to be cleared"
        );

        let toast_bounds_after = window_cx
            .debug_bounds("success-toast")
            .expect("missing success toast bounds after dismiss");
        assert!(
            toast_bounds_after.size.height <= px(0.0) + px(0.5),
            "expected success toast to be dismissed: {toast_bounds_after:?}"
        );
    }
}
