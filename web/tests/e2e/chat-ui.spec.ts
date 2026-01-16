import { expect, test } from "@playwright/test"
import { ensureWorkspace, sendWsAction } from "./helpers"

async function activeThreadId(page: import("@playwright/test").Page, workspaceId: number): Promise<number> {
  const res = await page.request.get(`/api/workspaces/${workspaceId}/threads`)
  expect(res.ok()).toBeTruthy()
  const snapshot = (await res.json()) as { tabs: { active_tab: number } }
  return Number(snapshot.tabs.active_tab)
}

async function createThreadViaUi(page: import("@playwright/test").Page, workspaceId: number): Promise<number> {
  const before = await activeThreadId(page, workspaceId)
  await page.getByTitle("New tab").click()
  await expect
    .poll(async () => await activeThreadId(page, workspaceId), { timeout: 30_000 })
    .not.toBe(before)
  return await activeThreadId(page, workspaceId)
}

async function queuedPromptTexts(page: import("@playwright/test").Page, workspaceId: number, threadId: number): Promise<string[]> {
  const res = await page.request.get(`/api/workspaces/${workspaceId}/conversations/${threadId}`)
  if (!res.ok()) return []
  const snapshot = (await res.json()) as { pending_prompts?: { text: string }[] }
  if (!Array.isArray(snapshot.pending_prompts)) return []
  return snapshot.pending_prompts.map((p) => String(p.text))
}

async function queuedPrompts(page: import("@playwright/test").Page, workspaceId: number, threadId: number): Promise<{ id: number; text: string }[]> {
  const res = await page.request.get(`/api/workspaces/${workspaceId}/conversations/${threadId}`)
  if (!res.ok()) return []
  const snapshot = (await res.json()) as { pending_prompts?: { id: number; text: string }[] }
  if (!Array.isArray(snapshot.pending_prompts)) return []
  return snapshot.pending_prompts.map((p) => ({ id: Number(p.id), text: String(p.text) }))
}

test("long tokens wrap without horizontal overflow", async ({ page }) => {
  await ensureWorkspace(page)

  const runId = Math.random().toString(16).slice(2)
  const marker = `e2e-${runId}-`
  const longToken = `${marker}${"a".repeat(600)}`
  await page.getByTestId("chat-input").fill(longToken)
  await expect(page.getByTestId("chat-send")).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId("chat-send").click()

  const bubble = page.getByTestId("user-message-bubble").filter({ hasText: marker }).first()
  await expect(bubble).toBeVisible({ timeout: 20_000 })

  const overflow = await bubble.evaluate((el) => {
    const e = el as HTMLElement
    return e.scrollWidth - e.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(1)
})

test("pressing enter submits a user message", async ({ page }) => {
  await ensureWorkspace(page)

  const runId = Math.random().toString(16).slice(2)
  const marker = `e2e-enter-${runId}`

  await page.getByTestId("chat-input").fill(marker)
  await page.getByTestId("chat-input").press("Enter")

  const bubble = page.getByTestId("user-message-bubble").filter({ hasText: marker }).first()
  await expect(bubble).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("chat-input")).toHaveValue("")
})

test("enter commits IME composition without sending", async ({ page }) => {
  await ensureWorkspace(page)

  const runId = Math.random().toString(16).slice(2)
  const marker = `e2e-ime-${runId}`

  const input = page.getByTestId("chat-input")
  await input.fill(marker)

  await input.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "x" }))
  })

  await input.press("Enter")
  await expect(page.getByTestId("user-message-bubble").filter({ hasText: marker })).toHaveCount(0)

  await input.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "x" }))
  })
  await page.waitForTimeout(80)

  await input.press("Enter")
  await expect(page.getByTestId("user-message-bubble").filter({ hasText: marker }).first()).toBeVisible({ timeout: 20_000 })
})

