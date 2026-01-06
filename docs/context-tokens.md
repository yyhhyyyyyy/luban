# Context tokens (B1) for inline attachments

## Goal

Enable users to paste or drop images and text files into the chat composer and have them appear as inline attachments in the message UI, while keeping the underlying message content stable and replayable.

This design avoids assembling file contents into the prompt. Attachments are stored as files and referenced by path tokens.

## Non-goals

- A persistent "context library" UI (browse/search/reuse attachments) beyond inserting tokens.
- PDF/DOCX parsing or binary file uploads.
- Full rich-text behavior (e.g., selecting text across image attachments as a single continuous selection).

## Overview

Attachments are represented inside message text as **context tokens**:

```
<<context:<kind>:<absolute_path>>>
```

Where:

- `kind` is one of:
  - `image`
  - `text`
  - `file`
- `absolute_path` points to a file stored inside the workspace context directory.

### Why tokens

- Tokens preserve the insertion order naturally (token order in the text).
- Messages remain self-contained and replayable across restarts (the token string is persisted with the message).
- The UI can replace tokens with thumbnails/chips without needing to mutate the stored message.

## Storage layout

Workspace-scoped context directory:

```
conversations/<project>/<workspace>/context/
  blobs/
    <blake3>.<ext>
  tmp/
    <uuid>.<ext>   (optional, for asynchronous imports)
```

- All blobs are de-duplicated by BLAKE3 hash.
- Image blobs keep their original format extension when possible (e.g., `png`, `jpg`).
- Long pasted text is stored as `txt`.

## Insertion behaviors

### Paste (Cmd+V / Ctrl+V)

Clipboard parsing order:

1. Images (`ClipboardEntry::Image`) are imported into `context/blobs/` and added as `image` attachments.
2. External file paths (`ClipboardEntry::ExternalPaths`) are imported if they match a text-like allowlist.
3. Plain text (`ClipboardEntry::String`):
   - If it exceeds a threshold, it is stored as a `text` blob and added as a `text` attachment.
   - Otherwise, it is pasted into the input normally.

Mixed clipboard content is supported: the implementation may insert plain text and also add one or more attachments in a single paste operation.

### Drag & drop

Dropping files onto the composer imports them into `context/blobs/` (text-like allowlist only) and adds attachments in drop order.

### Composer UI (ChatGPT-style)

The composer input remains a plain text editor. Attachments are shown as thumbnails/chips inside the same input surface (below the text area). Tokens are not shown in the editor.

When an attachment is inserted, the composer records an **anchor byte offset** (the cursor offset in UTF-8 bytes) into the current draft text. The attachment is stored separately from the draft text and only removed when the user clicks the attachment's `X` button.

When the draft text changes, attachment anchors are updated by applying a simple diff (common prefix/suffix):

- Anchors after the edited range shift by the byte-length delta.
- Anchors inside a deleted/replaced range snap to the start of that range.

On send, the final user message text is composed by injecting context tokens at the recorded anchor positions (preserving relative order), and filtering out unresolved or failed attachments.

## Message rendering (B1)

When rendering a `UserMessage`:

1. Parse the message text into a sequence of segments: `Text` and `ContextToken`.
2. Render segments **in order**:
   - `Text` segments render using the existing message renderer (plain or markdown-like).
   - `image` tokens render as a thumbnail element.
   - `text` tokens render as an attachment chip (name + size; preview can be added later).
3. Tokens are not shown as raw text. If a token is invalid or the referenced file is missing, render a fallback "broken attachment" chip.

## Sending to the model

- The message `prompt` is sent as-is (tokens remain in the text that is persisted with the message).
- Image tokens are additionally extracted and passed to Codex CLI via `codex exec --image <path>...` in the order the tokens appear.
- Text tokens are not automatically inlined into the prompt.

## Compatibility notes

- Token parsing must be tolerant and non-panicking:
  - Unknown kinds must be treated as plain text.
  - Tokens with invalid paths must render a fallback element.
- Paths are stored as absolute paths to simplify resolution during rendering and agent execution.
