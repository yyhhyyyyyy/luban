use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) struct WorkspaceThreadTabReorderState {
    pub(super) workspace_id: WorkspaceId,
    pub(super) thread_id: WorkspaceThreadId,
}

#[derive(Clone, Copy, Debug)]
struct WorkspaceThreadTabReorderDrag;

struct WorkspaceThreadTabReorderGhost;

impl gpui::Render for WorkspaceThreadTabReorderGhost {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div().w(px(0.0)).h(px(0.0)).hidden()
    }
}

impl LubanRootView {
    pub(super) fn render_workspace_thread_tabs(
        &self,
        workspace_id: WorkspaceId,
        active_thread_id: WorkspaceThreadId,
        view_handle: &gpui::WeakEntity<LubanRootView>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let theme = cx.theme();
        let Some(tabs) = self.state.workspace_tabs(workspace_id) else {
            return div().hidden().into_any_element();
        };

        let open_tabs = tabs.open_tabs.clone();
        let archived_tabs = tabs.archived_tabs.clone();
        let allow_close = open_tabs.len() > 1;

        let view_handle_for_overflow = view_handle.clone();
        let open_entries = open_tabs
            .iter()
            .map(|thread_id| {
                let title = self
                    .state
                    .workspace_thread_conversation(workspace_id, *thread_id)
                    .map(|c| c.title.clone())
                    .unwrap_or_else(|| format!("Thread {}", thread_id.as_u64()));
                (*thread_id, title)
            })
            .collect::<Vec<_>>();
        let archived_entries = archived_tabs
            .iter()
            .map(|thread_id| {
                let title = self
                    .state
                    .workspace_thread_conversation(workspace_id, *thread_id)
                    .map(|c| c.title.clone())
                    .unwrap_or_else(|| format!("Thread {}", thread_id.as_u64()));
                (*thread_id, title)
            })
            .collect::<Vec<_>>();

        let overflow = Popover::new("workspace-thread-tabs-menu")
            .appearance(true)
            .anchor(gpui::Corner::TopLeft)
            .trigger(
                Button::new("workspace-thread-tabs-menu-trigger")
                    .ghost()
                    .compact()
                    .with_size(Size::Small)
                    .icon(Icon::new(IconName::ChevronDown))
                    .debug_selector(|| "workspace-thread-tabs-menu-trigger".to_owned()),
            )
            .content(move |_popover_state, _window, cx| {
                let theme = cx.theme();
                let popover_handle = cx.entity();
                let scroll_handle = gpui::ScrollHandle::new();
                let scroll_handle_overlay = scroll_handle.clone();
                let has_archived = !archived_entries.is_empty();

                let active_header = div()
                    .debug_selector(|| "workspace-thread-tabs-menu-active-section".to_owned())
                    .px_2()
                    .pt_2()
                    .pb_1()
                    .text_xs()
                    .font_semibold()
                    .text_color(theme.muted_foreground)
                    .child("Active");

                let archived_header = div()
                    .debug_selector(|| "workspace-thread-tabs-menu-archived-section".to_owned())
                    .px_2()
                    .pt_3()
                    .pb_1()
                    .text_xs()
                    .font_semibold()
                    .text_color(theme.muted_foreground)
                    .child("Archived");

                let active_items =
                    open_entries
                        .iter()
                        .enumerate()
                        .map(|(idx, (thread_id, title))| {
                            let selected = *thread_id == active_thread_id;
                            let view_handle = view_handle_for_overflow.clone();
                            let thread_id = *thread_id;
                            let popover_handle_for_row = popover_handle.clone();
                            let popover_handle_for_archive = popover_handle.clone();
                            let row_id = format!("workspace-thread-tabs-menu-active-{idx}");
                            let archive_id =
                                format!("workspace-thread-tabs-menu-active-archive-{idx}");
                            let view_handle_archive = view_handle_for_overflow.clone();
                            let row_bg = if selected {
                                theme.sidebar_accent
                            } else {
                                theme.transparent
                            };
                            let hover_bg = if selected {
                                theme.sidebar_accent
                            } else {
                                theme.list_hover
                            };
                            let row_fg = if selected {
                                theme.sidebar_accent_foreground
                            } else {
                                theme.foreground
                            };

                            div()
                                .h(px(32.0))
                                .w_full()
                                .px_2()
                                .rounded_md()
                                .flex()
                                .items_center()
                                .justify_between()
                                .cursor_pointer()
                                .debug_selector(move || row_id.clone())
                                .bg(row_bg)
                                .text_color(row_fg)
                                .when(selected, |s| s.font_semibold())
                                .hover(move |s| s.bg(hover_bg))
                                .on_mouse_down(MouseButton::Left, move |_, window, app| {
                                    let _ = view_handle.update(app, |view, cx| {
                                        view.dispatch(
                                            Action::ActivateWorkspaceThread {
                                                workspace_id,
                                                thread_id,
                                            },
                                            cx,
                                        );
                                    });
                                    popover_handle_for_row
                                        .update(app, |state, cx| state.dismiss(window, cx));
                                })
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w(px(0.0))
                                        .truncate()
                                        .child(title.clone()),
                                )
                                .child(
                                    div().flex().items_center().gap_1().child(
                                        Button::new(archive_id.clone())
                                            .ghost()
                                            .compact()
                                            .with_size(Size::Small)
                                            .disabled(!allow_close)
                                            .icon(Icon::new(IconName::Close))
                                            .tooltip("Archive tab")
                                            .on_click(move |_, window, app| {
                                                if !allow_close {
                                                    return;
                                                }
                                                let _ =
                                                    view_handle_archive.update(app, |view, cx| {
                                                        view.dispatch(
                                                            Action::CloseWorkspaceThreadTab {
                                                                workspace_id,
                                                                thread_id,
                                                            },
                                                            cx,
                                                        );
                                                    });
                                                popover_handle_for_archive.update(
                                                    app,
                                                    |state, cx| {
                                                        state.dismiss(window, cx);
                                                    },
                                                );
                                            })
                                            .into_any_element(),
                                    ),
                                )
                                .into_any_element()
                        });

                let archived_items =
                    archived_entries
                        .iter()
                        .enumerate()
                        .map(|(idx, (thread_id, title))| {
                            let view_handle = view_handle_for_overflow.clone();
                            let thread_id = *thread_id;
                            let popover_handle_for_row = popover_handle.clone();
                            let popover_handle_for_restore = popover_handle.clone();
                            let row_id = format!("workspace-thread-tabs-menu-archived-{idx}");
                            let restore_id =
                                format!("workspace-thread-tabs-menu-archived-restore-{idx}");
                            let view_handle_restore = view_handle_for_overflow.clone();

                            div()
                                .h(px(32.0))
                                .w_full()
                                .px_2()
                                .rounded_md()
                                .flex()
                                .items_center()
                                .justify_between()
                                .cursor_pointer()
                                .debug_selector(move || row_id.clone())
                                .hover(move |s| s.bg(theme.list_hover))
                                .on_mouse_down(MouseButton::Left, move |_, window, app| {
                                    let _ = view_handle.update(app, |view, cx| {
                                        view.dispatch(
                                            Action::RestoreWorkspaceThreadTab {
                                                workspace_id,
                                                thread_id,
                                            },
                                            cx,
                                        );
                                    });
                                    popover_handle_for_row
                                        .update(app, |state, cx| state.dismiss(window, cx));
                                })
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w(px(0.0))
                                        .truncate()
                                        .child(title.clone()),
                                )
                                .child(
                                    Button::new(restore_id.clone())
                                        .ghost()
                                        .compact()
                                        .with_size(Size::Small)
                                        .icon(Icon::new(IconName::Redo2))
                                        .tooltip("Restore tab")
                                        .on_click(move |_, window, app| {
                                            let _ = view_handle_restore.update(app, |view, cx| {
                                                view.dispatch(
                                                    Action::RestoreWorkspaceThreadTab {
                                                        workspace_id,
                                                        thread_id,
                                                    },
                                                    cx,
                                                );
                                            });
                                            popover_handle_for_restore.update(app, |state, cx| {
                                                state.dismiss(window, cx);
                                            });
                                        })
                                        .into_any_element(),
                                )
                                .into_any_element()
                        });

                div()
                    .w(px(320.0))
                    .max_h(px(360.0))
                    .pt_1()
                    .pb_2()
                    .relative()
                    .child(
                        div()
                            .id("workspace-thread-tabs-menu-scroll")
                            .debug_selector(|| "workspace-thread-tabs-menu-scroll".to_owned())
                            .overflow_y_scroll()
                            .track_scroll(&scroll_handle)
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_1()
                                    .child(active_header)
                                    .children(active_items)
                                    .when(has_archived, move |s| {
                                        s.child(archived_header).children(archived_items)
                                    }),
                            ),
                    )
                    .child(
                        div()
                            .absolute()
                            .top_0()
                            .left_0()
                            .right_0()
                            .bottom_0()
                            .debug_selector(|| "workspace-thread-tabs-menu-scrollbar".to_owned())
                            .child(
                                Scrollbar::vertical(&scroll_handle_overlay)
                                    .id("workspace-thread-tabs-menu-scrollbar")
                                    .scrollbar_show(ScrollbarShow::Always),
                            ),
                    )
                    .into_any_element()
            });

        let tab_children = open_tabs.iter().enumerate().map(|(idx, thread_id)| {
            let thread_id = *thread_id;
            let is_active = thread_id == active_thread_id;
            let title = self
                .state
                .workspace_thread_conversation(workspace_id, thread_id)
                .map(|c| c.title.clone())
                .unwrap_or_else(|| format!("Thread {}", thread_id.as_u64()));
            let running = self
                .state
                .workspace_thread_conversation(workspace_id, thread_id)
                .map(|c| c.run_status == OperationStatus::Running)
                .unwrap_or(false);
            let dirty = self
                .state
                .workspace_thread_conversation(workspace_id, thread_id)
                .map(|c| !c.draft.is_empty() || !c.draft_attachments.is_empty())
                .unwrap_or(false);

            let view_handle_activate = view_handle.clone();
            let view_handle_close = view_handle.clone();
            let view_handle_reorder = view_handle.clone();
            let view_handle_bounds = view_handle.clone();
            let button_id = format!("workspace-thread-tab-{idx}");
            let close_id = format!("workspace-thread-tab-close-{idx}");

            let status_dot = div()
                .w(px(8.0))
                .h(px(8.0))
                .rounded_full()
                .bg(theme.accent)
                .when(!dirty, |s| s.invisible());

            div()
                .id(button_id.clone())
                .debug_selector(move || button_id.clone())
                .h(px(36.0))
                .flex_1()
                .min_w(px(56.0))
                .max_w(px(240.0))
                .px_3()
                .flex()
                .items_center()
                .gap_2()
                .group("")
                .cursor_pointer()
                .border_r_1()
                .border_color(theme.border)
                .bg(if is_active {
                    theme.background
                } else {
                    theme.muted
                })
                .hover(move |s| s.bg(theme.secondary_hover))
                .when(is_active, |s| s.border_b_1().border_color(theme.background))
                .on_prepaint(move |bounds, _window, app| {
                    let _ = view_handle_bounds.update(app, |view, _cx| {
                        view.workspace_thread_tab_bounds
                            .insert((workspace_id, thread_id), bounds);
                    });
                })
                .on_drag(WorkspaceThreadTabReorderDrag, {
                    let view_handle = view_handle_reorder.clone();
                    move |_, _offset, _window, app| {
                        let _ = view_handle.update(app, |view, cx| {
                            view.workspace_thread_tab_reorder =
                                Some(WorkspaceThreadTabReorderState {
                                    workspace_id,
                                    thread_id,
                                });
                            cx.notify();
                        });
                        app.new(|_| WorkspaceThreadTabReorderGhost)
                    }
                })
                .on_drag_move::<WorkspaceThreadTabReorderDrag>({
                    let view_handle = view_handle_reorder.clone();
                    move |event, _window, app| {
                        let mouse_x = event.event.position.x;
                        let _ = view_handle.update(app, |view, cx| {
                            view.update_workspace_thread_tab_reorder(mouse_x, cx);
                        });
                    }
                })
                .on_mouse_down(MouseButton::Left, move |_, _, app| {
                    let _ = view_handle_activate.update(app, |view, cx| {
                        view.dispatch(
                            Action::ActivateWorkspaceThread {
                                workspace_id,
                                thread_id,
                            },
                            cx,
                        );
                    });
                })
                .child(status_dot)
                .when(running, |s| {
                    s.child(Spinner::new().with_size(Size::XSmall).into_any_element())
                })
                .child(
                    div()
                        .flex_1()
                        .min_w(px(0.0))
                        .truncate()
                        .text_color(if is_active {
                            theme.foreground
                        } else {
                            theme.muted_foreground
                        })
                        .when(is_active, |s| s.font_semibold())
                        .child(title),
                )
                .when(allow_close, |s| {
                    s.child(
                        div()
                            .w(px(24.0))
                            .h(px(24.0))
                            .invisible()
                            .when(is_active, |s| s.visible())
                            .group_hover("", |s| s.visible())
                            .child(
                                Button::new(close_id.clone())
                                    .ghost()
                                    .compact()
                                    .with_size(Size::Small)
                                    .icon(Icon::new(IconName::Close))
                                    .on_click(move |_, _, app| {
                                        let _ = view_handle_close.update(app, |view, cx| {
                                            view.dispatch(
                                                Action::CloseWorkspaceThreadTab {
                                                    workspace_id,
                                                    thread_id,
                                                },
                                                cx,
                                            );
                                        });
                                    })
                                    .into_any_element(),
                            ),
                    )
                })
                .into_any_element()
        });

        let view_handle_for_new = view_handle.clone();
        let new_tab = Button::new("workspace-thread-tab-new")
            .ghost()
            .compact()
            .with_size(Size::Small)
            .icon(Icon::new(IconName::Plus))
            .debug_selector(|| "workspace-thread-tab-new".to_owned())
            .tooltip("New thread")
            .on_click(move |_, _, app| {
                let _ = view_handle_for_new.update(app, |view, cx| {
                    view.dispatch(Action::CreateWorkspaceThread { workspace_id }, cx);
                });
            });

        div()
            .debug_selector(|| "workspace-thread-tabs".to_owned())
            .h(px(36.0))
            .w_full()
            .px_0()
            .flex()
            .items_center()
            .gap_0()
            .border_b_1()
            .border_color(theme.border)
            .bg(theme.muted)
            .on_mouse_up(MouseButton::Left, {
                let view_handle = view_handle.clone();
                move |_, _window, app| {
                    let _ = view_handle.update(app, |view, cx| {
                        view.finish_workspace_thread_tab_reorder(cx);
                    });
                }
            })
            .on_mouse_up_out(MouseButton::Left, {
                let view_handle = view_handle.clone();
                move |_, _window, app| {
                    let _ = view_handle.update(app, |view, cx| {
                        view.finish_workspace_thread_tab_reorder(cx);
                    });
                }
            })
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .overflow_x_hidden()
                    .child(div().flex().items_center().children(tab_children)),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .px_2()
                    .child(new_tab)
                    .child(overflow),
            )
            .into_any_element()
    }

    fn update_workspace_thread_tab_reorder(&mut self, mouse_x: Pixels, cx: &mut Context<Self>) {
        let Some(state) = self.workspace_thread_tab_reorder else {
            return;
        };
        let Some(tabs) = self.state.workspace_tabs(state.workspace_id) else {
            return;
        };
        if tabs.open_tabs.len() <= 1 {
            return;
        }

        let mut to_index = tabs.open_tabs.len().saturating_sub(1);
        for (idx, thread_id) in tabs.open_tabs.iter().enumerate() {
            let Some(bounds) = self
                .workspace_thread_tab_bounds
                .get(&(state.workspace_id, *thread_id))
                .copied()
            else {
                return;
            };
            if mouse_x < bounds.center().x {
                to_index = idx;
                break;
            }
        }

        self.dispatch(
            Action::ReorderWorkspaceThreadTab {
                workspace_id: state.workspace_id,
                thread_id: state.thread_id,
                to_index,
            },
            cx,
        );
    }

    fn finish_workspace_thread_tab_reorder(&mut self, cx: &mut Context<Self>) {
        if self.workspace_thread_tab_reorder.take().is_some() {
            self.dispatch(Action::SaveAppState, cx);
        }
    }
}
