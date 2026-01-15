import { expect, test } from "@playwright/test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { requireEnv } from "./env"
import { sendWsAction } from "./helpers"

function runGit(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" })
}

function ensureEmptyDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

test("project can be deleted via sidebar confirmation dialog", async ({ page }) => {
  await page.goto("/")

  const root = requireEnv("LUBAN_E2E_ROOT")

  const tmpBase = path.join(os.tmpdir(), "luban-e2e-delete-project-")
  const projectDir = fs.mkdtempSync(tmpBase)
  ensureEmptyDir(projectDir)

  runGit(projectDir, ["init"])
  runGit(projectDir, ["config", "user.email", "e2e@example.com"])
  runGit(projectDir, ["config", "user.name", "luban-e2e"])
  runGit(projectDir, ["checkout", "-b", "main"])

  fs.writeFileSync(path.join(projectDir, "README.md"), "luban delete project e2e\n", "utf8")
  runGit(projectDir, ["add", "."])
  runGit(projectDir, ["commit", "-m", "init"])

  const projectPath = fs.realpathSync(projectDir)
  await sendWsAction(page, { type: "add_project", path: projectPath })

  const resolveProject = async () =>
    await page.evaluate(async (projectPath) => {
      const res = await fetch("/api/app")
      if (!res.ok) return null
      const app = (await res.json()) as { projects: { id: number; path: string; slug: string }[] }
      const project = app.projects.find((p) => p.path === projectPath) ?? null
      if (!project) return null
      return { id: project.id, slug: project.slug }
    }, projectPath)

  await expect.poll(async () => await resolveProject(), { timeout: 15_000 }).not.toBeNull()
  const project = await resolveProject()
  if (!project) throw new Error("project not found after add_project")

  const projectToggle = page.getByRole("button", { name: project.slug, exact: true })
  await projectToggle.waitFor({ state: "visible", timeout: 15_000 })
  const projectContainer = projectToggle.locator("..").locator("..")

  await projectContainer.hover()
  await projectContainer.getByTestId("project-delete-button").click()

  await expect(page.getByTestId("project-delete-dialog")).toBeVisible({ timeout: 10_000 })
  await page.getByTestId("project-delete-confirm").click()

  await expect(page.getByRole("button", { name: project.slug, exact: true })).toHaveCount(0, { timeout: 20_000 })
  await expect
    .poll(async () => await resolveProject(), { timeout: 20_000 })
    .toBeNull()
})

