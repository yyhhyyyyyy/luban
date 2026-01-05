use super::*;

impl LubanRootView {
    fn right_pane_grid_size(
        &self,
        window: &mut Window,
        sidebar_width: Pixels,
    ) -> Option<(u16, u16)> {
        let right_pane_width = self.right_pane_width(window, sidebar_width);
        let inset = RIGHT_PANE_CONTENT_PADDING * 2.0;
        let width = (f32::from(right_pane_width) - inset).max(1.0);
        let height =
            (f32::from(window.viewport_size().height) - f32::from(px(44.0)) - inset).max(1.0);

        let (cell_width, cell_height) = terminal_cell_metrics(window)?;
        let cols = (width / cell_width).floor().max(1.0) as u16;
        let rows = (height / cell_height).floor().max(1.0) as u16;
        Some((cols, rows))
    }

    pub(super) fn resize_workspace_terminals(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let sidebar_width = self.sidebar_width(window);
        let Some((cols, rows)) = self.right_pane_grid_size(window, sidebar_width) else {
            return;
        };
        #[cfg(test)]
        {
            self.last_terminal_grid_size = Some((cols, rows));
        }
        for terminal in self.workspace_terminals.values() {
            if terminal.is_closed() {
                continue;
            }
            terminal.resize(cols, rows, cx);
        }
    }

    fn ensure_workspace_terminal(
        &mut self,
        workspace_id: WorkspaceId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<gpui::Entity<gpui_ghostty_terminal::view::TerminalView>> {
        if !self.terminal_enabled {
            return None;
        }
        if self.workspace_terminal_errors.contains_key(&workspace_id) {
            return None;
        }
        if let Some(terminal) = self.workspace_terminals.get(&workspace_id) {
            return Some(terminal.view());
        }

        let (_, worktree_path) = workspace_context(&self.state, workspace_id)?;
        match spawn_workspace_terminal(cx, window, worktree_path) {
            Ok(terminal) => {
                self.workspace_terminals.insert(workspace_id, terminal);
                self.resize_workspace_terminals(window, cx);
                self.workspace_terminals
                    .get(&workspace_id)
                    .map(|t| t.view())
            }
            Err(message) => {
                self.workspace_terminal_errors.insert(workspace_id, message);
                None
            }
        }
    }

    pub(super) fn render_right_pane(
        &mut self,
        right_pane_width: Pixels,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let MainPane::Workspace(workspace_id) = self.state.main_pane else {
            return div().into_any_element();
        };

        let error = self.workspace_terminal_errors.get(&workspace_id).cloned();
        let terminal_view = if error.is_none() {
            self.ensure_workspace_terminal(workspace_id, window, cx)
        } else {
            None
        };

        let theme = cx.theme();

        div()
            .debug_selector(|| "workspace-right-pane".to_owned())
            .w(right_pane_width)
            .h_full()
            .flex()
            .flex_col()
            .bg(theme.secondary)
            .border_l_1()
            .border_color(theme.border)
            .child(
                div()
                    .flex_1()
                    .h_full()
                    .p(px(RIGHT_PANE_CONTENT_PADDING))
                    .cursor(CursorStyle::IBeam)
                    .child(
                        error
                            .map(|message| {
                                div()
                                    .p_3()
                                    .text_color(theme.danger_foreground)
                                    .child(message)
                                    .into_any_element()
                            })
                            .or_else(|| {
                                terminal_view.map(|v| div().size_full().child(v).into_any_element())
                            })
                            .unwrap_or_else(|| div().into_any_element()),
                    ),
            )
            .into_any_element()
    }
}
