"use client"

import type { ThreadMeta, WorkspaceId } from "./luban-api"

export async function waitForNewThread(args: {
  workspaceId: WorkspaceId
  existingThreadIds: Set<number>
  fetchThreads: (workspaceId: WorkspaceId) => Promise<{ threads: ThreadMeta[] }>
  timeoutMs?: number
  pollMs?: number
}): Promise<{ threads: ThreadMeta[]; createdThreadId: number | null }> {
  const timeoutMs = args.timeoutMs ?? 5_000
  const pollMs = args.pollMs ?? 250

  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const snap = await args.fetchThreads(args.workspaceId)
      const created = snap.threads
        .map((t) => t.thread_id)
        .filter((id) => !args.existingThreadIds.has(id))
        .sort((a, b) => b - a)[0]
      return { threads: snap.threads, createdThreadId: created ?? null }
    } catch {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return { threads: [], createdThreadId: null }
}

