import { z } from 'zod';
import type { RouteDefinition } from './index.js';

/*
 * Configurações › IA (ADR-0031): an admin sees which provider keys are set and chooses each
 * stage's model and effort; only an owner-list admin sets or removes a key, with an `ai_key`
 * step-up. A key is never sent back: only whether it is set and its last four characters.
 */

export const aiProviders = ['anthropic', 'typesafe'] as const;
export const AiProvider = z.enum(aiProviders);
export type AiProvider = z.infer<typeof AiProvider>;

export const aiStages = ['research', 'validation', 'correction'] as const;
export const AiStage = z.enum(aiStages);
export type AiStage = z.infer<typeof AiStage>;

export const aiEfforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const AiEffort = z.enum(aiEfforts);
export type AiEffort = z.infer<typeof AiEffort>;

/** What a stage may run on and what it runs on by default (ADR-0031). */
export interface AiStageOptions {
  readonly provider: AiProvider;
  /**
   * A model joins its list only after the update request's evaluation cases pass on it (#465), or
   * when the owner lists it himself, as he did Fable 5.2 on 2026-11-19 (ADR-0031).
   */
  readonly models: readonly [string, ...string[]];
  /** Empty for a provider that takes no effort. */
  readonly efforts: readonly AiEffort[];
  readonly defaultModel: string;
  readonly defaultEffort: AiEffort | null;
}

const claudeStage = {
  provider: 'anthropic',
  models: ['claude-opus-5-5', 'claude-fable-5-2'],
  efforts: aiEfforts,
  defaultModel: 'claude-opus-5-5',
  defaultEffort: 'high',
} as const satisfies AiStageOptions;

/**
 * The reviewed list settings offer: research and correction on Claude at high effort, validation
 * on TypeSafe's Jev, a different model by construction (spec #455, amendment of 2026-11-16).
 */
export const aiStageOptions = {
  research: claudeStage,
  validation: {
    provider: 'typesafe',
    models: ['jev-1.14.0'],
    efforts: [],
    defaultModel: 'jev-1.14.0',
    defaultEffort: null,
  },
  correction: claudeStage,
} as const satisfies Record<AiStage, AiStageOptions>;

/** Whether the reviewed list offers this model and effort for the stage. */
export function offersAiStage(stage: AiStage, model: string, effort: AiEffort | null): boolean {
  const { models, efforts }: AiStageOptions = aiStageOptions[stage];
  return (
    models.includes(model) && (effort === null ? efforts.length === 0 : efforts.includes(effort))
  );
}

/** Anthropic's key format, which the deployment's variable must match too. */
export const anthropicKeyPattern = /^sk-ant-[A-Za-z0-9_-]{1,200}$/;
/** TypeSafe documents no key format, so any plausible bearer token. */
const typesafeKeyPattern = /^[A-Za-z0-9_.-]{16,256}$/;

export const aiKeyPatterns = {
  anthropic: anthropicKeyPattern,
  typesafe: typesafeKeyPattern,
} as const satisfies Record<AiProvider, RegExp>;

export const AiKeyState = z.object({
  provider: AiProvider,
  /**
   * `set`: a key is stored; `environment`: none is stored and the deployment's variable stands in;
   * `none`: neither; `unreadable`: a stored key no longer decrypts, so calls fail until it is set
   * again.
   */
  state: z.enum(['set', 'environment', 'none', 'unreadable']),
  /** The stored key's row, which removing it names. */
  keyId: z.uuid().nullable(),
  lastFour: z.string().length(4).nullable(),
  setAt: z.iso.datetime({ offset: true }).nullable(),
});
export type AiKeyState = z.infer<typeof AiKeyState>;

export const AiStageState = z.object({
  stage: AiStage,
  model: z.string(),
  effort: AiEffort.nullable(),
  /** Whether it is the reviewed default rather than an admin's choice. */
  isDefault: z.boolean(),
});
export type AiStageState = z.infer<typeof AiStageState>;

