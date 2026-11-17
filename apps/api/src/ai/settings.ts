import { createHash, randomUUID } from 'node:crypto';
import {
  type AiEffort,
  type AiKeyState,
  type AiKeyTestResult,
  type AiProvider,
  type AiSettings,
  type AiStage,
  aiProviders,
  aiStageOptions,
  offersAiStage,
  aiStages,
  setAiKeyAction,
  removeAiKeyAction,
} from '@arca/api-contract/routes';
import { actAs, type Database, withIdentity } from '@arca/db';
import { sql } from 'drizzle-orm';
import type { AccountNotice } from '../auth/account-notices.js';
import type { SignedIn } from '../auth/service.js';
import type { StepUpSpender } from '../auth/step-up.js';
import type { AuditLog } from '../audit/log.js';
import type { DeploymentEnvironment } from '../config.js';
import { type AdminRole, readAdminHistory } from '../knowledge/admins.js';
import type { AiKeyCipher } from './key-cipher.js';
import { anthropicKeyProbe } from './claude.js';
import { typesafeKeyProbe } from './typesafe.js';

/** A provider's key as a call sees it; `unreadable` fails closed, with no fallback. */
export type ResolvedAiKey =
  | { readonly state: 'set'; readonly key: string }
  | { readonly state: 'environment'; readonly key: string }
  | { readonly state: 'none' }
  | { readonly state: 'unreadable' };

/** A stage's model and effort, the admin's choice or the reviewed default. */
export interface StageChoice {
  readonly model: string;
  readonly effort: AiEffort | null;
  readonly isDefault: boolean;
}

type KeyRefusal = 'not_admin' | 'owner_list_only' | 'step_up_required' | 'keys_off';

export interface AiSettingsService extends AiSettingsReader {
  readonly status: (accountId: string) => Promise<AiSettings | 'not_admin'>;
  /** Stores the key in the transaction that spends the session's `ai_key` step-up. */
  readonly setKey: (
    signedIn: SignedIn,
    provider: AiProvider,
    key: string,
    nonce: Uint8Array,
  ) => Promise<'stored' | KeyRefusal>;
  readonly removeKey: (
    signedIn: SignedIn,
    provider: AiProvider,
    keyId: string,
    nonce: Uint8Array,
  ) => Promise<'removed' | 'not_found' | KeyRefusal>;
  readonly setStage: (
    accountId: string,
    stage: AiStage,
    model: string,
    effort: AiEffort | null,
  ) => Promise<'stored' | 'not_admin' | 'not_offered'>;
  readonly test: (
    accountId: string,
    provider: AiProvider,
  ) => Promise<AiKeyTestResult['result'] | 'not_admin'>;
}

export interface AiSettingsDependencies {
  /** The app_api pool. */
  readonly db: () => Database;
  readonly role: AdminRole;
  readonly stepUp: StepUpSpender;
  readonly audit: Pick<AuditLog, 'record'>;
  readonly notify: AccountNotice<'ai_key_changed'>;
  readonly environment: DeploymentEnvironment;
  /** Absent without a key-encryption key: nothing is stored, and stored keys are unreadable. */
  readonly cipher?: AiKeyCipher;
  /** The variables that stand in while no key is stored. */
  readonly environmentKeys: Partial<Record<AiProvider, string>>;
  /** For tests: the HTTP client the key test calls. */
  readonly fetch?: typeof globalThis.fetch;
}

interface KeyRow extends Record<string, unknown> {
  id: string;
  kind: 'set' | 'removed';
  ciphertext: Buffer | null;
  nonce: Buffer | null;
  tag: Buffer | null;
  kek_version: number | null;
  format_version: number | null;
  last_four: string | null;
  at: string | Date;
}

interface StageRow extends Record<string, unknown> {
  stage: AiStage;
  model: string;
  effort: AiEffort | null;
}

const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

const testTimeoutMs = 10_000;

/** One call per provider that spends no tokens: listing the models the key may use. */
const keyProbes: Record<AiProvider, (key: string) => [string, RequestInit]> = {
  anthropic: anthropicKeyProbe,
  typesafe: typesafeKeyProbe,
};

/** What a model call reads from Settings › IA: its provider's key and its stage's choice. */
export interface AiSettingsReader {
  /** The key a model call uses, read on every call so a change takes effect at once. */
  readonly key: (provider: AiProvider) => Promise<ResolvedAiKey>;
  readonly stage: (stage: AiStage) => Promise<StageChoice>;
}

export type AiSettingsReaderDependencies = Pick<
  AiSettingsDependencies,
  'db' | 'environment' | 'cipher' | 'environmentKeys'
