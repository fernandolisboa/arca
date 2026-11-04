import { expect, test, type Page } from '@playwright/test';
import { newCredential, virtualAuthenticator, withoutAutofill } from './passkeys.js';
import {
  channelKinds,
  resetRateLimits,
  seedAccount,
  seedPushChannel,
} from './postgres/accounts.js';
import { reportViolations, watchProblems } from './problems.js';
import { databaseServer } from './servers.js';

test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');
test.beforeAll(async () => {
  await resetRateLimits();
});

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

async function signIn(page: Page, email: string) {
  await withoutAutofill(page);
  await page.goto(`${databaseServer.origin}/sign-in`);
  await page.getByRole('button', { name: 'Entrar com chave de acesso' }).click();
  await expect(page.getByText(`Você entrou como ${email}.`)).toBeVisible();
}

test("lists the account's channels and stops a device's notices after a step-up", async ({
  page,
}) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  const channelId = await seedPushChannel(userId);
  await virtualAuthenticator(page, credential, { userId });
  await signIn(page, email);
  await page.goto(`${databaseServer.origin}/settings`);

  const section = page.getByRole('region', { name: 'Avisos de segurança' });
  const list = section.getByRole('list', { name: 'Avisos de segurança' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByText('Email da conta')).toBeVisible();
  await expect(list.getByText('Chrome · Android')).toBeVisible();
  await expect(list.getByText('Nenhum aviso entregue ainda')).toBeVisible();
  // No environment has a VAPID key yet, so this browser cannot turn push on.
  await expect(section.getByText(/ainda não estão disponíveis/)).toBeVisible();
  await expect(
    section.getByRole('button', { name: 'Receber avisos neste dispositivo' }),
  ).toHaveCount(0);

  const stepUp = page.waitForRequest((request) =>
    request.url().endsWith('/v1/auth/step-up/options'),
  );
  await list.getByRole('button', { name: 'Parar os avisos' }).click();
  expect((await stepUp).postDataJSON()).toMatchObject({
    purpose: 'sensitive_settings',
    target: { action: 'removeNotificationChannel', targets: [channelId] },
  });
  await expect(section.getByRole('status')).toHaveText(
    'Pronto. Esse dispositivo não recebe mais avisos.',
  );
  await expect(list.getByRole('listitem')).toHaveCount(1);
  // No notice went out, so the account has no email channel yet either.
  expect(await channelKinds(userId)).toEqual([]);
  expect(problems).toEqual([]);
});

test('offers no notification settings without a session', async ({ page }) => {
  await page.goto(`${databaseServer.origin}/settings`);
  await expect(page.getByRole('heading', { level: 2, name: 'Configurações' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Avisos de segurança' })).toHaveCount(0);
});