export const AiSettings = z.object({
  /** Whether the viewer may set or remove keys: an owner-list admin. */
  canManageKeys: z.boolean(),
  /** Whether this deployment stores no keys at all: its key-encryption key is missing. */
  keysOff: z.boolean(),
  keys: z.array(AiKeyState),
  stages: z.array(AiStageState),
});
export type AiSettings = z.infer<typeof AiSettings>;

export const getAiSettings = {
  method: 'get',
  path: '/settings/ai',
  operationId: 'getAiSettings',
  summary:
    "Each provider key's state and last four characters, never the key, and each stage's model and effort, for an admin. 403 not_admin",
  response: { description: 'The settings', schema: AiSettings },
} as const satisfies RouteDefinition<typeof AiSettings>;

export const SetAiKey = z
  .strictObject({ provider: AiProvider, key: z.string().max(256) })
  .refine(({ provider, key }) => aiKeyPatterns[provider].test(key), { path: ['key'] });
export type SetAiKey = z.infer<typeof SetAiKey>;

export const setAiKey = {
  method: 'post',
  path: '/settings/ai/key',
  operationId: 'setAiKey',
  summary:
    "Stores a provider's API key, encrypted, replacing the stored one, for an owner-list admin; needs a consumed ai_key step-up of setAiKey bound to the provider and the key's SHA-256; answered with Cache-Control no-store. 403 not_admin, owner_list_only or step_up_required",
  body: SetAiKey,
  response: { description: 'Stored', schema: z.object({}) },
} as const satisfies RouteDefinition;

/** The step-up action of setting a key: the provider and the hex SHA-256 of the key. */
export const setAiKeyAction = (provider: AiProvider, keySha256: string) => ({
  action: setAiKey.operationId,
  targets: [],
  fields: { provider, keySha256 },
});

export const RemoveAiKey = z.strictObject({ provider: AiProvider, keyId: z.uuid() });
export type RemoveAiKey = z.infer<typeof RemoveAiKey>;

export const removeAiKey = {
  method: 'post',
  path: '/settings/ai/key/remove',
  operationId: 'removeAiKey',
  summary:
    "Removes a provider's stored key it names, for an owner-list admin; needs a consumed ai_key step-up of removeAiKey bound to the key's row. 403 not_admin, owner_list_only or step_up_required; 404 not_found unless the key is the stored one",
  body: RemoveAiKey,
  response: { description: 'Removed', schema: z.object({}) },
} as const satisfies RouteDefinition;

export const removeAiKeyAction = (provider: AiProvider, keyId: string) => ({
  action: removeAiKey.operationId,
  targets: [keyId],
  fields: { provider },
});

export const SetAiStage = z.strictObject({
  stage: AiStage,
  model: z.string().max(64),
  effort: AiEffort.nullable(),
});
export type SetAiStage = z.infer<typeof SetAiStage>;

export const setAiStage = {
  method: 'post',
  path: '/settings/ai/stage',
  operationId: 'setAiStage',
  summary:
    "Chooses a stage's model and effort from the reviewed list, for an admin. 400 not_offered; 403 not_admin",
  body: SetAiStage,
  response: { description: 'Chosen', schema: z.object({}) },
} as const satisfies RouteDefinition;

export const TestAiKey = z.strictObject({ provider: AiProvider });
export type TestAiKey = z.infer<typeof TestAiKey>;

/**
 * A fixed code, never the provider's words: `rejected` when the provider refused the key,
 * `unavailable` when it could not be reached or answered otherwise.
 */
export const AiKeyTestResult = z.object({
  result: z.enum(['ok', 'no_key', 'unreadable', 'rejected', 'unavailable']),
});
export type AiKeyTestResult = z.infer<typeof AiKeyTestResult>;

export const testAiKey = {
  method: 'post',
  path: '/settings/ai/test',
  operationId: 'testAiKey',
  summary:
    "Tries the provider's key with one call that spends no tokens (listing models), for an admin; rate limited per account. 403 not_admin; 429",
  body: TestAiKey,
  response: { description: 'The result', schema: AiKeyTestResult },
} as const satisfies RouteDefinition<typeof AiKeyTestResult>;

export const aiSettingsRoutes = {
  getAiSettings,
  setAiKey,
  removeAiKey,
  setAiStage,
  testAiKey,
} as const;
