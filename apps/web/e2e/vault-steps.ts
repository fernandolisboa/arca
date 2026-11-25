import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type Request } from '@playwright/test';

/** Steps the vault's journeys share: creating the vault and adding a file to it. */

export async function expectAccessible(page: Page) {
  expect(await new AxeBuilder({ page }).analyze().then(({ violations }) => violations)).toEqual([]);
}

export const opened = (page: Page) => page.getByText(/^O cofre está aberto neste dispositivo\./);

/** Each recovery envelope is an scrypt passphrase file: seconds of work on a busy machine. */
export const scrypt = { timeout: 20_000 };

/** Creates the vault and keeps the secret it shows once, as a person writing it down would. */
export async function setUp(page: Page): Promise<{ secret: string; upload: Request }> {
  const upload = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/v1/vault'),
  );
  await page.getByRole('button', { name: 'Criar meu cofre' }).click();
  const secret = await keepSecret(page);
  return { secret, upload: await upload };
}

/** Reads the vault secret shown once, checks the page, and confirms it was kept. */
export async function keepSecret(page: Page): Promise<string> {
  const sheet = page.getByRole('group', { name: 'Segredo de recuperação do cofre' });
  await expect(sheet).toBeVisible(scrypt);
  const secret = (await sheet.locator('p').nth(1).innerText()).trim();
  expect(secret).toMatch(/^[0-9A-Z]{4}( [0-9A-Z]{1,4}){6}$/);
  await expectAccessible(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await sheet.getByRole('button', { name: 'Copiar o segredo' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
  await page.getByLabel('Guardei o segredo num lugar seguro').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(opened(page)).toBeVisible();
  return secret;
}

export async function addFile(page: Page, name: string, contents: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Adicionar documento' }).click();
  await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(contents) });
  await expect(page.getByText('Documento guardado no cofre.')).toBeVisible();
}
