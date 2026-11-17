import {
  aiKeyPatterns,
  aiStageOptions,
  removeAiKeyAction,
  routes,
  setAiKeyAction,
  type AiEffort,
  type AiKeyState,
  type AiKeyTestResult,
  type AiProvider,
  type AiStage,
} from '@arca/api-contract/client';
import { Button, StatusChip, cardClass, type StatusTone } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { aiSettingsQuery, api } from '../api.js';
import { SelectField } from '../forms/select-field.js';
import { TextField } from '../forms/text-field.js';
import { passkeys } from '../platform.js';
import { commonFailure, reach } from '../requests.js';
import { stepUpFor } from '../step-up.js';

const keyTones = {
  set: 'ok',
  environment: 'ok',
  none: 'unknown',
  unreadable: 'danger',
} as const satisfies Record<AiKeyState['state'], StatusTone>;

/** A key field no browser, extension or password manager offers to complete or keep. */
const keptOutOfPasswordManagers = {
  autoComplete: 'off',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const;

type KeyNotice = 'saved' | 'removed' | 'invalid' | 'failure' | 'tooMany' | 'keysOff';
type TestNotice = AiKeyTestResult['result'] | 'failure' | 'tooMany';

const sha256Hex = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');

/** One provider's key: its state, a field to set it, and a test that spends no tokens. */
function KeyCard({
  keyState: state,
  canManage,
}: {
  readonly keyState: AiKeyState;
  readonly canManage: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { provider } = state;
  // The key lives in this field's state only and is cleared once sent, whatever the outcome.
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<KeyNotice>();
  const [tested, setTested] = useState<TestNotice>();

  const change = (work: () => Promise<void>, done: KeyNotice) => {
    setNotice(undefined);
    setTested(undefined);
    setWorking(true);
    work()
      .then(() => {
        setNotice(done);
      })
      .catch((error: unknown) => {
        const failure = commonFailure(error, (api) =>
          api.code === 'keys_off' ? 'keysOff' : undefined,
        );
        if (failure === 'cancelled') return;
        setNotice(failure === 'limited' ? 'tooMany' : failure === 'keysOff' ? failure : 'failure');
      })
      .finally(() => {
        setWorking(false);
        void queryClient.invalidateQueries(aiSettingsQuery);
      });
  };

  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = draft.trim();
    setDraft('');
    if (!aiKeyPatterns[provider].test(key)) {
      setNotice('invalid');
      return;
    }
    change(async () => {
      const approved = await stepUpFor(
        passkeys,
        setAiKeyAction(provider, await sha256Hex(key)),
        'ai_key',
      );
      await reach(approved.call(routes.setAiKey, { provider, key }));
    }, 'saved');
  };

  const remove = (keyId: string) => {
    change(async () => {
      const approved = await stepUpFor(passkeys, removeAiKeyAction(provider, keyId), 'ai_key');
      await reach(approved.call(routes.removeAiKey, { provider, keyId }));
    }, 'removed');
  };

  const test = () => {
    setTested(undefined);
    setWorking(true);
    reach(api.call(routes.testAiKey, { provider }))
      .then(({ result }) => {
        setTested(result);
      })
      .catch((error: unknown) => {
        setTested(commonFailure(error) === 'limited' ? 'tooMany' : 'failure');
      })
      .finally(() => {
        setWorking(false);
      });
  };

  const since =
    state.setAt === null
      ? ''
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(new Date(state.setAt));
  const title = t(`settings.ai.providers.${provider}.name`);
  return (
    <section aria-label={title} className={`${cardClass} flex flex-col gap-3 p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">{title}</h4>
        <StatusChip tone={keyTones[state.state]} label={t(`settings.ai.keyState.${state.state}`)} />
      </div>
      <p className="text-small text-muted">{t(`settings.ai.providers.${provider}.use`)}</p>
      {state.state === 'set' && state.lastFour !== null && (
        <p>{t('settings.ai.lastFour', { lastFour: state.lastFour, since })}</p>
      )}
      {state.state === 'unreadable' && <p>{t('settings.ai.unreadable')}</p>}
      {canManage && (
        <form className="flex flex-col gap-3" onSubmit={save}>
          <TextField
            label={t(state.keyId === null ? 'settings.ai.keyLabel' : 'settings.ai.replaceLabel')}
            hint={t(`settings.ai.providers.${provider}.hint`)}
            type="text"
            masked
            {...keptOutOfPasswordManagers}
            value={draft}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
          />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={working || draft.trim() === ''}>
              {t('settings.ai.save')}
            </Button>
            {state.keyId !== null && (
              <Button
                variant="secondary"
                disabled={working}
                onClick={() => {
                  if (state.keyId !== null) remove(state.keyId);
                }}
              >
                {t('settings.ai.remove')}
              </Button>
            )}
          </div>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={working || state.state === 'none'} onClick={test}>
          {t('settings.ai.test')}
        </Button>
        <p role="status" className="text-small">
          {tested === undefined ? '' : t(`settings.ai.tested.${tested}`)}
        </p>
      </div>
      <p role="status" className="text-small">
        {notice === undefined ? '' : t(`settings.ai.notices.${notice}`)}
      </p>
    </section>
  );
}

/** One stage's model and effort, from the reviewed list only. */
function StageRow({
  stage,
  model,
  effort,
  isDefault,
}: {
  readonly stage: AiStage;
  readonly model: string;
  readonly effort: AiEffort | null;
  readonly isDefault: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const options = aiStageOptions[stage];
  const [chosenModel, setChosenModel] = useState(model);
  const [chosenEffort, setChosenEffort] = useState<AiEffort | null>(effort);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'failure' | 'tooMany'>();
  const unchanged = chosenModel === model && chosenEffort === effort;

  const save = () => {
    setNotice(undefined);
    setWorking(true);
    reach(api.call(routes.setAiStage, { stage, model: chosenModel, effort: chosenEffort }))
      .then(() => {
        setNotice('saved');
      })
      .catch((error: unknown) => {
        setNotice(commonFailure(error) === 'limited' ? 'tooMany' : 'failure');
      })
      .finally(() => {
        setWorking(false);
        void queryClient.invalidateQueries(aiSettingsQuery);
      });
  };

  const title = t(`settings.ai.stages.${stage}.name`);
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">{title}</h4>
        {isDefault && <StatusChip tone="unknown" label={t('settings.ai.default')} />}
      </div>
      <p className="text-small text-muted">{t(`settings.ai.stages.${stage}.lead`)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t('settings.ai.model')}
          value={chosenModel}
          onChange={setChosenModel}
          options={options.models.map((value) => ({ value, label: value }))}
        />
        {options.efforts.length > 0 && (
          <SelectField
            label={t('settings.ai.effort')}
            value={chosenEffort ?? ''}
            onChange={(value) => {
              setChosenEffort(options.efforts.find((candidate) => candidate === value) ?? null);
            }}
            options={options.efforts.map((value) => ({
              value,
              label: t(`settings.ai.efforts.${value}`),
            }))}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={working || unchanged} onClick={save}>
          {t('settings.ai.save')}
        </Button>
        <p role="status" className="text-small">
          {notice === undefined ? '' : t(`settings.ai.stageNotices.${notice}`)}
        </p>
      </div>
    </section>
  );
}

/** Configurações › IA (ADR-0031): provider keys on one side, each stage's model on the other. */
export function AiPanel() {
  const { t } = useTranslation();
  const settings = useQuery(aiSettingsQuery);
  if (settings.isError) return <p className="text-muted">{t('settings.ai.loadFailure')}</p>;
  if (settings.data === undefined) return null;
  const { canManageKeys, keysOff, keys, stages } = settings.data;
  const providers: readonly AiProvider[] = keys.map((key) => key.provider);
  return (
    <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      <section aria-labelledby="ai-keys-title" className="flex flex-col gap-4">
        <h3 id="ai-keys-title" className="font-medium">
          {t('settings.ai.keysTitle')}
        </h3>
        {!canManageKeys && (
          <p className="text-small text-muted">
            {t(keysOff ? 'settings.ai.notices.keysOff' : 'settings.ai.ownerOnly')}
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
          {providers.map((provider) => {
            const state = keys.find((key) => key.provider === provider);
            return state === undefined ? null : (
              <KeyCard key={provider} keyState={state} canManage={canManageKeys} />
            );
          })}
        </div>
      </section>
      <section aria-labelledby="ai-stages-title" className={`${cardClass} flex flex-col gap-4 p-4`}>
        <h3 id="ai-stages-title" className="font-medium">
          {t('settings.ai.stagesTitle')}
        </h3>
        {stages.map((stage) => (
          <StageRow
            key={`${stage.stage}:${stage.model}:${stage.effort ?? ''}`}
            stage={stage.stage}
            model={stage.model}
            effort={stage.effort}
            isDefault={stage.isDefault}
          />
        ))}
      </section>
    </div>
  );
}
