import { expect, test } from "@playwright/test"
import { ensureWorkspace } from "./helpers"

test("long tokens wrap without horizontal overflow", async ({ page }) => {
  await ensureWorkspace(page)

  const runId = Math.random().toString(16).slice(2)
  const marker = `e2e-${runId}-`
  const longToken = `${marker}${"a".repeat(600)}`
  await page.getByTestId("chat-input").fill(longToken)
  await page.getByTestId("chat-send").click()

  const bubble = page.getByTestId("user-message-bubble").filter({ hasText: marker }).first()
  await expect(bubble).toBeVisible({ timeout: 20_000 })

  const overflow = await bubble.evaluate((el) => {
    const e = el as HTMLElement
    return e.scrollWidth - e.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(1)
})

test("scroll-to-bottom button appears only when away from bottom", async ({ page }) => {
  await ensureWorkspace(page)

  const runId = Math.random().toString(16).slice(2)
  const payload = Array.from({ length: 160 }, (_, i) => `line ${i + 1} ${runId}`).join("\n")
  await page.getByTestId("chat-input").fill(payload)
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
