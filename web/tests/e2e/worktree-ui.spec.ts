import { expect, test } from "@playwright/test"
import { execSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PNG } from "pngjs"
import { ensureWorkspace, sendWsAction } from "./helpers"

function parseRgb(color: string): { r: number; g: number; b: number } | null {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+\s*)?\)$/.exec(color.trim())
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

test("worktree item shows branch name above worktree name", async ({ page }) => {
  await ensureWorkspace(page)

  const worktreeName = page.getByTestId("worktree-worktree-name").first()
  const branchName = page.getByTestId("worktree-branch-name").first()

  const nameBox = await worktreeName.boundingBox()
  const branchBox = await branchName.boundingBox()
  expect(nameBox, "worktree name should be visible").not.toBeNull()
  expect(branchBox, "worktree branch name should be visible").not.toBeNull()
  expect((branchBox?.y ?? 0) < (nameBox?.y ?? 0)).toBeTruthy()
})

test("main worktree home icon is only visible on hover", async ({ page }) => {
  await ensureWorkspace(page)

  const row = page.getByTestId("worktree-branch-name").first().locator("..").locator("..")
  const icon = row.getByTestId("worktree-home-icon")
  await expect(icon).toHaveCount(1)

  await page.getByTestId("chat-input").hover()
  await expect
    .poll(
      async () => Number(await icon.evaluate((el) => getComputedStyle(el).opacity)),
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(0.05)

  await row.hover()
  await expect
    .poll(
      async () => Number(await icon.evaluate((el) => getComputedStyle(el).opacity)),
      { timeout: 5_000 },
    )
    .toBeGreaterThanOrEqual(0.95)
})

test("new tab is appended to the end", async ({ page }) => {
  await ensureWorkspace(page)

  const tabs = page.locator('[data-testid="thread-tab-title"]')
  const beforeCount = await tabs.count()
  expect(beforeCount).toBeGreaterThan(0)
  const beforeLast = (await tabs.last().textContent())?.trim()

  await page.getByTitle("New tab").click()
  await expect(tabs).toHaveCount(beforeCount + 1, { timeout: 20_000 })

  const afterLast = (await tabs.last().textContent())?.trim()
  expect(afterLast).not.toBe(beforeLast)
})

test("creating a worktree auto-opens its conversation", async ({ page }) => {
  await ensureWorkspace(page)

  const beforeWorkspaceId =
    (await page.evaluate(() => localStorage.getItem("luban:active_workspace_id"))) ?? ""
  expect(beforeWorkspaceId.length).toBeGreaterThan(0)

  const projectToggle = page.getByRole("button", { name: "e2e-project", exact: true })
  const projectContainer = projectToggle.locator("..").locator("..")

  const addWorktree = projectContainer.getByTitle("Add worktree")
  await addWorktree.click()

  await expect
    .poll(async () => (await page.evaluate(() => localStorage.getItem("luban:active_workspace_id"))) ?? "", {
      timeout: 90_000,
    })
    .not.toBe(beforeWorkspaceId)

  await expect(page.getByTestId("chat-input")).toBeFocused({ timeout: 20_000 })
})

test("non-git projects do not show worktree controls", async ({ page }) => {
  await page.goto("/")

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "luban-e2e-non-git-"))
  fs.writeFileSync(path.join(projectDir, "notes.txt"), "hello\n", "utf8")
  const projectPath = fs.realpathSync(projectDir)

  await sendWsAction(page, { type: "add_project", path: projectPath })

  const resolveProjectSlug = async () =>
    await page.evaluate(async (projectDir) => {
      const res = await fetch("/api/app")
      if (!res.ok) return null
      const app = (await res.json()) as { projects: { path: string; slug: string }[] }
      return app.projects.find((p) => p.path === projectDir)?.slug ?? null
    }, projectPath)

  await expect.poll(async () => await resolveProjectSlug(), { timeout: 15_000 }).not.toBeNull()
  const projectSlug = await resolveProjectSlug()
  if (!projectSlug) throw new Error(`project slug not found for ${projectPath}`)

  const projectToggle = page.getByRole("button", { name: projectSlug, exact: true })
  await projectToggle.waitFor({ state: "visible", timeout: 15_000 })
  const projectContainer = projectToggle.locator("..").locator("..")

  await projectContainer.hover()
  await expect(projectContainer.getByTitle("Add worktree")).toHaveCount(0)
})

