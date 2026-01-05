use super::*;

impl LubanRootView {
    pub(super) fn render_dashboard(
        &mut self,
        view_handle: gpui::WeakEntity<LubanRootView>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let theme = cx.theme();
        let cards = dashboard_cards(&self.state, &self.workspace_pull_request_numbers);
        let preview_open = self.state.dashboard_preview_workspace_id.is_some();

        let board = if cards.is_empty() {
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .text_color(theme.muted_foreground)
                .child("No workspaces yet.")
                .into_any_element()
        } else {
            let columns = DashboardStage::ALL
                .iter()
                .copied()
                .map(|stage| {
                    let mut stage_cards: Vec<DashboardCardModel> =
                        cards.iter().filter(|c| c.stage == stage).cloned().collect();
                    stage_cards.sort_by(|a, b| b.sort_key.cmp(&a.sort_key));
                    render_dashboard_column(stage, stage_cards, &view_handle, theme, preview_open)
                })
                .collect::<Vec<_>>();

            min_width_zero(min_height_zero(
                div()
                    .flex_1()
                    .relative()
                    .debug_selector(|| "dashboard-board".to_owned())
                    .p_4()
                    .overflow_x_scrollbar()
                    .child(div().flex().flex_row().gap_3().children(columns)),
            ))
            .into_any_element()
        };

        let preview_panel = self
            .state
            .dashboard_preview_workspace_id
            .and_then(|workspace_id| {
                let pr_info = self
                    .workspace_pull_request_numbers
                    .get(&workspace_id)
                    .copied()
                    .flatten();
                dashboard_preview(&self.state, workspace_id, pr_info).map(|model| {
                    render_dashboard_preview_panel(model, &view_handle, theme).into_any_element()
                })
            });

        let preview_overlay = preview_panel.map(|panel| {
            let view_handle = view_handle.clone();
            div()
                .absolute()
                .inset_0()
                .flex()
                .flex_row()
                .child(
                    div()
                        .flex_1()
                        .cursor_pointer()
                        .bg(gpui::rgba(0x00000010))
                        .debug_selector(|| "dashboard-preview-backdrop".to_owned())
                        .on_mouse_down(MouseButton::Left, move |_, _, app| {
                            let _ = view_handle.update(app, |view, cx| {
                                view.dispatch(Action::DashboardPreviewClosed, cx);
                            });
                        }),
                )
                .child(
                    div()
                        .w(px(420.0))
                        .h_full()
                        .flex_shrink_0()
                        .bg(theme.background)
                        .border_l_1()
                        .border_color(theme.border)
                        .child(panel),
                )
                .into_any_element()
        });

        div()
            .flex_1()
            .relative()
            .child(board)
            .when_some(preview_overlay, |s, overlay| s.child(overlay))
            .into_any_element()
    }
}

fn stage_indicator_icon(stage: DashboardStage, theme: &gpui_component::Theme) -> Icon {
    let icon = match stage {
        DashboardStage::Start => Icon::new(Icon::empty().path("icons/circle-dot.svg")),
        DashboardStage::Running => Icon::new(Icon::empty().path("icons/play.svg")),
        DashboardStage::Pending => Icon::new(Icon::empty().path("icons/message-square-more.svg")),
        DashboardStage::Reviewing => Icon::new(IconName::Eye),
        DashboardStage::Finished => Icon::new(Icon::empty().path("icons/book-check.svg")),
    };

    icon.with_size(Size::Small)
        .text_color(theme.muted_foreground)
}

fn render_dashboard_column(
    stage: DashboardStage,
    cards: Vec<DashboardCardModel>,
    view_handle: &gpui::WeakEntity<LubanRootView>,
    theme: &gpui_component::Theme,
    preview_open: bool,
) -> AnyElement {
    let indicator = stage_indicator_icon(stage, theme);

    let header = div()
        .h(px(44.0))
        .px_3()
        .flex()
        .items_center()
        .justify_between()
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(indicator)
                .child(div().text_sm().font_semibold().child(stage.title())),
        )
        .child(
            div()
                .px_2()
                .py_1()
                .rounded_md()
                .bg(theme.muted)
                .text_xs()
                .text_color(theme.muted_foreground)
                .child(format!("{}", cards.len())),
        );

    let body = min_height_zero(
        div()
            .flex_1()
            .overflow_y_scrollbar()
            .p_3()
            .flex()
            .flex_col()
            .gap_4()
            .children(
                cards
                    .into_iter()
                    .map(|card| render_dashboard_card(card, view_handle, theme, preview_open)),
            ),
    );

    div()
        .w(px(320.0))
        .h_full()
        .flex_shrink_0()
        .flex()
        .flex_col()
        .rounded_xl()
        .bg(theme.secondary)
        .debug_selector(move || format!("dashboard-column-{}", stage.debug_id()))
        .child(div().px_3().pt_3().child(header))
        .child(body)
        .into_any_element()
}