test("scroll-to-bottom button appears only when away from bottom", async ({ page }) => {
  await ensureWorkspace(page)

  const runId = Math.random().toString(16).slice(2)
  const payload = Array.from({ length: 160 }, (_, i) => `line ${i + 1} ${runId}`).join("\n")
  await page.getByTestId("chat-input").fill(payload)
  await expect(page.getByTestId("chat-send")).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId("chat-send").click()
  await expect(page.getByTestId("user-message-bubble").filter({ hasText: `line 160 ${runId}` }).first()).toBeVisible(
    { timeout: 20_000 },
  )

  const button = page.getByRole("button", { name: "Scroll to bottom" })
  await expect(button).toHaveCount(0)

  const scroller = page.getByTestId("chat-scroll-container")
  await scroller.hover()
  await page.mouse.wheel(0, -800)
  await expect(button).toBeVisible()

  await button.click()
  await expect(button).toHaveCount(0)

  await expect
    .poll(
      async () =>
        await scroller.evaluate((el) => {
          const e = el as HTMLElement
          const distance = e.scrollHeight - e.scrollTop - e.clientHeight
          return distance < 24
        }),
      { timeout: 5_000 },
    )
    .toBeTruthy()
})

test("external links open without navigating current page", async ({ page }) => {
  await ensureWorkspace(page)

  const startUrl = page.url()
  await page.evaluate(() => {
    const a = document.createElement("a")
    a.href = "https://example.com/"
    a.textContent = "example"
    a.setAttribute("data-testid", "external-link")
    document.body.appendChild(a)
  })

  const popupPromise = page.waitForEvent("popup", { timeout: 10_000 })
  await page.getByTestId("external-link").click()
  const popup = await popupPromise
  await popup.close()

  expect(page.url()).toBe(startUrl)
})

test("file attachments upload and render in user messages", async ({ page }) => {
  await ensureWorkspace(page)

  const runId = Math.random().toString(16).slice(2)
  const marker = `e2e-attach-${runId}`

  await page.getByTestId("chat-attach-input").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(`hello ${runId}\n`, "utf8"),
  })

  await page.getByTestId("chat-input").fill(marker)
  await expect(page.getByTestId("chat-send")).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId("chat-send").click()

  const bubble = page.getByTestId("user-message-bubble").filter({ hasText: marker }).first()
  await expect(bubble).toBeVisible({ timeout: 20_000 })

  const attachment = bubble.getByTestId("user-message-attachment").first()
  await expect(attachment).toBeVisible({ timeout: 20_000 })
  await expect(attachment).toContainText(/notes-\d+\.txt/)

  await page.getByTestId("right-sidebar-tab-context").click()
  const row = page.getByTestId("context-file-row").filter({ hasText: "notes-" }).first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.hover()
  await row.getByTestId("context-add-to-chat").click({ force: true, timeout: 20_000 })
  await expect(page.getByTestId("chat-attachment-tile").first()).toBeVisible({ timeout: 20_000 })
})

test("queued messages can be reordered and edited", async ({ page }) => {
  await ensureWorkspace(page)

  const workspaceIdRaw = (await page.evaluate(() => localStorage.getItem("luban:active_workspace_id"))) ?? ""
  const workspaceId = Number(workspaceIdRaw)
  expect(Number.isFinite(workspaceId)).toBeTruthy()
  expect(workspaceId).toBeGreaterThan(0)

  const threadId = await activeThreadId(page, workspaceId)
  expect(threadId).toBeGreaterThan(0)

  const runId = Math.random().toString(16).slice(2)
  let firstQueued = ""
  let secondQueued = ""
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const seed = `e2e-queued-${runId}-${attempt}`
    await sendWsAction(page, { type: "send_agent_message", workspace_id: workspaceId, thread_id: threadId, text: `${seed}-run`, attachments: [] })
    await sendWsAction(page, { type: "send_agent_message", workspace_id: workspaceId, thread_id: threadId, text: `${seed}-a`, attachments: [] })
    await sendWsAction(page, { type: "send_agent_message", workspace_id: workspaceId, thread_id: threadId, text: `${seed}-b`, attachments: [] })

    try {
      await expect
        .poll(async () => (await queuedPromptTexts(page, workspaceId, threadId)).slice(0, 2), { timeout: 10_000 })
        .toHaveLength(2)
      const queued = await queuedPromptTexts(page, workspaceId, threadId)
      ;[firstQueued, secondQueued] = queued.slice(0, 2)
      break
    } catch {
      // Retry until we have at least two queued prompts.
    }
  }
  expect(firstQueued.length).toBeGreaterThan(0)
  expect(secondQueued.length).toBeGreaterThan(0)

  await expect(page.getByTestId("queued-prompts")).toBeVisible({ timeout: 20_000 })

  const queuedItems = page.getByTestId("queued-prompt-item")
  await expect(queuedItems).toHaveCount(2, { timeout: 20_000 })
  await expect(queuedItems.nth(0)).toContainText(firstQueued)
  await expect(queuedItems.nth(1)).toContainText(secondQueued)

  const prompts = await queuedPrompts(page, workspaceId, threadId)
  expect(prompts.length).toBeGreaterThanOrEqual(2)
  const [firstPrompt, secondPrompt] = prompts
  expect(firstPrompt).toBeTruthy()
  expect(secondPrompt).toBeTruthy()

  await sendWsAction(page, {
    type: "reorder_queued_prompt",
    workspace_id: workspaceId,
    thread_id: threadId,
    active_id: secondPrompt.id,
    over_id: firstPrompt.id,
  })

  await expect(queuedItems.nth(0)).toContainText(secondQueued, { timeout: 20_000 })

  await queuedItems.nth(0).hover()
  await queuedItems.nth(0).locator('[data-testid="queued-prompt-edit"]').click({ force: true, timeout: 20_000 })
  const input = page.getByTestId("queued-prompt-input")
  await expect(input).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => await input.getAttribute("placeholder")).toBe("Edit message...")
  const updated = `e2e-queued-${runId}-edited`
  await input.fill(updated)
  await page.getByTestId("queued-save").click()

  await expect(queuedItems.nth(0)).toContainText(updated, { timeout: 20_000 })

  const lastItem = queuedItems.nth(1)
  await lastItem.hover()
  await lastItem.locator('[data-testid="queued-prompt-cancel"]').click({ force: true, timeout: 20_000 })
  await expect(queuedItems).toHaveCount(1, { timeout: 20_000 })
})

