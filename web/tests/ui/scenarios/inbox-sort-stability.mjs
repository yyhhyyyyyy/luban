import { sleep } from '../lib/utils.mjs';

async function inboxRowTaskTitle(row) {
  const title = row.getByTestId('inbox-notification-task-title').first();
  await title.waitFor({ state: 'visible' });
  return ((await title.textContent()) ?? '').trim();
}

export async function runInboxSortStability({ page }) {
  await page.getByTestId('nav-inbox-button').click();
  await page.getByTestId('inbox-view').waitFor({ state: 'visible' });

  const row0 = page.getByTestId('inbox-notification-row-0');
  const row1 = page.getByTestId('inbox-notification-row-1');
  await row0.waitFor({ state: 'visible' });
  await row1.waitFor({ state: 'visible' });

  const row0Title = await inboxRowTaskTitle(row0);
  const row1Title = await inboxRowTaskTitle(row1);
  if (!row0Title || !row1Title) {
    throw new Error('expected inbox rows to have non-empty titles');
  }
  if (row0Title === row1Title) {
    throw new Error('expected inbox rows 0 and 1 to have different titles for a stable ordering assertion');
  }

  await row1.click();
  const message = `Inbox reorder stability ${Date.now()}`;
  await page.getByTestId('chat-input').fill(message);
  await page.getByTestId('chat-send').click();

  // Give the app time to process the message and emit app/workdir task events.
  await sleep(500);

  const row0TitleAfterMessage = await inboxRowTaskTitle(row0);
  if (row0TitleAfterMessage !== row0Title) {
    throw new Error(
      `expected inbox ordering to stay stable after message updates; got row0 before="${row0Title}" after="${row0TitleAfterMessage}"`,
    );
  }

  // Leaving and reopening inbox should refresh and resort by updated_at.
  await page.getByTestId('sidebar-project-mock-project-1').click();
  await page.getByTestId('task-list-view').waitFor({ state: 'visible' });

  await page.getByTestId('nav-inbox-button').click();
  await page.getByTestId('inbox-view').waitFor({ state: 'visible' });

  const row0AfterReopen = page.getByTestId('inbox-notification-row-0');
  await row0AfterReopen.waitFor({ state: 'visible' });
  const row0TitleAfterReopen = await inboxRowTaskTitle(row0AfterReopen);
  if (row0TitleAfterReopen !== row1Title) {
    throw new Error(
      `expected inbox to resort after reopen; got row0="${row0TitleAfterReopen}" expected="${row1Title}"`,
    );
  }

  // Select the newest item so later scenarios have a stable header surface (star button).
  await row0AfterReopen.click();
  await page.getByTestId('task-star-button').waitFor({ state: 'visible' });
}
