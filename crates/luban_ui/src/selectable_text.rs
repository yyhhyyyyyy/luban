use std::ops::Range;

use gpui::InteractiveElement as _;
use gpui::ParentElement as _;
use gpui::{
    AnyElement, App, BorderStyle, Bounds, Context, CursorStyle, Edges, Element, ElementId, Entity,
    GlobalElementId, Hitbox, HitboxBehavior, InspectorElementId, IntoElement, LayoutId,
    MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels, SharedString,
    StyleRefinement, Styled, StyledText, TextLayout, Window, point, px, quad, transparent_black,
};
use gpui_component::ActiveTheme as _;
use gpui_component::StyledExt as _;
use gpui_component::input::Copy;

#[derive(Clone)]
pub(crate) struct SelectablePlainText {
    id: SharedString,
    text: SharedString,
    style: StyleRefinement,
}

impl SelectablePlainText {
    pub(crate) fn new(id: impl Into<SharedString>, text: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            text: text.into(),
            style: StyleRefinement::default(),
        }
    }
}

impl Styled for SelectablePlainText {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl IntoElement for SelectablePlainText {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

pub(crate) struct SelectablePlainTextLayoutState {
    element: AnyElement,
}

impl Element for SelectablePlainText {
    type RequestLayoutState = SelectablePlainTextLayoutState;
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        Some(ElementId::Name(self.id.clone()))
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let state = window.use_keyed_state(
            ElementId::Name(SharedString::from(format!("{}/state", self.id))),
            cx,
            |_, cx| SelectablePlainTextState::new(cx),
        );

        state.update(cx, |state, cx| {
            state.set_text(self.text.clone(), cx);
        });

        let focus_handle = state.read(cx).focus_handle.clone();
        let content = SelectablePlainTextContent {
            id: self.id.clone(),
            text: self.text.clone(),
            state: state.clone(),
            styled_text: StyledText::new(self.text.clone()),
        };

        let mut el = gpui::div()
            .key_context("TextView")
            .track_focus(&focus_handle)
            .on_action(window.listener_for(&state, SelectablePlainTextState::on_action_copy))
            .child(content)
            .refine_style(&self.style)
            .into_any_element();

        let layout_id = el.request_layout(window, cx);
        (layout_id, SelectablePlainTextLayoutState { element: el })
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        request_layout.element.prepaint(window, cx);
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        request_layout: &mut Self::RequestLayoutState,
        _: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        request_layout.element.paint(window, cx);
    }
}

struct SelectablePlainTextContent {
    id: SharedString,
    text: SharedString,
    state: Entity<SelectablePlainTextState>,
    styled_text: StyledText,
}

impl IntoElement for SelectablePlainTextContent {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for SelectablePlainTextContent {
    type RequestLayoutState = ();
    type PrepaintState = Hitbox;

    fn id(&self) -> Option<ElementId> {
        Some(ElementId::Name(SharedString::from(format!(
            "{}/content",
            self.id
        ))))
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let (layout_id, _) = self
            .styled_text
            .request_layout(id, inspector_id, window, cx);
        (layout_id, ())
    }

    fn prepaint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        self.styled_text
            .prepaint(id, inspector_id, bounds, &mut (), window, cx);
        window.insert_hitbox(bounds, HitboxBehavior::Normal)
    }

    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        hitbox: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let current_view = window.current_view();
        let state = self.state.clone();
        let text_len = self.text.len();
        let text_layout = self.styled_text.layout().clone();
        let is_selecting = state.read(cx).is_selecting;
        let has_selection = state.read(cx).has_selection();

        if hitbox.is_hovered(window) || has_selection {
            window.set_cursor_style(CursorStyle::IBeam, hitbox);
        }

        if let Some(selection) = state.read(cx).selection {
            paint_selection(selection, &text_layout, &bounds, window, cx);
        }

        self.styled_text
            .paint(id, inspector_id, bounds, &mut (), &mut (), window, cx);

        window.on_mouse_event({
            let text_layout = text_layout.clone();
            let state = state.clone();
            move |event: &MouseDownEvent, phase, window, cx| {
                if !phase.bubble() || event.button != MouseButton::Left {
                    return;
                }
                if !bounds.contains(&event.position) {
                    return;
                }

                let index = match text_layout.index_for_position(event.position) {
                    Ok(index) | Err(index) => index.min(text_len),
                };

                let focus_handle = state.read(cx).focus_handle.clone();
                focus_handle.focus(window, cx);

                state.update(cx, |state, cx| {
                    state.start_selection(index, cx);
                });
                cx.notify(current_view);
            }
        });