test("cancel -> submit turns the previous run into a cancelled activity stream and starts a new turn", async ({ page }) => {
  await ensureWorkspace(page)

  const workspaceIdRaw = (await page.evaluate(() => localStorage.getItem("luban:active_workspace_id"))) ?? ""
  const workspaceId = Number(workspaceIdRaw)
  expect(Number.isFinite(workspaceId)).toBeTruthy()
  expect(workspaceId).toBeGreaterThan(0)

  const threadId = await createThreadViaUi(page, workspaceId)
  expect(threadId).toBeGreaterThan(0)

  const runId = Math.random().toString(16).slice(2)
  const seed = `e2e-cancel-submit-${runId}`

  await sendWsAction(page, {
    type: "send_agent_message",
    workspace_id: workspaceId,
    thread_id: threadId,
    text: `${seed}-run`,
    attachments: [],
  })

  const cancelButton = page.getByTestId("agent-running-cancel")
  await expect(cancelButton).toBeVisible({ timeout: 20_000 })
  await cancelButton.click()

  const editor = page.getByTestId("agent-running-input")
  await expect(editor).toBeVisible({ timeout: 20_000 })

  const interrupt = `${seed}-interrupt`
  await editor.fill(interrupt)
  await page.getByTestId("agent-running-submit").click()

  await expect(page.getByTestId("user-message-bubble").filter({ hasText: interrupt }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("Cancelled after").first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/^Completed \d+ steps$/).first()).toBeVisible({ timeout: 20_000 })
})

test("cancel -> escape pauses when queued prompts exist and shows resume", async ({ page }) => {
  await ensureWorkspace(page)

  const workspaceIdRaw = (await page.evaluate(() => localStorage.getItem("luban:active_workspace_id"))) ?? ""
  const workspaceId = Number(workspaceIdRaw)
  expect(Number.isFinite(workspaceId)).toBeTruthy()
  expect(workspaceId).toBeGreaterThan(0)

  const threadId = await createThreadViaUi(page, workspaceId)
  expect(threadId).toBeGreaterThan(0)

  const runId = Math.random().toString(16).slice(2)
  const seed = `e2e-cancel-queued-${runId}`

  await sendWsAction(page, {
    type: "send_agent_message",
    workspace_id: workspaceId,
    thread_id: threadId,
    text: `${seed}-run`,
    attachments: [],
  })
  await sendWsAction(page, {
    type: "send_agent_message",
    workspace_id: workspaceId,
    thread_id: threadId,
    text: `${seed}-queued`,
    attachments: [],
  })

  await expect
    .poll(async () => (await queuedPromptTexts(page, workspaceId, threadId)).length, { timeout: 10_000 })
    .toBeGreaterThan(0)

  const cancelButton = page.getByTestId("agent-running-cancel")
  await expect(cancelButton).toBeVisible({ timeout: 20_000 })
  await cancelButton.click()

  const editor = page.getByTestId("agent-running-input")
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await editor.press("Escape")

  const resumeButton = page.getByTestId("agent-running-resume")
  await expect(resumeButton).toBeVisible({ timeout: 20_000 })
  await resumeButton.click()
  await expect(page.getByTestId("agent-running-input")).toBeVisible({ timeout: 20_000 })
})