test("deleting the active project switches to another project's main workspace", async ({ page }) => {
  await page.goto("/")

  const makeGitProject = (suffix: string) => {
    const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), `luban-e2e-delete-active-${suffix}-origin-`))
    execFileSync("git", ["init", "--bare"], { cwd: remoteDir, stdio: "ignore" })

    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `luban-e2e-delete-active-${suffix}-`))
    const projectDir = path.join(repoRoot, "repo")
    execFileSync("git", ["clone", remoteDir, projectDir], { stdio: "ignore" })

    fs.writeFileSync(path.join(projectDir, "README.md"), `e2e ${suffix}\n`, "utf8")
    execFileSync("git", ["checkout", "-b", "main"], { cwd: projectDir, stdio: "ignore" })
    execFileSync("git", ["config", "user.email", "e2e@example.com"], { cwd: projectDir, stdio: "ignore" })
    execFileSync("git", ["config", "user.name", "e2e"], { cwd: projectDir, stdio: "ignore" })
    execFileSync("git", ["add", "-A"], { cwd: projectDir, stdio: "ignore" })
    execFileSync("git", ["commit", "-m", "init"], { cwd: projectDir, stdio: "ignore" })
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: projectDir, stdio: "ignore" })
    execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: remoteDir, stdio: "ignore" })
    execFileSync("git", ["fetch", "--prune", "origin"], { cwd: projectDir, stdio: "ignore" })
    execFileSync("git", ["remote", "set-head", "origin", "-a"], { cwd: projectDir, stdio: "ignore" })

    return fs.realpathSync(projectDir)
  }

  const projectPathA = makeGitProject("a")
  const projectPathB = makeGitProject("b")

  await sendWsAction(page, { type: "add_project", path: projectPathA })
  await sendWsAction(page, { type: "add_project", path: projectPathB })

  const resolve = async () =>
    await page.evaluate(async ({ projectPathA, projectPathB }) => {
      const res = await fetch("/api/app")
      if (!res.ok) return null
      const app = (await res.json()) as {
        projects: {
          id: number
          slug: string
          path: string
          workspaces: { id: number; status: string; workspace_name: string; worktree_path: string }[]
        }[]
      }
      const pa = app.projects.find((p) => p.path === projectPathA) ?? null
      const pb = app.projects.find((p) => p.path === projectPathB) ?? null
      if (!pa || !pb) return null
      const mainA =
        pa.workspaces.find((w) => w.status === "active" && w.workspace_name === "main" && w.worktree_path === pa.path) ??
        pa.workspaces.find((w) => w.status === "active" && w.workspace_name === "main") ??
        null
      const mainB =
        pb.workspaces.find((w) => w.status === "active" && w.workspace_name === "main" && w.worktree_path === pb.path) ??
        pb.workspaces.find((w) => w.status === "active" && w.workspace_name === "main") ??
        null
      return { projectA: { id: pa.id, slug: pa.slug, mainId: mainA?.id ?? null }, projectB: { id: pb.id, slug: pb.slug, mainId: mainB?.id ?? null } }
    }, { projectPathA, projectPathB })

  await expect.poll(async () => await resolve(), { timeout: 15_000 }).not.toBeNull()
  let snap = await resolve()
  if (!snap) throw new Error("projects not found after add_project")

  if (!snap.projectA.mainId) await sendWsAction(page, { type: "ensure_main_workspace", project_id: snap.projectA.id })
  if (!snap.projectB.mainId) await sendWsAction(page, { type: "ensure_main_workspace", project_id: snap.projectB.id })

  await expect
    .poll(async () => {
      const next = await resolve()
      return Boolean(next?.projectA.mainId) && Boolean(next?.projectB.mainId)
    }, { timeout: 90_000 })
    .toBeTruthy()

  snap = await resolve()
  if (!snap) throw new Error("projects not found")
  if (!snap.projectA.mainId || !snap.projectB.mainId) throw new Error("main workspace ids not found")

  const projectAToggle = page.getByRole("button", { name: snap.projectA.slug, exact: true })
  const projectBToggle = page.getByRole("button", { name: snap.projectB.slug, exact: true })
  await projectAToggle.waitFor({ state: "visible", timeout: 15_000 })
  await projectBToggle.waitFor({ state: "visible", timeout: 15_000 })

  await projectAToggle.click()
  await expect
    .poll(async () => (await page.evaluate(() => localStorage.getItem("luban:active_workspace_id"))) ?? "", {
      timeout: 20_000,
    })
    .toBe(String(snap.projectA.mainId))

  const projectAContainer = projectAToggle.locator("..").locator("..")
  await projectAContainer.hover()
  await projectAContainer.getByTestId("project-delete-button").click()
  await expect(page.getByTestId("project-delete-dialog")).toBeVisible({ timeout: 10_000 })
  await page.getByTestId("project-delete-confirm").click()
  await expect(page.getByRole("button", { name: snap.projectA.slug, exact: true })).toHaveCount(0, { timeout: 20_000 })

  await expect
    .poll(async () => (await page.evaluate(() => localStorage.getItem("luban:active_workspace_id"))) ?? "", {
      timeout: 30_000,
    })
    .toBe(String(snap.projectB.mainId))
  await expect(page.getByTestId("active-project-name")).toHaveText(snap.projectB.slug, { timeout: 30_000 })
})