test("git projects without worktrees show standalone agent status icon", async ({ page }) => {
  await page.goto("/")

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "luban-e2e-git-empty-"))
  execSync("git init", { cwd: projectDir, stdio: "ignore" })
  execSync("git checkout -b main", { cwd: projectDir, stdio: "ignore" })
  fs.writeFileSync(path.join(projectDir, "README.md"), "e2e\n", "utf8")
  execSync("git add -A", { cwd: projectDir, stdio: "ignore" })
  execSync('git -c user.email="e2e@example.com" -c user.name="e2e" commit -m "init"', {
    cwd: projectDir,
    stdio: "ignore",
  })

  const projectPath = fs.realpathSync(projectDir)
  await sendWsAction(page, { type: "add_project", path: projectPath })

  const resolveProjectSlug = async () =>
    await page.evaluate(async (projectDir) => {
      const res = await fetch("/api/app")
      if (!res.ok) return null
      const app = (await res.json()) as { projects: { path: string; slug: string }[] }
      return app.projects.find((p) => p.path === projectDir)?.slug ?? null
    }, projectPath)

  await expect.poll(async () => await resolveProjectSlug(), { timeout: 15_000 }).not.toBeNull()
  const projectSlug = await resolveProjectSlug()
  if (!projectSlug) throw new Error(`project slug not found for ${projectPath}`)

  const projectToggle = page.getByRole("button", { name: projectSlug, exact: true })
  await projectToggle.waitFor({ state: "visible", timeout: 15_000 })
  const projectContainer = projectToggle.locator("..").locator("..")

  await expect(projectToggle.getByTestId("project-agent-status-icon")).toBeVisible({ timeout: 10_000 })
  await expect(projectContainer.getByTestId("worktree-branch-name")).toHaveCount(0)

  await projectContainer.hover()
  await expect(projectContainer.getByTitle("Add worktree")).toHaveCount(1)
})

test("git projects with only main worktree render as a standalone entry", async ({ page }) => {
  await page.goto("/")

  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "luban-e2e-main-only-origin-"))
  execSync("git init --bare", { cwd: remoteDir, stdio: "ignore" })

  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "luban-e2e-main-only-"))
  const projectDir = path.join(repoRoot, "repo")
  execSync(`git clone "${remoteDir}" "${projectDir}"`, { stdio: "ignore" })

  fs.writeFileSync(path.join(projectDir, "README.md"), "e2e\n", "utf8")
  execSync("git checkout -b main", { cwd: projectDir, stdio: "ignore" })
  execSync('git config user.email "e2e@example.com"', { cwd: projectDir, stdio: "ignore" })
  execSync('git config user.name "e2e"', { cwd: projectDir, stdio: "ignore" })
  execSync("git add -A", { cwd: projectDir, stdio: "ignore" })
  execSync('git commit -m "init"', { cwd: projectDir, stdio: "ignore" })
  execSync("git push -u origin main", { cwd: projectDir, stdio: "ignore" })
  execSync("git symbolic-ref HEAD refs/heads/main", { cwd: remoteDir, stdio: "ignore" })
  execSync("git fetch --prune origin", { cwd: projectDir, stdio: "ignore" })
  execSync("git remote set-head origin -a", { cwd: projectDir, stdio: "ignore" })

  const projectPath = fs.realpathSync(projectDir)
  await sendWsAction(page, { type: "add_project", path: projectPath })

  const resolveProjectSlug = async () =>
    await page.evaluate(async (projectDir) => {
      const res = await fetch("/api/app")
      if (!res.ok) return null
      const app = (await res.json()) as { projects: { path: string; slug: string }[] }
      return app.projects.find((p) => p.path === projectDir)?.slug ?? null
    }, projectPath)

  await expect.poll(async () => await resolveProjectSlug(), { timeout: 15_000 }).not.toBeNull()
  const projectSlug = await resolveProjectSlug()
  if (!projectSlug) throw new Error(`project slug not found for ${projectPath}`)

  const projectToggle = page.getByRole("button", { name: projectSlug, exact: true })
  await projectToggle.waitFor({ state: "visible", timeout: 15_000 })
  const projectContainer = projectToggle.locator("..").locator("..")

  await projectContainer.hover()
  await projectContainer.getByTitle("Add worktree").click()

  const branches = projectContainer.getByTestId("worktree-branch-name")
  await branches.first().waitFor({ timeout: 90_000 })

  const ids = await page.evaluate(async (projectDir) => {
    const res = await fetch("/api/app")
    if (!res.ok) return null
    const app = (await res.json()) as {
      projects: {
        id: number
        path: string
        workspaces: { id: number; status: string; workspace_name: string; worktree_path: string }[]
      }[]
    }
    const project = app.projects.find((p) => p.path === projectDir)
    if (!project) return null
    const main = project.workspaces.find((w) => w.status === "active" && w.workspace_name === "main" && w.worktree_path === project.path)
    const nonMain = project.workspaces.filter((w) => w.status === "active" && !(w.workspace_name === "main" && w.worktree_path === project.path))
    return { projectId: project.id, mainId: main?.id ?? null, nonMainIds: nonMain.map((w) => w.id) }
  }, projectPath)
  if (!ids || !ids.mainId || ids.nonMainIds.length === 0) throw new Error("expected main and non-main workspaces")

  for (const wid of ids.nonMainIds) {
    await sendWsAction(page, { type: "archive_workspace", workspace_id: wid })
  }

  await expect.poll(async () => {
    return await page.evaluate(async (projectDir) => {
      const res = await fetch("/api/app")
      if (!res.ok) return null
      const app = (await res.json()) as {
        projects: { path: string; workspaces: { id: number; status: string }[] }[]
      }
      const project = app.projects.find((p) => p.path === projectDir)
      if (!project) return null
      return project.workspaces.filter((w) => w.status === "active").length
    }, projectPath)
  }, { timeout: 90_000 }).toBe(1)

  await expect(projectContainer.getByTestId("project-main-only-entry")).toBeVisible({ timeout: 15_000 })
  await expect(projectContainer.getByTestId("worktree-branch-name")).toHaveCount(0)

  await projectToggle.click()
  await expect
    .poll(async () => (await page.evaluate(() => localStorage.getItem("luban:active_workspace_id"))) ?? "", {
      timeout: 20_000,
    })
    .toBe(String(ids.mainId))
})

