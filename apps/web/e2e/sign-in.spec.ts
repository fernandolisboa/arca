import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { resetRateLimits, seedAccount } from './postgres/accounts.js';
import { reportViolations, watchProblems } from './problems.js';
import { databaseServer } from './servers.js';

test.skip(!databaseServer.enabled, 'needs ARCA_E2E_DATABASE and a Postgres (see README)');
test.beforeAll(async () => {
  await resetRateLimits();
});

test.beforeEach(async ({ page }) => {
  await reportViolations(page);
});

/** A COSE EC2 P-256 ES256 public key in CBOR, as the passkey plugin stores it. */
function coseKey(x: Buffer, y: Buffer): string {
  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]).toString('base64');
}

interface Credential {
  readonly credentialId: string;
  readonly privateKey: string;
  readonly publicKey: string;
}

function newCredential(): Credential {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { x, y } = publicKey.export({ format: 'jwk' });
  return {
    credentialId: randomBytes(16).toString('base64url'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: coseKey(Buffer.from(String(x), 'base64url'), Buffer.from(String(y), 'base64url')),
  };
}

/** Chromium's virtual platform authenticator, holding one discoverable credential. */
async function virtualAuthenticator(
  page: Page,
  credential: Credential,
  { userId, userVerified = true }: { readonly userId: string; readonly userVerified?: boolean },
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      hasPrf: true,
      isUserVerified: userVerified,
      automaticPresenceSimulation: true,
    },
  });
  const hold = async (held: Credential, owner: string) => {
    await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
    await cdp.send('WebAuthn.addCredential', {
      authenticatorId,
      credential: {
        credentialId: Buffer.from(held.credentialId, 'base64url').toString('base64'),
        isResidentCredential: true,
        rpId: databaseServer.rpId,
        privateKey: held.privateKey,
        userHandle: Buffer.from(owner.replaceAll('-', ''), 'hex').toString('base64'),
        signCount: 0,
      },
    });
  };
  await hold(credential, userId);
  /** Swaps the credential it holds for another. */
  return { hold };
}

const signInButton = (page: Page) =>
  page.getByRole('button', { name: 'Entrar com chave de acesso' });

/**
 * Chromium's virtual authenticator answers an autofill request on its own, so the button tests
 * turn autofill off to reach the button.
 */
async function withoutAutofill(page: Page) {
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
  });
}

async function expectSignedInAs(page: Page, email: string) {
  await expect(page.getByText(`Você entrou como ${email}.`)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  const cookies = await page.context().cookies(databaseServer.origin);
  expect(cookies.filter((cookie) => cookie.name.startsWith('__Host-arca'))).not.toEqual([]);
  for (const cookie of cookies) {
    expect(cookie, cookie.name).toMatchObject({ httpOnly: true, secure: true, path: '/' });
  }
}

test('signs in with the button and shows the account on the home page', async ({ page }) => {
  const problems = watchProblems(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await withoutAutofill(page);

  await page.goto(`${databaseServer.origin}/`);
  await page.getByRole('link', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Entrar' })).toBeVisible();
  await expect(page.getByLabel('Conta')).toHaveCount(0);
  const box = await signInButton(page).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);

  const verify = page.waitForRequest((request) =>
    request.url().endsWith('/v1/auth/passkey/verify-authentication'),
  );
  await signInButton(page).click();
  await expectSignedInAs(page, email);
  // The authenticator supports PRF, yet no PRF output leaves the device (spec 0003, R3).
  const sent = (await verify).postDataJSON() as { response: Record<string, unknown> };
  expect(sent.response['clientExtensionResults']).toEqual({});
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(problems).toEqual([]);
});

/** The autofill tests need a browser that offers passkeys in autofill; CI's Chromium does. */
async function requireAutofill(page: Page) {
  await page.goto(`${databaseServer.origin}/`);
  const conditional = await page.evaluate(() =>
    PublicKeyCredential.isConditionalMediationAvailable(),
  );
  if (process.env['CI'] !== undefined) expect(conditional, 'autofill in CI Chromium').toBe(true);
  test.skip(!conditional, 'this browser offers no passkeys in autofill');
}

test('signs in from the passkey suggestions of the account field', async ({ page }) => {
  const problems = watchProblems(page);
  await requireAutofill(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await page.goto(`${databaseServer.origin}/sign-in`);
  await expectSignedInAs(page, email);
  expect(problems).toEqual([]);
});

test('offers the account field again after a refused pick', async ({ page }) => {
  await requireAutofill(page);
  const credential = newCredential();
  const { userId, email } = await seedAccount(credential);
  const authenticator = await virtualAuthenticator(page, newCredential(), { userId: randomUUID() });
  await page.goto(`${databaseServer.origin}/sign-in`);
  await expect(page.getByRole('status')).toHaveText(
    'Essa chave de acesso não está ligada a nenhuma conta do Arca. Tente com outra.',
  );
  await authenticator.hold(credential, userId);
  await expectSignedInAs(page, email);
});

test('refuses options that ask to evaluate PRF, before any assertion is sent', async ({ page }) => {
  const credential = newCredential();
  const { userId } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId });
  await withoutAutofill(page);
  await page.route('**/v1/auth/passkey/generate-authenticate-options', async (route) => {
    const response = await route.fetch();
    const options = (await response.json()) as Record<string, unknown>;
    const first = randomBytes(32).toString('base64url');
    await route.fulfill({
      response,
      json: { ...options, extensions: { prf: { eval: { first } } } },
    });
  });
  const verified: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/verify-authentication')) verified.push(request.url());
  });

  await page.goto(`${databaseServer.origin}/sign-in`);
  await signInButton(page).click();
  await expect(page.getByRole('status')).toHaveText('Não deu certo desta vez. Tente de novo.');
  expect(verified).toEqual([]);
});

test('says so when the passkey opens no account', async ({ page }) => {
  const credential = newCredential();
  await virtualAuthenticator(page, credential, { userId: randomUUID() });
  await withoutAutofill(page);

  await page.goto(`${databaseServer.origin}/sign-in`);
  await signInButton(page).click();
  await expect(page.getByRole('status')).toHaveText(
    'Essa chave de acesso não está ligada a nenhuma conta do Arca. Tente com outra.',
  );
  await expect(signInButton(page)).toBeEnabled();
});

test('treats a ceremony without user verification as cancelled', async ({ page }) => {
  const credential = newCredential();
  const { userId } = await seedAccount(credential);
  await virtualAuthenticator(page, credential, { userId, userVerified: false });
  await withoutAutofill(page);

  await page.goto(`${databaseServer.origin}/sign-in`);
  await signInButton(page).click();
  await expect(page.getByRole('status')).toHaveText(
    'Não deu para confirmar com a chave de acesso. Tente de novo quando quiser.',
  );
});
