import { expect, test } from "@playwright/test"
import { ensureWorkspace } from "./helpers"

test("UI stays responsive with many agent steps", async ({ page }) => {
  await ensureWorkspace(page)

  const runId = Math.random().toString(16).slice(2)
  const marker = `e2e-many-steps-${runId}`

  await page.getByTestId("chat-input").fill(marker)
  await page.getByTestId("chat-send").click()

  // The fake agent finishes by marking the turn as failed; the UI should not crash/blank.
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText("Application error:", { exact: false })).toHaveCount(0)

  // The UI should remain editable even after processing a large activity list.
  const followup = `e2e-followup-${runId}`
  await page.getByTestId("chat-input").fill(followup)
  await expect(page.getByTestId("chat-input")).toHaveValue(followup)
})
