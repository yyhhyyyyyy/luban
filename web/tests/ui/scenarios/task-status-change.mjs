import { waitForDataAttribute } from '../lib/utils.mjs';

function parseStatusTitle(title) {
  if (!title) return null;
  const prefix = 'Status: ';
  if (!title.startsWith(prefix)) return null;
  return title.slice(prefix.length).trim();
}

export async function runTaskStatusChange({ page }) {
  await page.getByTestId('sidebar-project-mock-project-1').click();
  await page.getByTestId('task-list-view').waitFor({ state: 'visible' });

  const row = page.getByTestId('task-list-view').locator('div.group', { hasText: 'Mock task 1' }).first();
  await row.waitFor({ state: 'visible' });

  const trigger = row.locator('button[title^="Status:"]').first();
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
