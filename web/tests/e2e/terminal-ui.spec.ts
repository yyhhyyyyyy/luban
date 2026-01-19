import { expect, test } from "@playwright/test"
import { PNG } from "pngjs"
import { ensureWorkspace, sendWsAction } from "./helpers"

function parseRgb(color: string): { r: number; g: number; b: number } | null {
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(color.trim())
  if (!m) return null
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }
}

function samplePixel(png: PNG, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const ix = Math.max(0, Math.min(png.width - 1, x))
  const iy = Math.max(0, Math.min(png.height - 1, y))
  const idx = (png.width * iy + ix) * 4
  return {
    r: png.data[idx] ?? 0,
    g: png.data[idx + 1] ?? 0,
    b: png.data[idx + 2] ?? 0,
    a: png.data[idx + 3] ?? 0,
  }
}

test("terminal background matches card background and survives reload", async ({ page }) => {
  await ensureWorkspace(page)

  const terminal = page.getByTestId("pty-terminal")
  await expect
    .poll(async () => await terminal.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0)

  const expected = await terminal.evaluate((el) => getComputedStyle(el as Element).backgroundColor)
  const rgb = parseRgb(expected)
  expect(rgb, `unexpected terminal background: ${expected}`).not.toBeNull()

  const shot = await terminal.screenshot()
  const png = PNG.sync.read(shot)
  const pixel = samplePixel(png, Math.floor(png.width / 2), Math.max(0, png.height - 10))

  const tol = 10
  expect(Math.abs(pixel.r - (rgb?.r ?? 0))).toBeLessThanOrEqual(tol)
  expect(Math.abs(pixel.g - (rgb?.g ?? 0))).toBeLessThanOrEqual(tol)
  expect(Math.abs(pixel.b - (rgb?.b ?? 0))).toBeLessThanOrEqual(tol)

  await page.reload()
  await expect(page.getByTestId("thread-tab-title").first()).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(async () => await terminal.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0)
})

test("terminal paste sends input frames", async ({ page }) => {
  const token = `luban-e2e-paste-${Math.random().toString(16).slice(2)}`
  const payload = `echo ${token}\n`

  const sentFrame = new Promise<string>((resolve) => {
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/api/pty/")) return
      ws.on("framesent", (ev) => {
        const data = typeof ev.payload === "string" ? ev.payload : String(ev.payload)
        if (data.includes("\"type\":\"input\"") && data.includes(token)) {
          resolve(data)
        }
      })
    })
  })

  await ensureWorkspace(page)

  const terminal = page.getByTestId("pty-terminal")
  await expect
    .poll(async () => await terminal.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0)

  await terminal.evaluate(
    (el, payload) => {
      const event = new Event("paste", { bubbles: true, cancelable: true }) as any
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData: (t: string) => (t === "text/plain" ? payload : ""),
        },
      })
      el.dispatchEvent(event)
    },
    payload,
  )

  await sentFrame
})

test("terminal ctrl+arrow sends word navigation input frames", async ({ page }) => {
  const leftFrame = new Promise<string>((resolve) => {
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/api/pty/")) return
      ws.on("framesent", (ev) => {
        const data = typeof ev.payload === "string" ? ev.payload : String(ev.payload)
        if (data.includes("\"type\":\"input\"") && data.includes("\\u001bb")) {
          resolve(data)
        }
      })
    })
  })

  const rightFrame = new Promise<string>((resolve) => {
    page.on("websocket", (ws) => {
      if (!ws.url().includes("/api/pty/")) return
      ws.on("framesent", (ev) => {
        const data = typeof ev.payload === "string" ? ev.payload : String(ev.payload)
        if (data.includes("\"type\":\"input\"") && data.includes("\\u001bf")) {
          resolve(data)
        }
      })
    })
  })

  await ensureWorkspace(page)

  const terminal = page.getByTestId("pty-terminal")
  await expect
    .poll(async () => await terminal.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0)

  await terminal.click({ force: true })
  await page.keyboard.down("Control")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.up("Control")
  await leftFrame

  await terminal.click({ force: true })
  await page.keyboard.down("Control")
  await page.keyboard.press("ArrowRight")
  await page.keyboard.up("Control")
  await rightFrame
})

