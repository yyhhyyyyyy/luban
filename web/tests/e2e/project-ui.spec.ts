import { expect, test } from "@playwright/test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
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

  const root = process.env.LUBAN_E2E_ROOT
  if (!root) throw new Error("LUBAN_E2E_ROOT is not set")

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
