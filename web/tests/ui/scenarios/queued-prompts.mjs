import { waitForLocatorCount } from '../lib/utils.mjs';

export async function runQueuedPrompts({ page }) {
  await page.getByTestId('sidebar-project-mock-project-1').click();
  await page.getByTestId('task-list-view').waitFor({ state: 'visible' });
  await page.getByText('Mock task 1').first().click();

  const scrollContainer = page.getByTestId('chat-scroll-container');
  await scrollContainer.waitFor({ state: 'visible' });
  await scrollContainer.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

  const pickEventLocator = async () => {
    const activity = page.getByTestId('activity-event');
    if ((await activity.count()) > 0) return activity;
    return page.getByTestId('conversation-event');
  };

  const eventLocator = await pickEventLocator();
  const runningRow = eventLocator.filter({ hasText: 'Progress update 3' }).first();
  await runningRow.waitFor({ state: 'visible' });
  await runningRow.getByTestId('event-running-icon').waitFor({ state: 'visible' });

  const queuedText = `Queued prompt ${Date.now()}`;
  await page.getByTestId('chat-input').fill(queuedText);
  await page.getByTestId('chat-send').click();

  const queuedSection = page.getByTestId('queued-prompts');
  await queuedSection.waitFor({ state: 'visible' });

  const queuedItems = queuedSection.getByTestId('queued-prompt-item');
  await waitForLocatorCount(queuedItems, 1, 20_000);

  const queuedBubble = queuedSection.getByTestId('queued-prompt-bubble').first();
  await queuedBubble.waitFor({ state: 'visible' });
  const bubbleText = await queuedBubble.innerText();
  if (!bubbleText.includes(queuedText)) {
    throw new Error('expected queued prompt to be visible in queued section');
  }

  const borderStyle = await queuedBubble.evaluate((el) => getComputedStyle(el).borderTopStyle);
  if (borderStyle !== 'dashed') {
    throw new Error(`expected queued prompt bubble border-style dashed, got ${borderStyle}`);
  }

  const activityUserContent = page.getByTestId('activity-user-message-content').filter({ hasText: queuedText });
  if ((await activityUserContent.count()) !== 0) {
    throw new Error('expected queued prompt not to be inserted into the activity stream until processing starts');
  }
}