test("terminal theme follows app theme changes", async ({ page }) => {
  await ensureWorkspace(page)

  const terminal = page.getByTestId("pty-terminal")
  await expect
    .poll(async () => await terminal.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0)

  await sendWsAction(page, { type: "appearance_theme_changed", theme: "light" })
  await expect
    .poll(async () => await page.evaluate(() => document.documentElement.classList.contains("dark")), { timeout: 10_000 })
    .toBe(false)

  await sendWsAction(page, { type: "appearance_theme_changed", theme: "dark" })
  await expect
    .poll(async () => await page.evaluate(() => document.documentElement.classList.contains("dark")), {
      timeout: 10_000,
    })
    .toBe(true)

  const expected = await terminal.evaluate((el) => getComputedStyle(el as Element).backgroundColor)
  const rgb = parseRgb(expected)
  expect(rgb, `unexpected terminal background: ${expected}`).not.toBeNull()

  const tol = 10
  await expect
    .poll(async () => {
      const shot = await terminal.screenshot()
      const png = PNG.sync.read(shot)
      const pixel = samplePixel(png, Math.floor(png.width / 2), Math.max(0, png.height - 10))
      return (
        Math.abs(pixel.r - (rgb?.r ?? 0)) <= tol &&
        Math.abs(pixel.g - (rgb?.g ?? 0)) <= tol &&
        Math.abs(pixel.b - (rgb?.b ?? 0)) <= tol
      )
    })
    .toBe(true)
})

test("terminal canvas stays within container bounds", async ({ page }) => {
  await ensureWorkspace(page)

  const terminal = page.getByTestId("pty-terminal")
  await expect
    .poll(async () => await terminal.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0)

  await expect
    .poll(async () => {
      return await terminal.evaluate((outer) => {
        const canvas = outer.querySelector("canvas")
        if (!canvas) return null
        const outerRect = (outer as HTMLElement).getBoundingClientRect()
        const canvasRect = canvas.getBoundingClientRect()
        return {
          outer: { top: outerRect.top, bottom: outerRect.bottom, left: outerRect.left, right: outerRect.right },
          canvas: { top: canvasRect.top, bottom: canvasRect.bottom, left: canvasRect.left, right: canvasRect.right },
        }
      })
    })
    .not.toBeNull()

  const rects = await terminal.evaluate((outer) => {
    const canvas = outer.querySelector("canvas")!
    const outerRect = (outer as HTMLElement).getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    return {
      outerRect: { top: outerRect.top, bottom: outerRect.bottom, left: outerRect.left, right: outerRect.right },
      canvasRect: { top: canvasRect.top, bottom: canvasRect.bottom, left: canvasRect.left, right: canvasRect.right },
    }
  })

  const tol = 1
  expect(rects.canvasRect.top).toBeGreaterThanOrEqual(rects.outerRect.top - tol)
  expect(rects.canvasRect.left).toBeGreaterThanOrEqual(rects.outerRect.left - tol)
  expect(rects.canvasRect.right).toBeLessThanOrEqual(rects.outerRect.right + tol)
  expect(rects.canvasRect.bottom).toBeLessThanOrEqual(rects.outerRect.bottom + tol)
})

test("terminal does not add extra padding above the viewport", async ({ page }) => {
  await ensureWorkspace(page)

  const terminal = page.getByTestId("pty-terminal")
  await expect
    .poll(async () => await terminal.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0)

  const padding = await terminal.evaluate((el) => {
    const style = getComputedStyle(el as HTMLElement)
    return {
      top: style.paddingTop,
      right: style.paddingRight,
      bottom: style.paddingBottom,
      left: style.paddingLeft,
    }
  })

  expect(padding.top).toBe("0px")
  expect(padding.right).toBe("0px")
  expect(padding.bottom).toBe("0px")
  expect(padding.left).toBe("0px")
})