>;

function settingsReads({ db, environment, cipher, environmentKeys }: AiSettingsReaderDependencies) {
  /**
   * The provider's stored key: its newest `set` row no removal names, so removing an older key
   * never ends a newer one stored meanwhile.
   */
  const storedKey = async (provider: AiProvider): Promise<KeyRow | undefined> => {
    const { rows } = await db().execute<KeyRow>(sql`
      SELECT k.id, k.kind, k.ciphertext, k.nonce, k.tag, k.kek_version, k.format_version,
             k.last_four, k.at
        FROM knowledge.ai_key k
       WHERE k.provider = ${provider} AND k.kind = 'set'
         AND NOT EXISTS (SELECT FROM knowledge.ai_key r WHERE r.removes_key_id = k.id)
       ORDER BY k.at DESC, k.id DESC LIMIT 1`);
    return rows[0];
  };

  const opened = (provider: AiProvider, row: KeyRow): string | undefined => {
    const { ciphertext, nonce, tag, kek_version: kekVersion, format_version: formatVersion } = row;
    if (
      cipher === undefined ||
      ciphertext === null ||
      nonce === null ||
      tag === null ||
      kekVersion === null ||
      formatVersion === null
    ) {
      return undefined;
    }
    return cipher.open(
      { ciphertext, nonce, tag, kekVersion, formatVersion },
      { environment, keyId: row.id, provider },
    );
  };

  const resolve = (provider: AiProvider, row: KeyRow | undefined): ResolvedAiKey => {
    if (row !== undefined) {
      const key = opened(provider, row);
      return key === undefined ? { state: 'unreadable' } : { state: 'set', key };
    }
    const fallback = environmentKeys[provider];
    return fallback === undefined ? { state: 'none' } : { state: 'environment', key: fallback };
  };

  const keyState = async (provider: AiProvider): Promise<AiKeyState> => {
    const stored = await storedKey(provider);
    return {
      provider,
      state: resolve(provider, stored).state,
      keyId: stored?.id ?? null,
      lastFour: stored?.last_four ?? null,
      setAt: stored === undefined ? null : new Date(stored.at).toISOString(),
    };
  };

  const stageChoices = async (): Promise<(StageChoice & { readonly stage: AiStage })[]> => {
    const { rows } = await db().execute<StageRow>(sql`
      SELECT DISTINCT ON (stage) stage, model, effort
        FROM knowledge.ai_stage_setting ORDER BY stage, at DESC, id DESC`);
    const chosen = new Map(rows.map((row) => [row.stage, row]));
    return aiStages.map((stage) => {
      const row = chosen.get(stage);
      // A choice the reviewed list no longer offers falls back to the default.
      return row !== undefined && offersAiStage(stage, row.model, row.effort)
        ? { stage, model: row.model, effort: row.effort, isDefault: false }
        : { stage, ...aiStageDefault(stage) };
    });
  };

  return { storedKey, resolve, keyState, stageChoices };
}

/** The reads alone, for a pool that reads the settings but changes none (app_jobs). */
export function aiSettingsReader(dependencies: AiSettingsReaderDependencies): AiSettingsReader {
  const { storedKey, resolve, stageChoices } = settingsReads(dependencies);
  return {
    key: async (provider) => resolve(provider, await storedKey(provider)),
    stage: async (stage) => {
      const choice = (await stageChoices()).find((entry) => entry.stage === stage);
      return choice ?? aiStageDefault(stage);
    },
  };
}

