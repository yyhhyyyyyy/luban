import { expect, test } from "@playwright/test"
import { ensureWorkspace } from "./helpers"

test("loads older conversation entries when scrolling to top", async ({ page }) => {
  await ensureWorkspace(page)

  const ids = await page.evaluate(async () => {
    const raw = localStorage.getItem("luban:active_workspace_id")
    const workspaceId = raw ? Number(raw) : null
    if (!workspaceId || !Number.isFinite(workspaceId)) throw new Error("missing active workspace id")
    const threadsRes = await fetch(`/api/workspaces/${workspaceId}/threads`)
    if (!threadsRes.ok) throw new Error(`threads fetch failed: ${threadsRes.status}`)
    const threads = await threadsRes.json()
    const threadId = Number(threads?.tabs?.active_tab ?? null)
    if (!threadId || !Number.isFinite(threadId)) throw new Error("missing active thread id")
    return { workspaceId, threadId }
  })

  const runId = Math.random().toString(16).slice(2)
  const marker = `e2e-pagination-steps-${runId}`

  await page.getByTestId("chat-input").fill(marker)
  await page.getByTestId("chat-send").click()

  await page.getByTestId("agent-running-header").waitFor({ timeout: 60_000 })

  await expect
    .poll(async () => {
      const res = await page.request.get(
        `/api/workspaces/${ids.workspaceId}/conversations/${ids.threadId}?limit=2000`,
      )
      if (!res.ok()) return 0
      const snap = (await res.json()) as { entries_start?: number }
      return snap.entries_start ?? 0
    }, { timeout: 60_000 })
    .toBeGreaterThan(0)

  // Force the UI to refresh the conversation via HTTP so the client-side state has
  // `entries_start` populated before we attempt to load older pages.
  await page.getByText("Thread 1", { exact: true }).click()

  const container = page.getByTestId("chat-scroll-container")
  await page.waitForTimeout(750)

  const expectedBefore = await page.request
    .get(`/api/workspaces/${ids.workspaceId}/conversations/${ids.threadId}?limit=2000`)
    .then(async (res) => {
      const snap = (await res.json()) as { entries_start?: number }
      return snap.entries_start ?? 0
    })

  const beforeRequest = page.waitForRequest((req) => {
    const url = req.url()
    return (
      url.includes(`/api/workspaces/${ids.workspaceId}/conversations/${ids.threadId}`) &&
      url.includes(`before=${expectedBefore}`)
    )
  })

  await container.evaluate((el) => {
    el.scrollTop = el.scrollHeight
    el.dispatchEvent(new Event("scroll", { bubbles: true }))
    el.scrollTop = 10
    el.dispatchEvent(new Event("scroll", { bubbles: true }))
    el.scrollTop = 0
    el.dispatchEvent(new Event("scroll", { bubbles: true }))
  })

  await beforeRequest

  await expect(page.getByTestId("chat-input")).toBeVisible()
  await expect(page.getByText("Application error:", { exact: false })).toHaveCount(0)
})
