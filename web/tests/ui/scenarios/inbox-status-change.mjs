import { sleep, waitForDataAttribute } from '../lib/utils.mjs';

function parseStatusTitle(title) {
  if (!title) return null;
  const prefix = 'Status: ';
  if (!title.startsWith(prefix)) return null;
  return title.slice(prefix.length).trim();
}

export async function runInboxStatusChange({ page }) {
  await page.getByTestId('nav-inbox-button').click();
  await page.getByTestId('inbox-view').waitFor({ state: 'visible' });

  const rows = page.locator('[data-testid^="inbox-notification-row-"]');
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    if ((await rows.count()) > 0) break;
    await sleep(250);
  }

  const rowCount = await rows.count();
  if (rowCount === 0) {
    throw new Error('expected at least one inbox notification row');
  }

  const row = rows.first();
  await row.waitFor({ state: 'visible' });
  await row.click();

  const trigger = page.getByTestId('inbox-task-status-trigger');
  await trigger.waitFor({ state: 'visible' });

  const currentTitle = await trigger.getAttribute('title');
  const currentLabel = parseStatusTitle(currentTitle) ?? '';

  const next =
    currentLabel === 'Iterating'
      ? { id: 'todo', label: 'Todo' }
      : { id: 'iterating', label: 'Iterating' };

  await trigger.click();
  await page.getByTestId(`task-status-option-${next.id}`).click();

  await waitForDataAttribute(trigger, 'title', `Status: ${next.label}`, 20_000);
}

