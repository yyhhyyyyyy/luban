import { expect, test } from "@playwright/test"
import { ensureWorkspace } from "./helpers"

test("agent turn and step timers advance beyond 00:00", async ({ page }) => {
  await ensureWorkspace(page)

  const runId = Math.random().toString(16).slice(2)
  const marker = `e2e-running-card-${runId}`

  await page.getByTestId("chat-input").fill(marker)
  await page.getByTestId("chat-send").click()

  const runningHeader = page.getByTestId("agent-running-header")
  await expect(runningHeader).toBeVisible({ timeout: 20_000 })

  // The overall turn timer should advance while running.
  await expect
    .poll(async () => (await page.getByTestId("agent-running-timer").innerText()).trim(), {
      timeout: 10_000,
    })
    .not.toBe("00:00")

  // Expand the running card to show completed steps (history).
  await runningHeader.click()

  const history = page.getByTestId("agent-running-history")
  await expect(history).toBeVisible({ timeout: 20_000 })

  // `echo 2` runs long enough in the fake agent to cross the 1-second boundary.
  const echo2Row = history.getByRole("button", { name: /echo 2/ })
  await expect(echo2Row).toBeVisible({ timeout: 20_000 })

  await expect
    .poll(async () => (await echo2Row.locator("span.font-mono").innerText()).trim(), {
      timeout: 10_000,
    })
    .not.toBe("00:00")

  // When the run finishes, ActivityStream should keep showing the recorded durations.
  await expect(runningHeader).toHaveCount(0, { timeout: 30_000 })

  const activityHeader = page.getByRole("button", { name: /Completed|Cancelled/i }).first()
  await activityHeader.click()

  const activityEcho2 = page.getByRole("button", { name: /echo 2/ }).first()
  await expect(activityEcho2).toBeVisible({ timeout: 10_000 })
  await expect(activityEcho2.locator("span.font-mono")).not.toHaveText("00:00")
})