        if is_selecting {
            window.on_mouse_event({
                let text_layout = text_layout.clone();
                let state = state.clone();
                move |event: &MouseMoveEvent, phase, _, cx| {
                    if !phase.bubble() {
                        return;
                    }
                    let index = match text_layout.index_for_position(event.position) {
                        Ok(index) | Err(index) => index.min(text_len),
                    };
                    state.update(cx, |state, cx| {
                        state.update_selection(index, cx);
                    });
                    cx.notify(current_view);
                }
            });

            window.on_mouse_event({
                let state = state.clone();
                move |event: &MouseUpEvent, phase, _, cx| {
                    if !phase.bubble() || event.button != MouseButton::Left {
                        return;
                    }
                    state.update(cx, |state, cx| {
                        state.end_selection(cx);
                    });
                    cx.notify(current_view);
                }
            });
        }

        if has_selection {
            window.on_mouse_event({
                let state = state.clone();
                move |event: &MouseDownEvent, phase, _, cx| {
                    if !phase.bubble() || event.button != MouseButton::Left {
                        return;
                    }
                    if bounds.contains(&event.position) {
                        return;
                    }
                    state.update(cx, |state, cx| {
                        state.clear_selection(cx);
                    });
                    cx.notify(current_view);
                }
            });
        }
    }
}

#[derive(Clone, Copy)]
struct Selection {
    anchor: usize,
    active: usize,
}

impl Selection {
    fn normalized_range(self) -> Range<usize> {
        if self.anchor <= self.active {
            self.anchor..self.active
        } else {
            self.active..self.anchor
        }
    }
}

pub struct SelectablePlainTextState {
    focus_handle: gpui::FocusHandle,
    text: SharedString,
    selection: Option<Selection>,
    is_selecting: bool,
}

impl SelectablePlainTextState {
    fn new(cx: &mut Context<Self>) -> Self {
        Self {
            focus_handle: cx.focus_handle(),
            text: SharedString::default(),
            selection: None,
            is_selecting: false,
        }
    }

    fn set_text(&mut self, text: SharedString, cx: &mut Context<Self>) {
        if self.text == text {
            return;
        }
        self.text = text;
        self.selection = None;
        self.is_selecting = false;
        cx.notify();
    }

    fn has_selection(&self) -> bool {
        self.selection
            .map(|selection| selection.anchor != selection.active)
            .unwrap_or(false)
    }

    fn clear_selection(&mut self, cx: &mut Context<Self>) {
        self.selection = None;
        self.is_selecting = false;
        cx.notify();
    }

    fn start_selection(&mut self, index: usize, cx: &mut Context<Self>) {
        self.selection = Some(Selection {
            anchor: index,
            active: index,
        });
        self.is_selecting = true;
        cx.notify();
    }

    fn update_selection(&mut self, index: usize, cx: &mut Context<Self>) {
        if let Some(selection) = self.selection.as_mut() {
            selection.active = index;
            cx.notify();
        }
    }

    fn end_selection(&mut self, cx: &mut Context<Self>) {
        self.is_selecting = false;
        if let Some(selection) = self.selection
            && selection.anchor == selection.active
        {
            self.selection = None;
        }
        cx.notify();
    }

    fn on_action_copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        let Some(selection) = self.selection else {
            return;
        };

        let range = selection.normalized_range();
        if range.is_empty() {
            return;
        }

        let selected = self
            .text
            .as_ref()
            .get(range)
            .unwrap_or_default()
            .to_string();
        if selected.trim().is_empty() {
            return;
        }

        cx.write_to_clipboard(gpui::ClipboardItem::new_string(selected));
    }
}

fn paint_selection(
    selection: Selection,
    text_layout: &TextLayout,
    bounds: &Bounds<Pixels>,
    window: &mut Window,
    cx: &mut App,
) {
    let mut start = selection.anchor;
    let mut end = selection.active;
    if end < start {
        std::mem::swap(&mut start, &mut end);
    }

    let Some(start_position) = text_layout.position_for_index(start) else {
        return;
    };
    let Some(end_position) = text_layout.position_for_index(end) else {
        return;
    };

    let line_height = text_layout.line_height();
    if start_position.y == end_position.y {
        window.paint_quad(quad(
            Bounds::from_corners(
                start_position,
                point(end_position.x, end_position.y + line_height),
            ),
            px(0.0),
            cx.theme().selection,
            Edges::default(),
            transparent_black(),
            BorderStyle::default(),
        ));
    } else {
        window.paint_quad(quad(
            Bounds::from_corners(
                start_position,
                point(bounds.right(), start_position.y + line_height),
            ),
            px(0.0),
            cx.theme().selection,
            Edges::default(),
            transparent_black(),
            BorderStyle::default(),
        ));

        if end_position.y > start_position.y + line_height {
            window.paint_quad(quad(
                Bounds::from_corners(
                    point(bounds.left(), start_position.y + line_height),
                    point(bounds.right(), end_position.y),
                ),
                px(0.0),
                cx.theme().selection,
                Edges::default(),
                transparent_black(),
                BorderStyle::default(),
            ));
        }

        window.paint_quad(quad(
            Bounds::from_corners(
                point(bounds.left(), end_position.y),
                point(end_position.x, end_position.y + line_height),
            ),
            px(0.0),
            cx.theme().selection,
            Edges::default(),
            transparent_black(),
            BorderStyle::default(),
        ));
    }
}