test("settings panel exposes Codex agent settings", async ({ page }) => {
  await ensureWorkspace(page)

  await page.getByTestId("sidebar-open-settings").click()
  await expect(page.getByTestId("settings-panel")).toBeVisible({ timeout: 10_000 })

  await page.getByRole("button", { name: "Agent", exact: true }).click()
  await expect(page.getByText("Codex", { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId("settings-codex-toggle")).toBeVisible({ timeout: 10_000 })
})

test("left sidebar does not allow horizontal scrolling", async ({ page }) => {
  await ensureWorkspace(page)

  const scroll = page.getByTestId("left-sidebar-scroll")

  await expect
    .poll(async () => await scroll.evaluate((el) => getComputedStyle(el).overflowX), { timeout: 5_000 })
    .toBe("hidden")

  await scroll.hover()
  const before = await scroll.evaluate((el) => el.scrollLeft)
  await page.mouse.wheel(200, 0)
  const after = await scroll.evaluate((el) => el.scrollLeft)

  expect(before).toBe(0)
  expect(after).toBe(0)
})

test("changes panel opens unified diff tab", async ({ page }) => {
  await ensureWorkspace(page)

  const workspaceIdRaw = (await page.evaluate(() => localStorage.getItem("luban:active_workspace_id"))) ?? ""
  const workspaceId = Number(workspaceIdRaw)
  expect(workspaceId).toBeGreaterThan(0)

  const worktreePath = await page.evaluate(async (workspaceId) => {
    const res = await fetch("/api/app")
    if (!res.ok) return null
    const app = (await res.json()) as { projects: { workspaces: { id: number; worktree_path: string }[] }[] }
    for (const p of app.projects) {
      for (const w of p.workspaces) {
        if (w.id === workspaceId) return w.worktree_path
      }
    }
    return null
  }, workspaceId)
  if (!worktreePath) throw new Error("worktree_path not found")

  const demo = path.join(worktreePath, "diff-demo.txt")
  fs.writeFileSync(demo, "hello\nworld\n", "utf8")

  await page.getByTestId("right-sidebar-tab-changes").click()
  const fileRow = page.getByRole("button", { name: /diff-demo\.txt/ }).first()
  await expect(fileRow).toBeVisible({ timeout: 20_000 })
  await fileRow.click()

  await expect(page.getByTestId("diff-viewer")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId("diff-viewer").getByText("diff-demo.txt").first()).toBeVisible({ timeout: 20_000 })
})

test("archiving a worktree shows an executing animation", async ({ page }) => {
  await page.goto("/")

  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "luban-e2e-archive-origin-"))
  execSync("git init --bare", { cwd: remoteDir, stdio: "ignore" })

  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "luban-e2e-archive-"))
  const projectDir = path.join(repoRoot, "repo")
  execSync(`git clone "${remoteDir}" "${projectDir}"`, { stdio: "ignore" })

  fs.writeFileSync(path.join(projectDir, "README.md"), "e2e\n", "utf8")
  execSync("git checkout -b main", { cwd: projectDir, stdio: "ignore" })
  execSync('git config user.email "e2e@example.com"', { cwd: projectDir, stdio: "ignore" })
  execSync('git config user.name "e2e"', { cwd: projectDir, stdio: "ignore" })
  execSync("git add -A", { cwd: projectDir, stdio: "ignore" })
  execSync('git commit -m "init"', { cwd: projectDir, stdio: "ignore" })
  execSync("git push -u origin main", { cwd: projectDir, stdio: "ignore" })
  execSync("git symbolic-ref HEAD refs/heads/main", { cwd: remoteDir, stdio: "ignore" })
  execSync("git fetch --prune origin", { cwd: projectDir, stdio: "ignore" })
  execSync("git remote set-head origin -a", { cwd: projectDir, stdio: "ignore" })

  const projectPath = fs.realpathSync(projectDir)
  await sendWsAction(page, { type: "add_project", path: projectPath })

  const resolveProjectSlug = async () =>
    await page.evaluate(async (projectDir) => {
      const res = await fetch("/api/app")
      if (!res.ok) return null
      const app = (await res.json()) as { projects: { path: string; slug: string }[] }
      return app.projects.find((p) => p.path === projectDir)?.slug ?? null
    }, projectPath)

  await expect.poll(async () => await resolveProjectSlug(), { timeout: 15_000 }).not.toBeNull()

  const projectSlug = await resolveProjectSlug()
  if (!projectSlug) throw new Error(`project slug not found for ${projectPath}`)

  const projectToggle = page.getByRole("button", { name: projectSlug, exact: true })
  await projectToggle.waitFor({ state: "visible", timeout: 15_000 })

  const projectContainer = projectToggle.locator("..").locator("..")

  const projectId = await page.evaluate(async (projectDir) => {
    const res = await fetch("/api/app")
    if (!res.ok) return null
    const app = (await res.json()) as { projects: { id: number; path: string }[] }
    return app.projects.find((p) => p.path === projectDir)?.id ?? null
  }, projectPath)
  if (!projectId) throw new Error(`project id not found for ${projectPath}`)

  await sendWsAction(page, { type: "create_workspace", project_id: projectId })

  const resolveWorkspace = async () =>
    await page.evaluate(async (projectDir) => {
      const res = await fetch("/api/app")
      if (!res.ok) return null
      const app = (await res.json()) as {
        projects: {
          path: string
          workspaces: {
            id: number
            short_id: string
            workspace_name: string
            branch_name: string
            status: string
          }[]
        }[]
      }
      const project = app.projects.find((p) => p.path === projectDir)
      if (!project) return null
      const main = project.workspaces.find((w) => w.workspace_name === "main" && w.status === "active") ?? null
      const workspace =
        project.workspaces.find((w) => w.workspace_name !== "main" && w.status === "active") ?? null
      if (!workspace) return null
      return {
        workspaceId: workspace.id,
        worktreeName: workspace.workspace_name,
        branchName: workspace.branch_name,
        mainBranchName: main?.branch_name ?? null,
      }
    }, projectPath)

  await expect.poll(async () => await resolveWorkspace(), { timeout: 90_000 }).not.toBeNull()

  const resolved = await resolveWorkspace()
  if (!resolved) throw new Error("workspace not found after creation")
  const worktreeName = resolved.worktreeName
  const branchName = resolved.branchName
  const mainBranchName = resolved.mainBranchName
  if (!mainBranchName) throw new Error("main workspace not found")

  const ensureExpanded = async () => {
    const count = await projectContainer
      .getByTestId("worktree-worktree-name")
      .filter({ hasText: worktreeName })
      .count()
    if (count > 0) return
    await projectToggle.click()
  }

  await ensureExpanded()
  await expect
    .poll(async () => await projectContainer.getByTestId("worktree-worktree-name").filter({ hasText: worktreeName }).count(), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0)
  const row = projectContainer
    .getByTestId("worktree-worktree-name")
    .filter({ hasText: worktreeName })
    .locator("..")
    .locator("..")

  await row.click()
  await expect(page.getByTestId("active-workspace-branch")).toHaveText(branchName, { timeout: 15_000 })

  await row.hover()
  await row.getByTitle("Archive worktree").click()

  const spinner = row.getByTestId("worktree-archiving-spinner")
  const outcome = await Promise.race([
    spinner.waitFor({ state: "visible", timeout: 20_000 }).then(() => "spinner" as const),
    row.waitFor({ state: "detached", timeout: 20_000 }).then(() => "detached" as const),
  ])
  void outcome

  await expect.poll(async () => await row.count(), { timeout: 90_000 }).toBe(0)
  await expect(page.getByTestId("active-workspace-branch")).toHaveText(mainBranchName, { timeout: 30_000 })
})

