import {
  aiKeyPatterns,
  aiStageOptions,
  removeAiKeyAction,
  routes,
  setAiKeyAction,
  type AiKeyState,
  type AiKeyTestResult,
  type AiProvider,
  type AiStage,
  type AiStageState,
} from '@arca/api-contract/client';
import { Button, StatusChip, cardClass, type StatusTone } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { aiSettingsQuery, api } from '../api.js';
import { SelectField } from '../forms/select-field.js';
import { TextField } from '../forms/text-field.js';
import { passkeys } from '../platform.js';
import { commonFailure, reach } from '../requests.js';
import { stepUpFor } from '../step-up.js';
import { stageChanges, type StageChoice } from './stage-changes.js';

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

type KeyNotice =
  | {
      readonly kind: 'notices';
      readonly code: 'saved' | 'removed' | 'invalid' | 'failure' | 'tooMany' | 'keysOff';
    }
  | { readonly kind: 'tested'; readonly code: AiKeyTestResult['result'] | 'failure' | 'tooMany' };

const sha256Hex = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');

/** A titled group of the panel: its heading above, its content below. */
function Group({
  id,
  title,
  lead,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly lead?: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id={id} className="font-medium">
          {title}
        </h3>
        {lead !== undefined && <p className="text-small text-muted">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * The field that takes a key. The key lives in this form's state only: it is cleared once sent,
 * whatever the outcome, and is gone when the form closes.
 */
function KeyForm({
  provider,
  working,
  onSave,
  onCancel,
}: {
  readonly provider: AiProvider;
  readonly working: boolean;
  readonly onSave: (key: string) => void;
  readonly onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        const key = draft.trim();
        setDraft('');
        onSave(key);
      }}
    >
      <TextField
        label={t('settings.ai.keyLabel')}
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
        {onCancel !== undefined && (
          <Button variant="secondary" disabled={working} onClick={onCancel}>
            {t('settings.ai.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

/** One provider's key: its state, a test that spends no tokens, and a field to set it on demand. */
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
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<KeyNotice>();

  const change = (work: () => Promise<void>, done: 'saved' | 'removed') => {
    setNotice(undefined);
    setWorking(true);
    work()
      .then(() => {
        setEditing(false);
        setNotice({ kind: 'notices', code: done });
      })
      .catch((error: unknown) => {
        const failure = commonFailure(error, (api) =>
          api.code === 'keys_off' ? 'keysOff' : undefined,
        );
        if (failure === 'cancelled') return;
        setNotice({
          kind: 'notices',
          code: failure === 'limited' ? 'tooMany' : failure === 'keysOff' ? failure : 'failure',
        });
      })
      .finally(() => {
        setWorking(false);
        void queryClient.invalidateQueries(aiSettingsQuery);
      });
  };

  const save = (key: string) => {
    if (!aiKeyPatterns[provider].test(key)) {
      setNotice({ kind: 'notices', code: 'invalid' });
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
    setNotice(undefined);
    setWorking(true);
    reach(api.call(routes.testAiKey, { provider }))
      .then(({ result }) => {
        setNotice({ kind: 'tested', code: result });
      })
      .catch((error: unknown) => {
        setNotice({
          kind: 'tested',
          code: commonFailure(error) === 'limited' ? 'tooMany' : 'failure',
        });
      })
      .finally(() => {
        setWorking(false);
      });
  };

  const since =
    state.setAt === null
      ? ''
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
          new Date(state.setAt),
        );
  const title = t(`settings.ai.providers.${provider}.name`);
  const formOpen = canManage && (editing || state.state === 'none');
  return (
    <section aria-label={title} className={`${cardClass} flex flex-col gap-4 p-4`}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-medium">{title}</h4>
          <StatusChip
            tone={keyTones[state.state]}
            label={t(`settings.ai.keyState.${state.state}`)}
          />
        </div>
        <p className="text-small text-muted">{t(`settings.ai.providers.${provider}.use`)}</p>
      </div>
      {state.state === 'set' && state.lastFour !== null && (
        <p>{t('settings.ai.lastFour', { lastFour: state.lastFour, since })}</p>
      )}
      {state.state === 'unreadable' && <p>{t('settings.ai.unreadable')}</p>}
      {formOpen && (
        <KeyForm
          provider={provider}
          working={working}
          onSave={save}
          {...(state.state === 'none'
            ? {}
            : {
                onCancel: () => {
                  setEditing(false);
                },
              })}
        />
      )}
      <div className="flex flex-col gap-3">
        {!formOpen && (
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" disabled={working || state.state === 'none'} onClick={test}>
              {t('settings.ai.test')}
            </Button>
            {canManage && (
              <Button
                variant="secondary"
                disabled={working}
                onClick={() => {
                  setNotice(undefined);
                  setEditing(true);
                }}
              >
                {t('settings.ai.replace')}
              </Button>
            )}
            {canManage && state.keyId !== null && (
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
        )}
        <p role="status" className="text-small empty:-mt-3">
          {notice === undefined
            ? ''
            : notice.kind === 'tested'
              ? t(`settings.ai.tested.${notice.code}`)
              : t(`settings.ai.notices.${notice.code}`)}
        </p>
      </div>
    </section>
  );
}

/** One stage on a row: what it does, then its model and effort in columns that line up. */
function StageRow({
  stage,
  choice,
  isDefault,
  onChange,
}: {
  readonly stage: AiStage;
  readonly choice: StageChoice;
  readonly isDefault: boolean;
  readonly onChange: (choice: StageChoice) => void;
}) {
  const { t } = useTranslation();
  const options = aiStageOptions[stage];
  const title = t(`settings.ai.stages.${stage}.name`);
  return (
    <section
      aria-label={title}
      className="grid gap-3 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_14rem_12rem] lg:items-end lg:gap-6"
    >
      <div className="flex flex-col gap-1 self-center">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-medium">{title}</h4>
          {isDefault && <StatusChip tone="unknown" label={t('settings.ai.default')} />}
        </div>
        <p className="text-small text-muted">{t(`settings.ai.stages.${stage}.lead`)}</p>
      </div>
      <SelectField
        label={t('settings.ai.model')}
        value={choice.model}
        onChange={(model) => {
          onChange({ ...choice, model });
        }}
        options={options.models.map((value) => ({ value, label: value }))}
      />
      {options.efforts.length > 0 ? (
        <SelectField
          label={t('settings.ai.effort')}
          value={choice.effort ?? ''}
          onChange={(value) => {
            onChange({
              ...choice,
              effort: options.efforts.find((candidate) => candidate === value) ?? null,
            });
          }}
          options={options.efforts.map((value) => ({
            value,
            label: t(`settings.ai.efforts.${value}`),
          }))}
        />
      ) : (
        <div className="hidden flex-col gap-1 lg:flex">
          <p className="font-medium">{t('settings.ai.effort')}</p>
          <p className="flex min-h-touch items-center text-muted">{t('settings.ai.noEffort')}</p>
        </div>
      )}
    </section>
  );
}

/** Every stage in one card, saved together: only the stages that changed are sent. */
function StagesCard({ stages }: { readonly stages: readonly AiStageState[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [choices, setChoices] = useState<Partial<Record<AiStage, StageChoice>>>({});
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'failure' | 'tooMany'>();
  const changed = stageChanges(stages, choices);

  const save = () => {
    setNotice(undefined);
    setWorking(true);
    changed
      .reduce<Promise<unknown>>(
        (previous, body) => previous.then(() => reach(api.call(routes.setAiStage, body))),
        Promise.resolve(),
      )
      .then(() => {
        setChoices({});
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

  return (
    <div className={`${cardClass} flex flex-col gap-4 p-4`}>
      <div>
        {stages.map((stored) => (
          <StageRow
            key={stored.stage}
            stage={stored.stage}
            choice={choices[stored.stage] ?? { model: stored.model, effort: stored.effort }}
            isDefault={stored.isDefault}
            onChange={(choice) => {
              setNotice(undefined);
              setChoices((current) => ({ ...current, [stored.stage]: choice }));
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button disabled={working || changed.length === 0} onClick={save}>
          {t('settings.ai.saveStages')}
        </Button>
        <p role="status" className="text-small">
          {notice === undefined ? '' : t(`settings.ai.stageNotices.${notice}`)}
        </p>
      </div>
    </div>
  );
}

/** Configurações › IA (ADR-0031): the provider keys side by side, then every stage's model. */
export function AiPanel() {
  const { t } = useTranslation();
  const settings = useQuery(aiSettingsQuery);
  if (settings.isError) return <p className="text-muted">{t('settings.ai.loadFailure')}</p>;
  if (settings.data === undefined) return null;
  const { canManageKeys, keysOff, keys, stages } = settings.data;
  return (
    <div className="flex flex-col gap-8">
      <Group
        id="ai-keys-title"
        title={t('settings.ai.keysTitle')}
        {...(canManageKeys
          ? {}
          : { lead: t(keysOff ? 'settings.ai.notices.keysOff' : 'settings.ai.ownerOnly') })}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {keys.map((key) => (
            <KeyCard key={key.provider} keyState={key} canManage={canManageKeys} />
          ))}
        </div>
      </Group>
      <Group id="ai-stages-title" title={t('settings.ai.stagesTitle')}>
        <StagesCard stages={stages} />
      </Group>
    </div>
  );
}