test("terminal content has horizontal padding", async ({ page }) => {
  await ensureWorkspace(page)

  const terminal = page.getByTestId("pty-terminal")
  await expect
    .poll(async () => await terminal.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0)

  const insets = await terminal.evaluate((outer) => {
    const xterm = outer.querySelector(".xterm") as HTMLElement | null
    if (!xterm) return null
    const outerRect = (outer as HTMLElement).getBoundingClientRect()
    const xtermRect = xterm.getBoundingClientRect()
    return {
      left: xtermRect.left - outerRect.left,
      right: outerRect.right - xtermRect.right,
    }
  })

  expect(insets).not.toBeNull()
  expect(insets?.left ?? 0).toBeGreaterThanOrEqual(6)
  expect(insets?.right ?? 0).toBeGreaterThanOrEqual(6)
})

test("terminal viewport uses auto scrollbar behavior", async ({ page }) => {
  await ensureWorkspace(page)

  const terminal = page.getByTestId("pty-terminal")
  await expect
    .poll(async () => await terminal.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0)

  const snapshot = await terminal.evaluate((outer) => {
    const viewport = outer.querySelector(".xterm-viewport") as HTMLElement | null
    if (!viewport) return null
    const viewOverflowY = getComputedStyle(viewport).overflowY

    const parentOverflows: Array<{ tag: string; overflowY: string }> = []
    let node: HTMLElement | null = viewport.parentElement
    for (let i = 0; i < 10 && node; i += 1) {
      if (node === (outer as HTMLElement)) break
      const overflowY = getComputedStyle(node).overflowY
      parentOverflows.push({ tag: node.tagName.toLowerCase(), overflowY })
      node = node.parentElement
    }

    return { viewOverflowY, parentOverflows }
  })

  expect(snapshot).not.toBeNull()
  expect(snapshot?.viewOverflowY).toBe("auto")
  for (const entry of snapshot?.parentOverflows ?? []) {
    expect(entry.overflowY, `unexpected ancestor overflow-y: ${entry.tag} ${entry.overflowY}`).not.toBe("auto")
    expect(entry.overflowY, `unexpected ancestor overflow-y: ${entry.tag} ${entry.overflowY}`).not.toBe("scroll")
  }
})

test("terminal scrollbar is styled via app CSS", async ({ page }) => {
  await ensureWorkspace(page)

  const terminal = page.getByTestId("pty-terminal")
  await expect
    .poll(async () => await terminal.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0)

  const hasStyle = await terminal.evaluate((outer) => {
    if (!(outer instanceof HTMLElement)) return false
    if (!outer.classList.contains("luban-terminal")) return false

    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | null = null
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          const css = rule.cssText
          if (
            css.includes(".luban-terminal") &&
            css.includes(".xterm-viewport") &&
            css.includes("::-webkit-scrollbar")
          ) {
            return true
          }
        }
        if ("cssText" in rule) {
          const css = String((rule as any).cssText ?? "")
          if (
            css.includes(".luban-terminal") &&
            css.includes(".xterm-viewport") &&
            css.includes("::-webkit-scrollbar")
          ) {
            return true
          }
        }
      }
      // Some browsers may not expose nested rules for `@layer`; fall back to scanning the sheet text.
      try {
        const owner = (sheet as any).ownerNode as HTMLStyleElement | HTMLLinkElement | null
        const text = owner && "textContent" in owner ? String(owner.textContent ?? "") : ""
        if (
          text.includes(".luban-terminal") &&
          text.includes(".xterm-viewport") &&
          text.includes("::-webkit-scrollbar")
        ) {
          return true
        }
      } catch {
        // ignore
      }
    }
    return false
  })

  expect(hasStyle).toBe(true)
})
