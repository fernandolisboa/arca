import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  removeAiKeyAction,
  setAiKeyAction,
  stepUpNonceHeader,
  type AiProvider,
} from '@arca/api-contract/routes';
import { createLogger } from '@arca/telemetry';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { auditLog } from '../../src/audit/log.js';
import { credentialStore } from '../../src/auth/auth.js';
import { createStepUp } from '../../src/auth/step-up.js';
import { aiKeyCipher } from '../../src/ai/key-cipher.js';
import { createAiSettings } from '../../src/ai/settings.js';
import { adminRole } from '../../src/knowledge/admins.js';
import { noLimits } from '../limits.js';
import { authTestDatabase, silentLogger, type AuthTestDatabase } from './auth-database.js';
import { ceremony, origin, person, toRequest, type Person } from './step-up-people.js';

// Configurações › IA on the real migrations (ADR-0031). Synthetic accounts and keys only.
let testDatabase: AuthTestDatabase;
let stepUp: ReturnType<typeof createStepUp>;
let owner: Person;
let granted: Person;
let member: Person;
let notices: string[];
let logLines: string[];
let calls: { url: string; headers: Headers }[];

const kek = randomBytes(32);
const anthropicKey = `sk-ant-api03-${randomBytes(24).toString('base64url')}`;
const typesafeKey = `ts_${randomBytes(24).toString('base64url')}`;
const environmentKey = `sk-ant-api03-${randomBytes(24).toString('base64url')}`;

interface Options {
  readonly signedIn?: Person;
  readonly cipherKey?: Buffer | null;
  readonly answer?: number | 'throw';
}

function setup({ signedIn = owner, cipherKey = kek, answer = 200 }: Options = {}) {
  const settings = createAiSettings({
    db: () => testDatabase.apiDb,
    role: adminRole(() => testDatabase.apiDb, [owner.signedIn.accountId]),
    stepUp,
    audit: auditLog(testDatabase.auditDb),
    notify: (accountId, kind) => {
      notices.push(`${accountId}:${kind}`);
      return Promise.resolve();
    },
    environment: 'development',
    ...(cipherKey === null ? {} : { cipher: aiKeyCipher(cipherKey) }),
    environmentKeys: { anthropic: environmentKey },
    fetch: (input, init) => {
      calls.push({
        url: input instanceof Request ? input.url : input.toString(),
        headers: new Headers(init?.headers),
      });
      // A provider's error may echo what it was sent; none of it may travel on.
      if (answer === 'throw') return Promise.reject(new Error(`refused ${anthropicKey}`));
      return Promise.resolve(new Response(`echo ${anthropicKey}`, { status: answer }));
    },
  });
  const app = createApp({
    checkDatabase: () => Promise.resolve('ok'),
    logger: createLogger((line) => logLines.push(line)),
    origin,
    auth: {
      handle: () => Promise.resolve(Response.json({})),
      signedIn: () => Promise.resolve(signedIn.signedIn),
      refresh: () => Promise.resolve({ session: null, setCookies: [] }),
    },
    authLimits: noLimits,
    aiSettings: settings,
  });
  const post = (path: string, body: unknown, nonce?: Uint8Array) =>
    app.request(`/v1/settings/ai${path}`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        ...(nonce === undefined
          ? {}
          : { [stepUpNonceHeader]: Buffer.from(nonce).toString('base64url') }),
      },
      body: JSON.stringify(body),
    });
  return {
    settings,
    status: () => app.request('/v1/settings/ai'),
    setKey: (provider: AiProvider, key: string, nonce?: Uint8Array) =>
      post('/key', { provider, key }, nonce),
    removeKey: (provider: AiProvider, keyId: string, nonce?: Uint8Array) =>
      post('/key/remove', { provider, keyId }, nonce),
    setStage: (body: unknown) => post('/stage', body),
    test: (provider: AiProvider) => post('/test', { provider }),
  };
}

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

/** Verifies an `ai_key` step-up of `actor` for the action; answers its nonce. */
async function approve(
  actor: Person,
  action: { action: string; targets: string[]; fields: Record<string, string> },
) {
  const nonce = new Uint8Array(randomBytes(16));
  const { verified } = await ceremony(stepUp, actor, toRequest('ai_key', { ...action, nonce }));
  expect(verified).toBe(true);
  return nonce;
}

