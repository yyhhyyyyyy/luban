use super::*;

pub(super) fn render_titlebar(
    cx: &mut Context<LubanRootView>,
    state: &AppState,
    sidebar_width: gpui::Pixels,
    right_pane_width: gpui::Pixels,
    terminal_enabled: bool,
) -> AnyElement {
    fn handle_titlebar_double_click(window: &Window) {
        #[cfg(test)]
        {
            window.toggle_fullscreen();
        }

        #[cfg(all(not(test), target_os = "macos"))]
        {
            window.titlebar_double_click();
        }

        #[cfg(all(not(test), not(target_os = "macos")))]
        {
            window.zoom_window();
        }
    }

    let theme = cx.theme();
    let titlebar_height = px(44.0);

    let TitlebarContext {
        branch_label,
        ide_workspace_id,
    } = titlebar_context(state);

    let terminal_toggle_enabled = terminal_enabled && ide_workspace_id.is_some();
    let terminal_toggle_icon = if state.right_pane == RightPane::Terminal {
        IconName::PanelRightClose
    } else {
        IconName::PanelRightOpen
    };
    let terminal_toggle_tooltip = if state.right_pane == RightPane::Terminal {
        "Hide terminal"
    } else {
        "Show terminal"
    };
    let terminal_toggle_button = {
        let view_handle = cx.entity().downgrade();
        Button::new("titlebar-toggle-terminal")
            .ghost()
            .compact()
            .disabled(!terminal_toggle_enabled)
            .icon(terminal_toggle_icon)
            .tooltip(terminal_toggle_tooltip)
            .on_click(move |_, _, app| {
                if !terminal_toggle_enabled {
                    return;
                }
                let _ = view_handle.update(app, |view, cx| {
                    view.dispatch(Action::ToggleTerminalPane, cx);
                });
            })
    };

    let open_in_zed_button = ide_workspace_id.map(|workspace_id| {
        let view_handle = cx.entity().downgrade();
        Button::new("workspace-open-in-zed")
            .outline()
            .compact()
            .icon(IconName::ExternalLink)
            .label("Open")
            .tooltip("Open in Zed")
            .on_click(move |_, _, app| {
                let _ = view_handle.update(app, |view, cx| {
                    view.dispatch(Action::OpenWorkspaceInIde { workspace_id }, cx);
                });
            })
    });

    let view_handle = cx.entity().downgrade();
    let add_project_button = {
        let view_handle = view_handle.clone();
        move || {
            let view_handle = view_handle.clone();
            Button::new("add-project")
                .ghost()
                .compact()
                .icon(Icon::new(IconName::Plus).text_color(theme.muted_foreground))
                .tooltip("Add project")
                .on_click(move |_, _window, app| {
                    let view_handle = view_handle.clone();
                    let options = gpui::PathPromptOptions {
                        files: false,
                        directories: true,
                        multiple: false,
                        prompt: Some("Add Project".into()),
                    };

                    let receiver = app.prompt_for_paths(options);
                    app.spawn(move |cx: &mut gpui::AsyncApp| {
                        let mut async_cx = cx.clone();
                        async move {
                            let Ok(result) = receiver.await else {
                                return;
                            };
                            let Ok(Some(mut paths)) = result else {
                                return;
                            };
                            let Some(path) = paths.pop() else {
                                return;
                            };

                            let _ = view_handle.update(
                                &mut async_cx,
                                |view: &mut LubanRootView, view_cx: &mut Context<LubanRootView>| {
                                    view.dispatch(Action::AddProject { path }, view_cx);
                                },
                            );
                        }
                    })
                    .detach();
                })
        }
    };

    let is_dashboard_selected = state.main_pane == MainPane::Dashboard;

    let sidebar_titlebar = if is_dashboard_selected || sidebar_width <= px(0.0) {
        div()
            .w(px(0.0))
            .h(titlebar_height)
            .hidden()
            .into_any_element()
    } else {
        div()
            .w(sidebar_width)
            .h(titlebar_height)
            .flex_shrink_0()
            .flex()
            .items_center()
            .bg(theme.sidebar)
            .text_color(theme.sidebar_foreground)
            .border_r_1()
            .border_color(theme.sidebar_border)
            .border_b_1()
            .border_color(theme.sidebar_border)
            .debug_selector(|| "titlebar-sidebar".to_owned())
            .child(
                div()
                    .h_full()
                    .mx_3()
                    .w_full()
                    .flex()
                    .items_center()
                    .child(div().flex_1())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .debug_selector(|| "titlebar-dashboard-title".to_owned())
                            .cursor_pointer()
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|this, _, _, cx| {
                                    this.dispatch(Action::OpenDashboard, cx);
                                }),
                            )
                            .child(
                                Icon::new(IconName::GalleryVerticalEnd)
                                    .with_size(Size::Small)
                                    .text_color(if is_dashboard_selected {
                                        theme.sidebar_primary
                                    } else {
                                        theme.muted_foreground
                                    }),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .font_semibold()
                                    .text_color(if is_dashboard_selected {
                                        theme.sidebar_primary
                                    } else {
                                        theme.muted_foreground
                                    })
                                    .child("Dashboard"),
                            ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .justify_end()
                            .debug_selector(|| "add-project".to_owned())
                            .child(add_project_button()),
                    ),
            )
            .into_any_element()
    };

    let branch_indicator = div()
        .flex()
        .items_center()
        .gap_2()
        .child(
            div()
                .debug_selector(|| "titlebar-branch-symbol".to_owned())
                .text_sm()
                .text_color(theme.muted_foreground)
                .child("⎇"),
        )
        .child(div().text_sm().child(branch_label));

    let dashboard_indicator = div()
        .flex()
        .items_center()
        .gap_2()
        .debug_selector(|| "titlebar-dashboard-title".to_owned())
        .cursor_pointer()
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(|this, _, _, cx| {
                this.dispatch(Action::OpenDashboard, cx);
            }),
        )
        .child(
            Icon::new(IconName::GalleryVerticalEnd)
                .with_size(Size::Small)
                .text_color(theme.muted_foreground),
        )
        .child(div().text_sm().font_semibold().child("Dashboard"));

    let titlebar_zoom_area = div()
        .flex_1()
        .h(titlebar_height)
        .flex()
        .items_center()
        .debug_selector(|| "titlebar-zoom-area".to_owned())
        .on_mouse_down(MouseButton::Left, move |event, window, _| {
            if event.click_count != 2 {
                return;
            }
            handle_titlebar_double_click(window);
        })
        .child(branch_indicator);

    let main_titlebar = if is_dashboard_selected {
        let control_width = px(44.0);
        div()
            .flex_1()
            .h(titlebar_height)
            .px_4()
            .flex()
            .items_center()
            .border_b_1()
            .border_color(theme.title_bar_border)
            .bg(theme.title_bar)
            .debug_selector(|| "titlebar-main".to_owned())
            .on_mouse_down(MouseButton::Left, move |event, window, _| {
                if event.click_count != 2 {
                    return;
                }
                handle_titlebar_double_click(window);
            })
            .child(div().w(control_width).flex_shrink_0())
            .child(
                div()
                    .flex_1()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(dashboard_indicator),
            )
            .child(
                div()
                    .w(control_width)
                    .flex_shrink_0()
                    .flex()
                    .justify_end()
                    .debug_selector(|| "add-project".to_owned())
                    .child(add_project_button()),
            )
            .into_any_element()
    } else {
        div()
            .flex_1()
            .h(titlebar_height)
            .px_4()
            .flex()
            .items_center()
            .justify_between()
            .border_b_1()
            .border_color(theme.title_bar_border)
            .bg(theme.title_bar)
            .debug_selector(|| "titlebar-main".to_owned())
            .child(min_width_zero(titlebar_zoom_area))
            .when_some(open_in_zed_button, |s, button| {
                s.child(
                    div()
                        .debug_selector(|| "titlebar-open-in-zed".to_owned())
                        .child(button)
                        .flex_shrink_0(),
                )
            })
            .into_any_element()
    };

    let terminal_titlebar = {
        let title = ide_workspace_id.and_then(|workspace_id| {
            state
                .workspace(workspace_id)
                .map(|w| w.workspace_name.clone())
        });
        let right_width = if state.right_pane == RightPane::Terminal && terminal_toggle_enabled {
            right_pane_width
        } else if terminal_toggle_enabled {
            px(44.0)
        } else {
            px(0.0)
        };

        div()
            .w(right_width)
            .h(titlebar_height)
            .flex_shrink_0()
            .flex()
            .items_center()
            .justify_between()
            .px_3()
            .border_b_1()
            .border_color(theme.title_bar_border)
            .bg(theme.title_bar)
            .when(right_width > px(0.0), |s| {
                s.border_l_1().border_color(theme.border)
            })
            .debug_selector(|| "titlebar-terminal".to_owned())
            .when(
                state.right_pane == RightPane::Terminal && terminal_toggle_enabled,
                |s| {
                    s.child(div().text_sm().font_semibold().child("Terminal"))
                        .child(min_width_zero(
                            div()
                                .flex_1()
                                .px_2()
                                .truncate()
                                .text_sm()
                                .child(title.unwrap_or_default()),
                        ))
                },
            )
            .child(
                div()
                    .debug_selector(|| "titlebar-toggle-terminal".to_owned())
                    .child(terminal_toggle_button),
            )
    };

    div()
        .w_full()
        .flex()
        .child(sidebar_titlebar)
        .child(main_titlebar)
        .child(terminal_titlebar)
        .into_any_element()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct TitlebarContext {
    pub(super) branch_label: String,
    pub(super) ide_workspace_id: Option<WorkspaceId>,
}

pub(super) fn titlebar_context(state: &AppState) -> TitlebarContext {
    let active_workspace = match state.main_pane {
        MainPane::Workspace(workspace_id) => state.workspace(workspace_id),
        MainPane::Dashboard | MainPane::ProjectSettings(_) | MainPane::None => None,
    };
    let fallback_title = main_pane_title(state, state.main_pane);

    TitlebarContext {
        branch_label: active_workspace
            .map(|workspace| workspace.branch_name.clone())
            .unwrap_or(fallback_title),
        ide_workspace_id: active_workspace.map(|workspace| workspace.id),
    }
}