test("sidebar resize gutter does not break header divider line", async ({ page }) => {
  await ensureWorkspace(page)

  const aside = page.locator("aside").first()
  const sidebarHeader = page.locator("aside > div").first()

  const sidebarHeaderBorder = await sidebarHeader.evaluate((el) => getComputedStyle(el).borderBottomColor)
  const rgb = parseRgb(sidebarHeaderBorder)
  expect(rgb, `unexpected sidebar header border: ${sidebarHeaderBorder}`).not.toBeNull()

  const asideBox = await aside.boundingBox()
  const headerBox = await sidebarHeader.boundingBox()
  expect(asideBox, "sidebar should have bounds").not.toBeNull()
  expect(headerBox, "sidebar header should have bounds").not.toBeNull()

  const sampleX = Math.floor((asideBox?.x ?? 0) + (asideBox?.width ?? 0) + 1)
  const sampleY = Math.floor((headerBox?.y ?? 0) + (headerBox?.height ?? 0) - 1)

  const shot1 = await page.screenshot({
    clip: { x: Math.max(0, sampleX - 3), y: Math.max(0, sampleY - 3), width: 7, height: 7 },
  })
  const png1 = PNG.sync.read(shot1)
  const px1 = samplePixel(png1, 3, 3)

  const tol = 18
  expect(px1.a).toBeGreaterThan(200)
  expect(Math.abs(px1.r - (rgb?.r ?? 0))).toBeLessThanOrEqual(tol)
  expect(Math.abs(px1.g - (rgb?.g ?? 0))).toBeLessThanOrEqual(tol)
  expect(Math.abs(px1.b - (rgb?.b ?? 0))).toBeLessThanOrEqual(tol)

  const handle = page.getByTestId("sidebar-resizer")
  const handleBox = await handle.boundingBox()
  expect(handleBox, "sidebar resizer should have bounds").not.toBeNull()

  await page.mouse.move((handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2, (handleBox?.y ?? 0) + 40)
  await page.mouse.down()
  await page.mouse.move((handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2 + 80, (handleBox?.y ?? 0) + 40)
  await page.mouse.up()

  const asideBox2 = await aside.boundingBox()
  expect((asideBox2?.width ?? 0)).toBeGreaterThan((asideBox?.width ?? 0))

  const sampleX2 = Math.floor((asideBox2?.x ?? 0) + (asideBox2?.width ?? 0) + 1)
  const shot2 = await page.screenshot({
    clip: { x: Math.max(0, sampleX2 - 3), y: Math.max(0, sampleY - 3), width: 7, height: 7 },
  })
  const png2 = PNG.sync.read(shot2)
  const px2 = samplePixel(png2, 3, 3)

  expect(px2.a).toBeGreaterThan(200)
  expect(Math.abs(px2.r - (rgb?.r ?? 0))).toBeLessThanOrEqual(tol)
  expect(Math.abs(px2.g - (rgb?.g ?? 0))).toBeLessThanOrEqual(tol)
  expect(Math.abs(px2.b - (rgb?.b ?? 0))).toBeLessThanOrEqual(tol)
})
