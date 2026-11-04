import { sentryProject, tunnelPath } from '@arca/telemetry';
import { expect, test } from '@playwright/test';

const message = 'synthetic failure for the tunnel test';

test('sends an error in the web app to our tunnel, scrubbed, and nothing leaves the origin', async ({
  page,
  baseURL,
}) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Arca' })).toBeVisible();

  const envelope = page.waitForRequest((request) => new URL(request.url()).pathname === tunnelPath);
  await page.evaluate((thrown) => {
    setTimeout(() => {
      throw new Error(thrown);
    });
  }, message);
  const body = (await envelope).postData() ?? '';

  const [head, item, event] = body.split('\n').map((line) => JSON.parse(line) as unknown);
  expect(head).toMatchObject({ dsn: sentryProject.dsn });
  expect(item).toMatchObject({ type: 'event' });
  expect(event).toMatchObject({ exception: { values: [{ type: 'Error' }] } });
  // The browser scrubs before sending, so the message, which may carry data, never leaves.
  expect(body).not.toContain(message);
  const origin = new URL(baseURL ?? '').origin;
  expect(requested.filter((url) => new URL(url).origin !== origin)).toEqual([]);
});
