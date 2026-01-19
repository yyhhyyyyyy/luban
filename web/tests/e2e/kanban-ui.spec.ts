import { expect, test } from "@playwright/test"

import { ensureWorkspace } from "./helpers"

test("kanban dashboard renders columns and counts", async ({ page }) => {
  await ensureWorkspace(page)

  await page.getByRole("button", { name: "Workspace" }).click()
  await page.getByRole("button", { name: "Kanban" }).waitFor({ timeout: 20_000 })

  const board = page.getByTestId("kanban-board")
  await expect(board).toBeVisible({ timeout: 20_000 })

  const columns = ["backlog", "running", "pending", "reviewing", "done"] as const
  for (const id of columns) {
    await expect(page.getByTestId(`kanban-column-${id}`)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId(`kanban-column-count-${id}`)).toBeVisible({ timeout: 20_000 })
  }

  const activeCountRaw = (await page.getByTestId("kanban-active-count").innerText()).trim()
  const match = activeCountRaw.match(/^(\d+)\s+active\s+worktrees$/i)
  expect(match).not.toBeNull()
  const activeCount = Number(match?.[1] ?? 0)
  expect(activeCount).toBeGreaterThanOrEqual(0)

  let sum = 0
  for (const id of columns) {
    const raw = (await page.getByTestId(`kanban-column-count-${id}`).innerText()).trim()
    sum += Number(raw)
  }
  expect(sum).toBe(activeCount)
})