test("cancel -> escape without queued prompts shows cancelled activity stream", async ({ page }) => {
  await ensureWorkspace(page)

  const workspaceIdRaw = (await page.evaluate(() => localStorage.getItem("luban:active_workspace_id"))) ?? ""
  const workspaceId = Number(workspaceIdRaw)
  expect(Number.isFinite(workspaceId)).toBeTruthy()
  expect(workspaceId).toBeGreaterThan(0)

  const threadId = await createThreadViaUi(page, workspaceId)
  expect(threadId).toBeGreaterThan(0)

  const runId = Math.random().toString(16).slice(2)
  const seed = `e2e-cancel-no-queue-${runId}`

  await sendWsAction(page, {
    type: "send_agent_message",
    workspace_id: workspaceId,
    thread_id: threadId,
    text: `${seed}-run`,
    attachments: [],
  })

  const cancelButton = page.getByTestId("agent-running-cancel")
  await expect(cancelButton).toBeVisible({ timeout: 20_000 })
  await cancelButton.click()

  const editor = page.getByTestId("agent-running-input")
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await editor.press("Escape")

  await expect(page.getByText("Cancelled after").first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("agent-running-resume")).toHaveCount(0)
})

test("agent running timer increments while running", async ({ page }) => {
  await ensureWorkspace(page)

  const workspaceIdRaw = (await page.evaluate(() => localStorage.getItem("luban:active_workspace_id"))) ?? ""
  const workspaceId = Number(workspaceIdRaw)
  expect(Number.isFinite(workspaceId)).toBeTruthy()
  expect(workspaceId).toBeGreaterThan(0)

  const threadId = await createThreadViaUi(page, workspaceId)
  expect(threadId).toBeGreaterThan(0)

  const runId = Math.random().toString(16).slice(2)
  const seed = `e2e-cancel-timer-${runId}`

  await sendWsAction(page, {
    type: "send_agent_message",
    workspace_id: workspaceId,
    thread_id: threadId,
    text: `${seed}-run`,
    attachments: [],
  })

  await expect(page.getByTestId("agent-running-cancel")).toBeVisible({ timeout: 20_000 })

  const timer = page.getByTestId("agent-running-timer")
  await expect(timer).toBeVisible({ timeout: 20_000 })

  await expect
    .poll(async () => (await timer.textContent())?.trim() ?? "", { timeout: 10_000 })
    .not.toBe("00:00")

  // Stop the running turn so it doesn't leak into other tests.
  await page.getByTestId("agent-running-cancel").click()
  await page.getByTestId("agent-running-input").press("Escape")
})

test("/command autocompletes Codex custom prompts", async ({ page }) => {
  await ensureWorkspace(page)

  const input = page.getByTestId("chat-input")
  await input.fill("/rev")

  const menu = page.getByTestId("chat-command-menu")
  await expect(menu).toBeVisible({ timeout: 20_000 })

  const item = page.getByTestId("chat-command-item").filter({ hasText: "review" }).first()
  await expect(item).toBeVisible({ timeout: 20_000 })
  await item.click()

  await expect.poll(async () => await input.inputValue(), { timeout: 10_000 }).toContain("Review a change locally.")
  await expect(menu).toHaveCount(0)
})

test("@mention autocompletes workspace files", async ({ page }) => {
  await ensureWorkspace(page)

  const input = page.getByTestId("chat-input")
  await input.fill("@rdm")

  const menu = page.getByTestId("chat-mention-menu")
  await expect(menu).toBeVisible({ timeout: 20_000 })

  const docsItem = page.getByTestId("chat-mention-item").filter({ hasText: "docs/README.md" }).first()
  await expect(docsItem).toBeVisible({ timeout: 20_000 })
  await docsItem.hover()
  await input.press("Enter")

  await expect.poll(async () => await input.inputValue(), { timeout: 10_000 }).toBe("@docs/README.md ")
  await expect(menu).toHaveCount(0)
})
