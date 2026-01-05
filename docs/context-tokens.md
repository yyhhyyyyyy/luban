# Context tokens (B1) for inline attachments

## Goal

Enable users to paste or drop images and text files into the chat composer and have them appear as inline attachments in the message UI, while keeping the underlying message content stable and replayable.

This design intentionally avoids a separate "prompt assembly" step. The user message is sent as-is, and attachments are represented by tokens embedded in the text.

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
  - `file` (reserved; not required for the initial implementation)
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

1. Images (`ClipboardEntry::Image`) are imported into `context/blobs/` and inserted as `image` tokens.
2. External file paths (`ClipboardEntry::ExternalPaths`) are imported if they match a text-like allowlist.
3. Plain text (`ClipboardEntry::String`):
   - If it exceeds a threshold, it is stored as a `text` blob and inserted as a token.
   - Otherwise, it is pasted into the input normally.

Mixed clipboard content is supported: the implementation may choose to insert both text and token(s) in a single paste operation.

### Drag & drop

Dropping files onto the composer imports them into `context/blobs/` (text-like allowlist only) and inserts tokens in drop order.

## Message rendering (B1)

When rendering a `UserMessage`:

1. Parse the message text into a sequence of segments: `Text` and `ContextToken`.
2. Render segments **in order**:
   - `Text` segments render using the existing message renderer (plain or markdown-like).
   - `image` tokens render as a thumbnail element.
   - `text` tokens render as an attachment chip (name + size; preview can be added later).
3. Tokens are not shown as raw text. If a token is invalid or the referenced file is missing, render a fallback "broken attachment" chip.

## Sending to the model

- The message `prompt` is sent as-is (tokens remain in the text).
- Image tokens are additionally extracted and passed to Codex CLI via `codex exec --image <path>...` in the order the tokens appear.
- Text tokens are not automatically inlined into the prompt.

## Compatibility notes

- Token parsing must be tolerant and non-panicking:
  - Unknown kinds must be treated as plain text.
  - Tokens with invalid paths must render a fallback element.
- Paths are stored as absolute paths to simplify resolution during rendering and agent execution.

