import type {
  AppSnapshot,
  AttachmentKind,
  AttachmentRef,
  CodexCustomPromptSnapshot,
  ContextSnapshot,
  ConversationSnapshot,
  MentionItemSnapshot,
  ThreadsSnapshot,
  WorkspaceChangesSnapshot,
  WorkspaceDiffSnapshot,
} from "./luban-api"

export async function fetchApp(): Promise<AppSnapshot> {
  const res = await fetch("/api/app")
  if (!res.ok) throw new Error(`GET /api/app failed: ${res.status}`)
  return (await res.json()) as AppSnapshot
}

export async function fetchThreads(workspaceId: number): Promise<ThreadsSnapshot> {
  const res = await fetch(`/api/workspaces/${workspaceId}/threads`)
  if (!res.ok) throw new Error(`GET /api/workspaces/${workspaceId}/threads failed: ${res.status}`)
  return (await res.json()) as ThreadsSnapshot
}

export async function fetchConversation(
  workspaceId: number,
  threadId: number,
  args: { before?: number; limit?: number } = {},
): Promise<ConversationSnapshot> {
  const limit = args.limit ?? 2000
  const params = new URLSearchParams({ limit: String(limit) })
  if (args.before != null) params.set("before", String(args.before))
  const res = await fetch(`/api/workspaces/${workspaceId}/conversations/${threadId}?${params.toString()}`)
  if (!res.ok)
    throw new Error(
      `GET /api/workspaces/${workspaceId}/conversations/${threadId} failed: ${res.status}`,
    )
  return (await res.json()) as ConversationSnapshot
}

export async function uploadAttachment(args: {
  workspaceId: number
  file: File
  kind: AttachmentKind
}): Promise<AttachmentRef> {
  const form = new FormData()
  form.append("kind", args.kind)
  form.append("file", args.file, args.file.name)

  const res = await fetch(`/api/workspaces/${args.workspaceId}/attachments`, {
    method: "POST",
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(
      `POST /api/workspaces/${args.workspaceId}/attachments failed: ${res.status}${text ? `: ${text}` : ""}`,
    )
  }

  return (await res.json()) as AttachmentRef
}

export async function fetchContext(workspaceId: number): Promise<ContextSnapshot> {
  const res = await fetch(`/api/workspaces/${workspaceId}/context`)
  if (!res.ok) throw new Error(`GET /api/workspaces/${workspaceId}/context failed: ${res.status}`)
  return (await res.json()) as ContextSnapshot
}

export async function deleteContextItem(workspaceId: number, contextId: number): Promise<void> {
  const res = await fetch(`/api/workspaces/${workspaceId}/context/${contextId}`, { method: "DELETE" })
  if (res.status === 204) return
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(
      `DELETE /api/workspaces/${workspaceId}/context/${contextId} failed: ${res.status}${text ? `: ${text}` : ""}`,
    )
  }
}

export async function fetchWorkspaceChanges(workspaceId: number): Promise<WorkspaceChangesSnapshot> {
  const res = await fetch(`/api/workspaces/${workspaceId}/changes`)
  if (!res.ok) throw new Error(`GET /api/workspaces/${workspaceId}/changes failed: ${res.status}`)
  return (await res.json()) as WorkspaceChangesSnapshot
}

export async function fetchWorkspaceDiff(workspaceId: number): Promise<WorkspaceDiffSnapshot> {
  const res = await fetch(`/api/workspaces/${workspaceId}/diff`)
  if (!res.ok) throw new Error(`GET /api/workspaces/${workspaceId}/diff failed: ${res.status}`)
  return (await res.json()) as WorkspaceDiffSnapshot
}

export async function fetchCodexCustomPrompts(): Promise<CodexCustomPromptSnapshot[]> {
  const res = await fetch("/api/codex/prompts")
  if (!res.ok) throw new Error(`GET /api/codex/prompts failed: ${res.status}`)
  return (await res.json()) as CodexCustomPromptSnapshot[]
}

export async function fetchMentionItems(args: {
  workspaceId: number
  query: string
}): Promise<MentionItemSnapshot[]> {
  const q = args.query.trim()
  if (!q) return []
  const res = await fetch(
    `/api/workspaces/${args.workspaceId}/mentions?q=${encodeURIComponent(q)}`,
  )
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(
      `GET /api/workspaces/${args.workspaceId}/mentions failed: ${res.status}${text ? `: ${text}` : ""}`,
    )
  }
  return (await res.json()) as MentionItemSnapshot[]
}