/** Settings › IA (ADR-0031): provider keys, encrypted, and each stage's model and effort. */
export function createAiSettings(dependencies: AiSettingsDependencies): AiSettingsService {
  const {
    db,
    role,
    stepUp,
    audit,
    notify,
    environment,
    cipher,
    fetch = globalThis.fetch,
  } = dependencies;
  const { storedKey, resolve, keyState, stageChoices } = settingsReads(dependencies);
  const reader = aiSettingsReader(dependencies);

  const isAdmin = async (accountId: string) =>
    role.basisOf(await readAdminHistory(db()), accountId) !== undefined;

  /** Only an owner-list admin manages keys, which the API checks since the list lives in code. */
  const keyRefusal = async (accountId: string): Promise<KeyRefusal | AiKeyCipher> => {
    if (!(await isAdmin(accountId))) return 'not_admin';
    if (!role.isOwner(accountId)) return 'owner_list_only';
    return cipher ?? 'keys_off';
  };

  const tellOwners = () =>
    Promise.all(role.ownerList.map((ownerId) => notify(ownerId, 'ai_key_changed')));

  return {
    status: async (accountId) => {
      if (!(await isAdmin(accountId))) return 'not_admin';
      const [keys, stages, refusal] = await Promise.all([
        Promise.all(aiProviders.map(keyState)),
        stageChoices(),
        keyRefusal(accountId),
      ]);
      return {
        canManageKeys: typeof refusal !== 'string',
        keysOff: cipher === undefined,
        keys,
        stages,
      };
    },

    setKey: async (signedIn, provider, key, nonce) => {
      const { accountId } = signedIn;
      const sealer = await keyRefusal(accountId);
      if (typeof sealer === 'string') return sealer;
      const keyId = randomUUID();
      const sealed = sealer.seal(key, { environment, keyId, provider });
      const spent = await stepUp.spend(
        signedIn,
        'ai_key',
        { ...setAiKeyAction(provider, sha256Hex(key)), nonce },
        async (tx, { id: stepUpId }) => {
          await actAs(tx, accountId);
          // Recorded first, so a key no event records is never stored.
          await audit.record({
            code: 'ai_key_set',
            subjectAccountId: accountId,
            actorAccountId: accountId,
            details: { provider, keyId },
          });
          await tx.execute(sql`
            INSERT INTO knowledge.ai_key (id, provider, kind, ciphertext, nonce, tag, kek_version,
                                          format_version, last_four, actor_account_id, step_up_id)
            VALUES (${keyId}, ${provider}, 'set', ${sealed.ciphertext}, ${sealed.nonce},
                    ${sealed.tag}, ${sealed.kekVersion}, ${sealed.formatVersion},
                    ${key.slice(-4)}, ${accountId}, ${stepUpId})`);
        },
      );
      if (!spent) return 'step_up_required';
      await tellOwners();
      return 'stored';
    },

    removeKey: async (signedIn, provider, keyId, nonce) => {
      const { accountId } = signedIn;
      const refused = await keyRefusal(accountId);
      if (typeof refused === 'string') return refused;
      if ((await storedKey(provider))?.id !== keyId) return 'not_found';
      const removalId = randomUUID();
      const spent = await stepUp.spend(
        signedIn,
        'ai_key',
        { ...removeAiKeyAction(provider, keyId), nonce },
        async (tx, { id: stepUpId }) => {
          await actAs(tx, accountId);
          await audit.record({
            code: 'ai_key_removed',
            subjectAccountId: accountId,
            actorAccountId: accountId,
            details: { provider, keyId },
          });
          await tx.execute(sql`
            INSERT INTO knowledge.ai_key (id, provider, kind, removes_key_id, actor_account_id,
                                          step_up_id)
            VALUES (${removalId}, ${provider}, 'removed', ${keyId}, ${accountId}, ${stepUpId})`);
        },
      );
      if (!spent) return 'step_up_required';
      await tellOwners();
      return 'removed';
    },

    setStage: async (accountId, stage, model, effort) => {
      if (!offersAiStage(stage, model, effort)) return 'not_offered';
      return withIdentity(db(), { accountId }, async (tx) => {
        const held = await role.held(tx, accountId);
        if (held === undefined) return 'not_admin';
        const { basis, grantId } = held.basis;
        const { rows } = await tx.execute<{ id: string }>(sql`
          SELECT knowledge.set_ai_stage(${stage}, ${model}, ${effort}, ${basis},
                                        ${grantId}::uuid) AS id`);
        const [stored] = rows;
        if (stored === undefined) return 'not_admin';
        await audit.record({
          code: 'ai_stage_set',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { stage, settingId: stored.id },
        });
        return 'stored';
      });
    },

    test: async (accountId, provider) => {
      if (!(await isAdmin(accountId))) return 'not_admin';
      const resolved = resolve(provider, await storedKey(provider));
      if (resolved.state === 'none') return 'no_key';
      if (resolved.state === 'unreadable') return resolved.state;
      const [url, init] = keyProbes[provider](resolved.key);
      try {
        const response = await fetch(url, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(testTimeoutMs),
        });
        // Only the status is read: the provider's words never travel on.
        await response.body?.cancel();
        if (response.ok) return 'ok';
        return response.status === 401 || response.status === 403 ? 'rejected' : 'unavailable';
      } catch {
        return 'unavailable';
      }
    },

    ...reader,
  };
}

function aiStageDefault(stage: AiStage): StageChoice {
  const { defaultModel, defaultEffort } = aiStageOptions[stage];
  return { model: defaultModel, effort: defaultEffort, isDefault: true };
}