fn render_dashboard_card(
    card: DashboardCardModel,
    view_handle: &gpui::WeakEntity<LubanRootView>,
    theme: &gpui_component::Theme,
    preview_open: bool,
) -> AnyElement {
    let DashboardCardModel {
        project_index,
        project_name,
        workspace_name,
        branch_name,
        workspace_id,
        pr_info,
        snippet,
        ..
    } = card;
    let pr_label = pr_info.map(|info| format!("#{}", info.number));
    let snippet = snippet.unwrap_or_else(|| "—".to_owned());
    let debug_selector = format!("dashboard-card-{project_index}-{workspace_name}");

    div()
        .px_3()
        .py_3()
        .rounded_lg()
        .border_1()
        .border_color(theme.border)
        .bg(theme.background)
        .debug_selector(move || debug_selector.clone())
        .when(!preview_open, move |s| {
            s.hover(move |s| {
                s.bg(theme.list_hover)
                    .border_color(theme.scrollbar_thumb_hover)
            })
            .cursor_pointer()
            .on_mouse_down(MouseButton::Left, {
                let view_handle = view_handle.clone();
                move |_, _window, app| {
                    let _ = view_handle.update(app, |view, cx| {
                        view.dispatch(Action::DashboardPreviewOpened { workspace_id }, cx);
                    });
                }
            })
        })
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .truncate()
                        .child(branch_name),
                )
                .when_some(pr_label, |s, label| {
                    s.child(
                        div()
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .bg(theme.muted)
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child(label),
                    )
                }),
        )
        .child(
            div()
                .mt_2()
                .text_sm()
                .font_semibold()
                .truncate()
                .child(workspace_name),
        )
        .child(
            div()
                .mt_3()
                .text_xs()
                .text_color(theme.muted_foreground)
                .truncate()
                .child(snippet),
        )
        .child(
            div().mt_3().flex().items_center().justify_between().child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .truncate()
                    .child(project_name),
            ),
        )
        .into_any_element()
}

fn render_dashboard_preview_panel(
    model: DashboardPreviewModel,
    view_handle: &gpui::WeakEntity<LubanRootView>,
    theme: &gpui_component::Theme,
) -> impl IntoElement {
    let workspace_id = model.workspace_id;
    let stage_label = model.stage.title();
    let project_line = match model.pr_info {
        Some(pr) => format!("{} · {} · #{}", model.project_name, stage_label, pr.number),
        None => format!("{} · {}", model.project_name, stage_label),
    };

    let open_task_button = {
        let view_handle = view_handle.clone();
        Button::new("dashboard-preview-open-task")
            .outline()
            .compact()
            .label("View")
            .tooltip("Open task view")
            .on_click(move |_, _, app| {
                let _ = view_handle.update(app, |view, cx| {
                    view.dispatch(Action::OpenWorkspace { workspace_id }, cx);
                });
            })
    };

    let open_in_zed_button = {
        let view_handle = view_handle.clone();
        Button::new("dashboard-preview-open-zed")
            .outline()
            .compact()
            .icon(IconName::ExternalLink)
            .label("Open in Zed")
            .tooltip("Open in Zed")
            .on_click(move |_, _, app| {
                let _ = view_handle.update(app, |view, cx| {
                    view.dispatch(Action::OpenWorkspaceInIde { workspace_id }, cx);
                });
            })
    };

    let close_button = {
        let view_handle = view_handle.clone();
        Button::new("dashboard-preview-close")
            .ghost()
            .compact()
            .icon(IconName::Close)
            .tooltip("Close preview")
            .on_click(move |_, _, app| {
                let _ = view_handle.update(app, |view, cx| {
                    view.dispatch(Action::DashboardPreviewClosed, cx);
                });
            })
    };

    let messages = div()
        .flex_1()
        .overflow_y_scrollbar()
        .p_3()
        .flex()
        .flex_col()
        .gap_3()
        .children(model.messages.iter().enumerate().map(|(idx, msg)| {
            let id_prefix = format!("dashboard-preview-message-{idx}");
            match msg {
                DashboardPreviewMessage::User(text) => div()
                    .flex()
                    .justify_end()
                    .child(
                        div()
                            .max_w(px(320.0))
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .bg(theme.accent)
                            .child(chat_message_view(&id_prefix, text, None, theme.foreground)),
                    )
                    .into_any_element(),
                DashboardPreviewMessage::Agent(text) => div()
                    .flex()
                    .justify_start()
                    .child(
                        div()
                            .max_w(px(320.0))
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .bg(theme.secondary)
                            .border_1()
                            .border_color(theme.border)
                            .child(chat_message_view(&id_prefix, text, None, theme.foreground)),
                    )
                    .into_any_element(),
            }
        }));

    div()
        .h_full()
        .w_full()
        .bg(theme.background)
        .flex()
        .flex_col()
        .debug_selector(|| "dashboard-preview".to_owned())
        .child(
            div()
                .h(px(44.0))
                .px_3()
                .flex()
                .items_center()
                .justify_between()
                .border_b_1()
                .border_color(theme.border)
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .min_w(px(0.0))
                        .child(
                            div()
                                .text_sm()
                                .font_semibold()
                                .truncate()
                                .child(model.workspace_name),
                        )
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .truncate()
                                .child(project_line),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .debug_selector(|| "dashboard-preview-open-task".to_owned())
                                .child(open_task_button),
                        )
                        .child(
                            div()
                                .debug_selector(|| "dashboard-preview-open-zed".to_owned())
                                .child(open_in_zed_button),
                        )
                        .child(
                            div()
                                .debug_selector(|| "dashboard-preview-close".to_owned())
                                .child(close_button),
                        ),
                ),
        )
        .child(messages)
}