const approveSet = (actor: Person, provider: AiProvider, key: string) =>
  approve(actor, setAiKeyAction(provider, sha256Hex(key)));

async function storeKey(provider: AiProvider, key: string) {
  const response = await setup().setKey(provider, key, await approveSet(owner, provider, key));
  expect(response.status).toBe(200);
}

interface Status {
  canManageKeys: boolean;
  keysOff: boolean;
  keys: { provider: string; state: string; keyId: string | null; lastFour: string | null }[];
  stages: { stage: string; model: string; effort: string | null; isDefault: boolean }[];
}

async function status(options?: Options): Promise<Status> {
  const response = await setup(options).status();
  expect(response.status).toBe(200);
  return (await response.json()) as Status;
}

const keyOf = async (provider: AiProvider, options?: Options) =>
  (await status(options)).keys.find((key) => key.provider === provider);

const auditCodes = (code: string) =>
  testDatabase.asAdmin(
    async (client) =>
      (
        await client.query<{ details: unknown }>(
          'SELECT details FROM audit.event WHERE code = $1 ORDER BY time, id',
          [code],
        )
      ).rows,
  );

const asAppAuth = (accountId: string, statement: string, values: unknown[]) =>
  testDatabase.asAdmin(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE app_auth');
      await client.query(`SELECT set_config('app.account_id', $1, true)`, [accountId]);
      await client.query(statement, values);
    } finally {
      await client.query('ROLLBACK');
    }
  });

beforeAll(async () => {
  testDatabase = await authTestDatabase();
  const { authDb, auditDb } = testDatabase;
  stepUp = createStepUp({
    db: authDb,
    credentials: credentialStore(authDb),
    audit: auditLog(auditDb),
    origin,
    logger: silentLogger,
  });
  owner = await person(testDatabase);
  granted = await person(testDatabase);
  member = await person(testDatabase);
});

afterAll(async () => {
  await testDatabase.drop();
});

beforeEach(async () => {
  notices = [];
  logLines = [];
  calls = [];
  await testDatabase.asAdmin(async (client) => {
    await client.query(
      'TRUNCATE knowledge.ai_key, knowledge.ai_stage_setting, knowledge.admin_grant, audit.event CASCADE',
    );
    await client.query(
      `INSERT INTO knowledge.admin_grant (kind, grantee_account_id, actor_account_id, actor_basis, step_up_id)
       VALUES ('grant', $1, $2, 'owner_list', $3)`,
      [granted.signedIn.accountId, owner.signedIn.accountId, randomUUID()],
    );
  });
});

