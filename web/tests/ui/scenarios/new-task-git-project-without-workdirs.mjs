export async function runNewTaskGitProjectWithoutWorkdirs({ page }) {
  const projectPath = `/mock/new/project-no-workdirs-${Date.now()}`
  const projectName = projectPath.split("/").slice(-1)[0]
  if (!projectName) throw new Error("expected project name")

  page.once("dialog", async (dialog) => {
    await dialog.accept(projectPath)
  })
  await page.getByTestId("add-project-button").click()

  const title = `E2E create task without workdirs ${Date.now()}`

  await page.getByTestId("new-task-button").click()
  await page.getByTestId("new-task-modal").waitFor({ state: "visible" })

  await page.getByTestId("new-task-project-selector").click()
  await page.getByPlaceholder("Set project...").fill(projectName)
  await page.getByRole("menuitem").filter({ hasText: projectName }).first().click()

  await page.getByTestId("new-task-input").fill(title)

  const submit = page.getByTestId("new-task-submit-button")
  if (!(await submit.isEnabled())) {
    throw new Error("expected submit to be enabled for git projects without workdirs")
  }

  await submit.click()
  await page.getByTestId("new-task-modal").waitFor({ state: "hidden" })

  await page.getByTestId("task-star-button").waitFor({ state: "visible" })
  await page.getByText(title).first().waitFor({ state: "visible" })
}

