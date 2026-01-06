use crate::{ContextTokenKind, DraftAttachment, find_context_tokens};
use std::path::{Path, PathBuf};

fn context_token(kind: ContextTokenKind, path: &Path) -> String {
    format!("<<context:{}:{}>>>", kind.as_str(), path.to_string_lossy())
}

pub fn draft_text_and_attachments_from_message_text(
    text: &str,
) -> (String, Vec<(ContextTokenKind, usize, PathBuf)>) {
    let tokens = find_context_tokens(text);
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

pub fn ordered_draft_attachments_for_display(
    attachments: &[DraftAttachment],
) -> Vec<DraftAttachment> {
    let mut out = attachments.to_vec();
    out.sort_by(|a, b| (a.anchor, a.id).cmp(&(b.anchor, b.id)));
    out
}

pub fn compose_user_message_text(draft_text: &str, attachments: &[DraftAttachment]) -> String {
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
            if !first {
                out.push('\n');
            }
            first = false;
            out.push_str(&context_token(attachment.kind, path));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_context_tokens_and_returns_clean_draft() {
        let input = "Hello\n<<context:image:/tmp/a.png>>>\nWorld\n<<context:text:/tmp/b.txt>>>";
        let (draft, attachments) = draft_text_and_attachments_from_message_text(input);
        assert_eq!(draft, "Hello\n\nWorld\n");
        assert_eq!(attachments.len(), 2);
        assert_eq!(attachments[0].0, ContextTokenKind::Image);
        assert_eq!(attachments[0].2, PathBuf::from("/tmp/a.png"));
        assert_eq!(attachments[1].0, ContextTokenKind::Text);
        assert_eq!(attachments[1].2, PathBuf::from("/tmp/b.txt"));
    }

    #[test]
    fn compose_inserts_context_tokens_at_anchors_in_order() {
        let attachments = vec![
            DraftAttachment {
                id: 2,
                kind: ContextTokenKind::Image,
                anchor: 5,
                path: Some(PathBuf::from("/tmp/b.png")),
                failed: false,
            },
            DraftAttachment {
                id: 1,
                kind: ContextTokenKind::Text,
                anchor: 5,
                path: Some(PathBuf::from("/tmp/a.txt")),
                failed: false,
            },
        ];

        let composed = compose_user_message_text("HelloWorld", &attachments);
        assert_eq!(
            composed,
            "Hello\n<<context:text:/tmp/a.txt>>>\n<<context:image:/tmp/b.png>>>\nWorld"
        );
    }
}
