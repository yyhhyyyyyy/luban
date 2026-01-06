use gpui::prelude::*;

use super::{Action, Context, LubanRootView, Pixels, RightPane, Window, div, px};

pub(super) const TERMINAL_PANE_RESIZER_WIDTH: f32 = 6.0;
pub(super) const SIDEBAR_RESIZER_WIDTH: f32 = 6.0;
pub(super) const DASHBOARD_PREVIEW_RESIZER_WIDTH: f32 = 6.0;
pub(super) const RIGHT_PANE_CONTENT_PADDING: f32 = 8.0;
pub(super) const TITLEBAR_HEIGHT: f32 = 44.0;

#[derive(Clone, Copy, Debug)]
pub(super) struct TerminalPaneResizeState {
    pub(super) start_mouse_x: Pixels,
    pub(super) start_width: Pixels,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct TerminalPaneResizeDrag;

pub(super) struct TerminalPaneResizeGhost;

impl gpui::Render for TerminalPaneResizeGhost {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl gpui::IntoElement {
        div().w(px(0.0)).h(px(0.0)).hidden()
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) struct SidebarResizeState {
    pub(super) start_mouse_x: Pixels,
    pub(super) start_width: Pixels,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct SidebarResizeDrag;

pub(super) struct SidebarResizeGhost;

impl gpui::Render for SidebarResizeGhost {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl gpui::IntoElement {
        div().w(px(0.0)).h(px(0.0)).hidden()
    }
}

#[derive(Clone, Copy, Debug)]
pub(super) struct DashboardPreviewResizeState {
    pub(super) start_mouse_x: Pixels,
    pub(super) start_width: Pixels,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct DashboardPreviewResizeDrag;

pub(super) struct DashboardPreviewResizeGhost;

impl gpui::Render for DashboardPreviewResizeGhost {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl gpui::IntoElement {
        div().w(px(0.0)).h(px(0.0)).hidden()
    }
}

impl LubanRootView {
    pub(super) fn ensure_terminal_resize_observer(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
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

    pub(super) fn sidebar_width(&self, window: &Window) -> Pixels {
        let viewport_width = window.viewport_size().width;
        let desired = self
            .sidebar_width_preview
            .or_else(|| self.state.sidebar_width.map(|v| px(v as f32)))
            .unwrap_or(px(300.0));
        self.clamp_sidebar_width(desired, viewport_width)
    }

    pub(super) fn clamp_sidebar_width(&self, desired: Pixels, viewport_width: Pixels) -> Pixels {
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

    pub(super) fn finish_sidebar_resize(&mut self, viewport_width: Pixels, cx: &mut Context<Self>) {
        self.sidebar_resize = None;

        let Some(preview) = self.sidebar_width_preview.take() else {
            return;
        };

        let clamped = self.clamp_sidebar_width(preview, viewport_width);
        let width = f32::from(clamped).round().max(0.0) as u16;
        self.dispatch(Action::SidebarWidthChanged { width }, cx);
    }

    pub(super) fn right_pane_width(&self, window: &Window, sidebar_width: Pixels) -> Pixels {
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

    pub(super) fn clamp_terminal_pane_width(
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

    pub(super) fn finish_terminal_pane_resize(
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

    pub(super) fn dashboard_preview_width(&self, window: &Window) -> Pixels {
        let viewport_width = window.viewport_size().width;
        let desired = self
            .dashboard_preview_width_preview
            .unwrap_or(self.last_dashboard_preview_width);
        self.clamp_dashboard_preview_width(desired, viewport_width)
    }

    pub(super) fn clamp_dashboard_preview_width(
        &self,
        desired: Pixels,
        viewport_width: Pixels,
    ) -> Pixels {
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

    pub(super) fn finish_dashboard_preview_resize(
        &mut self,
        viewport_width: Pixels,
        cx: &mut Context<Self>,
    ) {
        self.dashboard_preview_resize = None;

        let Some(preview) = self.dashboard_preview_width_preview.take() else {
            return;
        };

        let clamped = self.clamp_dashboard_preview_width(preview, viewport_width);
        self.last_dashboard_preview_width = px(f32::from(clamped).round().max(0.0));
        cx.notify();
    }
}
