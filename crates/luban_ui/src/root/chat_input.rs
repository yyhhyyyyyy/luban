use super::*;

impl LubanRootView {
    pub(super) fn ensure_chat_input(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> gpui::Entity<InputState> {
        if let Some(input) = self.chat_input.clone() {
            return input;
        }

        let input_state = cx.new(|cx| {
            InputState::new(window, cx)
                .auto_grow(4, 12)
                .placeholder("Message... (\u{2318}\u{21a9} to send)")
        });

        let subscription = cx.subscribe_in(&input_state, window, {
            let input_state = input_state.clone();
            move |this: &mut LubanRootView, _, ev: &InputEvent, window, cx| match ev {
                InputEvent::Change => {
                    if let MainPane::Workspace(workspace_id) = this.state.main_pane {
                        let text = input_state.read(cx).value().to_owned();
                        let existing = this
                            .state
                            .workspace_conversation(workspace_id)
                            .map(|c| c.draft.as_str())
                            .unwrap_or("");
                        if text != existing {
                            this.dispatch(
                                Action::ChatDraftChanged {
                                    workspace_id,
                                    text: text.to_string(),
                                },
                                cx,
                            );
                        }
                    }
                    cx.notify();
                }
                InputEvent::PressEnter { secondary: true } => {
                    let text = input_state.read(cx).value().trim().to_owned();
                    if text.is_empty() {
                        return;
                    }
                    let MainPane::Workspace(workspace_id) = this.state.main_pane else {
                        return;
                    };
                    input_state.update(cx, |state, cx| state.set_value("", window, cx));
                    this.dispatch(Action::SendAgentMessage { workspace_id, text }, cx);
                }
                InputEvent::PressEnter { .. } | InputEvent::Focus | InputEvent::Blur => {}
            }
        });

        self._subscriptions.push(subscription);
        self.chat_input = Some(input_state.clone());
        input_state
    }
}