describe('AI provider keys (ADR-0031)', () => {
  it('stores a key encrypted with an ai_key step-up, audits it and tells the owners', async () => {
    const response = await setup().setKey(
      'anthropic',
      anthropicKey,
      await approveSet(owner, 'anthropic', anthropicKey),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const rows = await testDatabase.asAdmin(
      async (client) =>
        (
          await client.query<{ id: string; ciphertext: Buffer; last_four: string }>(
            `SELECT id, ciphertext, last_four FROM knowledge.ai_key`,
          )
        ).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ciphertext.toString('latin1')).not.toContain(anthropicKey.slice(7, 20));
    expect(rows[0]?.last_four).toBe(anthropicKey.slice(-4));
    expect(await auditCodes('ai_key_set')).toEqual([
      { details: { provider: 'anthropic', keyId: rows[0]?.id } },
    ]);
    expect(notices).toEqual([`${owner.signedIn.accountId}:ai_key_changed`]);
    expect(await keyOf('anthropic')).toEqual({
      provider: 'anthropic',
      state: 'set',
      keyId: rows[0]?.id,
      lastFour: anthropicKey.slice(-4),
      setAt: expect.any(String) as string,
    });
    expect(await setup().settings.key('anthropic')).toEqual({ state: 'set', key: anthropicKey });
  });

  it('binds the step-up to the provider and the key, and spends it once', async () => {
    const routes = setup();
    expect((await routes.setKey('anthropic', anthropicKey)).status).toBe(403);
    const forOther = await approveSet(owner, 'anthropic', `${anthropicKey}x`);
    expect((await routes.setKey('anthropic', anthropicKey, forOther)).status).toBe(403);
    const forTypesafe = await approve(owner, setAiKeyAction('typesafe', sha256Hex(anthropicKey)));
    expect((await routes.setKey('anthropic', anthropicKey, forTypesafe)).status).toBe(403);
    const nonce = await approveSet(owner, 'anthropic', anthropicKey);
    expect((await routes.setKey('anthropic', anthropicKey, nonce)).status).toBe(200);
    expect((await routes.setKey('anthropic', anthropicKey, nonce)).status).toBe(403);
  });

  it('lets only an owner-list admin manage keys, and any admin read the settings', async () => {
    const byGrant = await setup({ signedIn: granted }).setKey(
      'anthropic',
      anthropicKey,
      await approveSet(granted, 'anthropic', anthropicKey),
    );
    expect(await byGrant.json()).toEqual({ error: { code: 'owner_list_only' } });
    expect((await status({ signedIn: granted })).canManageKeys).toBe(false);
    expect((await setup({ signedIn: member }).status()).status).toBe(403);
    expect((await setup({ signedIn: member }).test('anthropic')).status).toBe(403);
  });

  it('refuses a key of the wrong format before anything else', async () => {
    const response = await setup().setKey('anthropic', 'not-a-key', new Uint8Array(16));
    expect(response.status).toBe(400);
  });

  it('refuses an app_auth insert without a spent ai_key step-up', async () => {
    await expect(
      asAppAuth(
        owner.signedIn.accountId,
        `INSERT INTO knowledge.ai_key (id, provider, kind, ciphertext, nonce, tag, kek_version,
                                       format_version, last_four, actor_account_id, step_up_id)
         VALUES (gen_random_uuid(), 'anthropic', 'set', $1, $2, $3, 1, 1, 'abcd', $4, gen_random_uuid())`,
        [randomBytes(40), randomBytes(12), randomBytes(16), owner.signedIn.accountId],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('removes the stored key with its own step-up, then falls back to the variable', async () => {
    await storeKey('anthropic', anthropicKey);
    const keyId = (await keyOf('anthropic'))?.keyId ?? '';
    const routes = setup();
    const wrongRow = await approve(owner, removeAiKeyAction('anthropic', randomUUID()));
    expect((await routes.removeKey('anthropic', keyId, wrongRow)).status).toBe(403);
    expect((await routes.removeKey('anthropic', randomUUID(), wrongRow)).status).toBe(404);
    const nonce = await approve(owner, removeAiKeyAction('anthropic', keyId));
    expect((await routes.removeKey('anthropic', keyId, nonce)).status).toBe(200);
    expect(await auditCodes('ai_key_removed')).toHaveLength(1);
    expect((await keyOf('anthropic'))?.state).toBe('environment');
    expect(await setup().settings.key('anthropic')).toEqual({
      state: 'environment',
      key: environmentKey,
    });
    expect(await setup().settings.key('typesafe')).toEqual({ state: 'none' });
  });

  it('keeps a newer key when an older one is removed, and ties a removal to its provider', async () => {
    await storeKey('anthropic', anthropicKey);
    const older = (await keyOf('anthropic'))?.keyId ?? '';
    const newer = `sk-ant-api03-${randomBytes(24).toString('base64url')}`;
    await storeKey('anthropic', newer);
    const newerId = (await keyOf('anthropic'))?.keyId ?? '';
    // A removal of the older key that lands after the newer one, as a race would leave it.
    await testDatabase.asAdmin((client) =>
      client.query(
        `INSERT INTO knowledge.ai_key (id, provider, kind, removes_key_id, actor_account_id, step_up_id)
         VALUES (gen_random_uuid(), 'anthropic', 'removed', $1, $2, gen_random_uuid())`,
        [older, owner.signedIn.accountId],
      ),
    );
    expect(await setup().settings.key('anthropic')).toEqual({ state: 'set', key: newer });
    await expect(
      testDatabase.asAdmin((client) =>
        client.query(
          `INSERT INTO knowledge.ai_key (id, provider, kind, removes_key_id, actor_account_id, step_up_id)
           VALUES (gen_random_uuid(), 'typesafe', 'removed', $1, $2, gen_random_uuid())`,
          [newerId, owner.signedIn.accountId],
        ),
      ),
    ).rejects.toThrow(/ai_key_removes_fkey/);
  });

  it('fails closed, with no fallback, once the key-encryption key changes', async () => {
    await storeKey('anthropic', anthropicKey);
    const rotated = { cipherKey: randomBytes(32) };
    expect((await keyOf('anthropic', rotated))?.state).toBe('unreadable');
    expect(await setup(rotated).settings.key('anthropic')).toEqual({ state: 'unreadable' });
    expect(await (await setup(rotated).test('anthropic')).json()).toEqual({
      result: 'unreadable',
    });
    expect(calls).toEqual([]);
  });

  it('stores nothing without a key-encryption key', async () => {
    const off = { cipherKey: null };
    expect(await status(off)).toMatchObject({ canManageKeys: false, keysOff: true });
    const response = await setup(off).setKey(
      'typesafe',
      typesafeKey,
      await approveSet(owner, 'typesafe', typesafeKey),
    );
    expect(await response.json()).toEqual({ error: { code: 'keys_off' } });
  });

  it('tests a key with a call that spends no tokens, answering a fixed code', async () => {
    await storeKey('typesafe', typesafeKey);
    expect(await (await setup().test('typesafe')).json()).toEqual({ result: 'ok' });
    expect(calls[0]?.url).toBe('https://api.typesafe.ai/v1/models');
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${typesafeKey}`);
    expect(await (await setup({ answer: 401 }).test('typesafe')).json()).toEqual({
      result: 'rejected',
    });
    expect(await (await setup({ answer: 529 }).test('anthropic')).json()).toEqual({
      result: 'unavailable',
    });
    const anthropicCall = calls.find((entry) => entry.url.startsWith('https://api.anthropic.com/'));
    expect(anthropicCall?.url).toBe('https://api.anthropic.com/v1/models?limit=1');
    expect(anthropicCall?.headers.get('x-api-key')).toBe(environmentKey);
    expect(await (await setup({ answer: 'throw' }).test('anthropic')).json()).toEqual({
      result: 'unavailable',
    });
  });

  it('never shows a key in a response, a log line or an error', async () => {
    await storeKey('anthropic', anthropicKey);
    await storeKey('typesafe', typesafeKey);
    const routes = setup({ answer: 'throw' });
    const bodies = await Promise.all(
      [
        routes.status(),
        routes.test('anthropic'),
        routes.setKey('anthropic', anthropicKey, new Uint8Array(randomBytes(16))),
        routes.setKey('anthropic', `${anthropicKey}!`),
        routes.removeKey('typesafe', randomUUID()),
      ].map(async (response) => (await response).text()),
    );
    const seen = [...bodies, ...logLines].join('\n');
    for (const secret of [anthropicKey, typesafeKey, environmentKey]) {
      expect(seen).not.toContain(secret);
      expect(seen).not.toContain(secret.slice(0, -4));
    }
    expect(logLines.length).toBeGreaterThan(0);
  });
});

describe('stage models (ADR-0031)', () => {
  it('starts from the reviewed defaults', async () => {
    expect((await status()).stages).toEqual([
      { stage: 'research', model: 'claude-opus-5-5', effort: 'high', isDefault: true },
      { stage: 'validation', model: 'jev-1.14.0', effort: null, isDefault: true },
      { stage: 'correction', model: 'claude-opus-5-5', effort: 'high', isDefault: true },
    ]);
  });

  it('stores an admin choice from the list, audited, and refuses anything else', async () => {
    const byGrant = setup({ signedIn: granted });
    const chosen = { stage: 'research', model: 'claude-opus-5-5', effort: 'max' };
    expect((await byGrant.setStage(chosen)).status).toBe(200);
    expect(await setup().settings.stage('research')).toEqual({
      stage: 'research',
      model: 'claude-opus-5-5',
      effort: 'max',
      isDefault: false,
    });
    expect(await auditCodes('ai_stage_set')).toHaveLength(1);
    const refused = [
      { stage: 'research', model: 'claude-sonnet-5-5', effort: 'high' },
      { stage: 'validation', model: 'jev-1.14.0', effort: 'high' },
      { stage: 'correction', model: 'claude-opus-5-5', effort: null },
    ];
    for (const body of refused) {
      expect(await (await byGrant.setStage(body)).json()).toEqual({
        error: { code: 'not_offered' },
      });
    }
    expect((await setup({ signedIn: member }).setStage(chosen)).status).toBe(403);
  });

  it('writes stage rows only through the definer function', async () => {
    await expect(
      testDatabase.asAdmin(async (client) => {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL ROLE app_api');
          await client.query(
            `INSERT INTO knowledge.ai_stage_setting (stage, model) VALUES ('research', 'x')`,
          );
        } finally {
          await client.query('ROLLBACK');
        }
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
