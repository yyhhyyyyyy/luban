import { sleep } from '../lib/utils.mjs';

async function waitForTextEquals(locator, expected, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = ((await locator.textContent()) ?? '').trim();
    if (text === expected) return;
    await sleep(200);
  }
  const last = ((await locator.textContent()) ?? '').trim();
  throw new Error(`timeout waiting for text; expected="${expected}" got="${last}"`);
}

async function waitForTextMatches(locator, regex, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = ((await locator.textContent()) ?? '').trim();
    if (regex.test(text)) return text;
    await sleep(200);
  }
  const last = ((await locator.textContent()) ?? '').trim();
  throw new Error(`timeout waiting for text match; regex=${regex} got="${last}"`);
}

export async function runInboxPreviewLine({ page }) {
  await page.getByTestId('nav-inbox-button').click();
  await page.getByTestId('inbox-view').waitFor({ state: 'visible' });

  const rows = page.locator('[data-testid^="inbox-notification-row-"]');
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    if ((await rows.count()) > 0) break;
    await sleep(100);
  }

  const rowCount = await rows.count();
  if (rowCount === 0) throw new Error('expected inbox to have at least one row');

  let turnStatesRow = null;
  let prPendingRow = null;
  for (let i = 0; i < Math.min(rowCount, 30); i += 1) {
    const row = page.getByTestId(`inbox-notification-row-${i}`);
    const title = ((await row.getByTestId('inbox-notification-task-title').textContent()) ?? '').trim();
    if (title === 'Mock: Turn states') {
      turnStatesRow = row;
    } else if (title === 'PR: pending') {
      prPendingRow = row;
    }
    if (turnStatesRow && prPendingRow) break;
  }
  if (!turnStatesRow) throw new Error('failed to locate inbox row for task title "Mock: Turn states"');
  if (!prPendingRow) throw new Error('failed to locate inbox row for task title "PR: pending"');

  const avatar = turnStatesRow.getByTestId('inbox-notification-project-avatar');
  await avatar.waitFor({ state: 'visible' });

  const box = await avatar.boundingBox();
  if (!box) throw new Error('missing inbox project avatar bounding box');
  if (Math.round(box.width) !== 14 || Math.round(box.height) !== 14) {
    throw new Error(`expected inbox project avatar to be 14x14, got ${box.width}x${box.height}`);
  }

  const alt = await avatar.getAttribute('alt');
  if (!alt || !alt.includes('git/project')) {
    throw new Error(`expected inbox avatar alt to include "git/project", got ${JSON.stringify(alt)}`);
  }

  const preview = turnStatesRow.getByTestId('inbox-notification-preview');
  await preview.waitFor({ state: 'visible' });
  await waitForTextEquals(preview, 'Canceled as requested.');

  const runningPreview = prPendingRow.getByTestId('inbox-notification-preview');
  await runningPreview.waitFor({ state: 'visible' });
  await waitForTextEquals(runningPreview, 'Also include tests.');

  const runningTimestamp = prPendingRow.getByTestId('inbox-notification-timestamp');
  await runningTimestamp.waitFor({ state: 'visible' });
  const ts = await waitForTextMatches(runningTimestamp, /^\d+m$/);
  const minutes = Number(ts.slice(0, -1));
  if (!Number.isFinite(minutes) || minutes < 1) {
    throw new Error(`expected running inbox timestamp to be >= 1m, got ${JSON.stringify(ts)}`);
  }
}
