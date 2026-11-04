import type { ApiError } from '@arca/api-contract/client';
import { EnvelopeNotOpenedError, EnvelopeNotSealedError } from '@arca/platform';
import { Button } from '@arca/ui';
import { WrongRecoverySecret } from '@arca/vault';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createLazyFileRoute } from '@tanstack/react-router';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { sessionQuery, vaultStatusQuery } from '../api.js';
import { recoveryCodeInput } from '../forms/inputs.js';
import { TextField } from '../forms/text-field.js';
import { textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';
import { vaultDevice } from '../vault-device.js';
import { RecoveryCodeSheet } from '../recovery-code.js';
import { commonFailure, type CommonFailure } from '../requests.js';
import {
  replaceVaultSecret,
  setUpVault,
  unlockVault,
  WrongVaultIdentity,
  type SecretNeeded,
} from '../vault.js';
import {
  lockVault,
  useUnlockedVault,
  vaultIdleMinutes,
  type UnlockedVault,
} from '../vault-session.js';

export const Route = createLazyFileRoute('/vault')({ component: Vault });

type VaultFailure = CommonFailure | 'wrong_secret' | 'wrong_identity' | 'exists' | 'changed';

const vaultApiFailures: Partial<Record<string, VaultFailure>> = {
  vault_exists: 'exists',
  vault_changed: 'changed',
};

function vaultFailure(error: unknown): VaultFailure {
  if (error instanceof WrongRecoverySecret) return 'wrong_secret';
  if (error instanceof WrongVaultIdentity) return 'wrong_identity';
  if (error instanceof EnvelopeNotOpenedError || error instanceof EnvelopeNotSealedError) {
    return 'cancelled';
  }
  return commonFailure(error, (apiError: ApiError) => vaultApiFailures[apiError.code]);
}

/** Runs one vault step with its waiting state and failure, as every button here does. */
function useStep() {
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<VaultFailure>();
  const run = (step: () => Promise<void>) => {
    setFailure(undefined);
    setWaiting(true);
    step()
      .catch((error: unknown) => {
        setFailure(vaultFailure(error));
      })
      .finally(() => {
        setWaiting(false);
      });
  };
  return { waiting, failure, run };
}

/**
 * The vault (spec 0005, R2): set up on first use, opened with a passkey or, where the passkey
 * cannot, the vault recovery secret, and closed by hand, on sign-out or after 15 minutes idle.
 */
function Vault() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  const accountId = session.data?.accountId;
  const status = useQuery({ ...vaultStatusQuery, enabled: session.isSuccess });
  const unlocked = useUnlockedVault(accountId);
  const [secret, setSecret] = useState<string>();

  if (session.isError) {
    return (
      <Section>
        <p>{t('vault.signIn')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('session.signIn')}
        </Link>
      </Section>
    );
  }
  if (status.isError) {
    return (
      <Section>
        <p role="status">{t('vault.statusFailure')}</p>
      </Section>
    );
  }
  if (accountId === undefined || !status.isSuccess) return <Section />;
  if (secret !== undefined) {
    return (
      <Section lead={t('vault.kit.lead')}>
        <RecoveryCodeSheet
          part="vault"
          code={secret}
          onSaved={() => {
            setSecret(undefined);
            return Promise.resolve();
          }}
        />
      </Section>
    );
  }
  if (status.data.recipient === null) return <SetUp accountId={accountId} onSecret={setSecret} />;
  if (unlocked === undefined) {
    return <Locked accountId={accountId} resealDue={status.data.resealDue} />;
  }
  if (status.data.resealDue) return <NewSecret vault={unlocked} onSecret={setSecret} />;
  return <Opened />;
}

function Section({ lead, children }: { readonly lead?: string; readonly children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Page title={t('vault.title')} lead={lead ?? t('vault.lead')}>
      {children}
    </Page>
  );
}

/** One live region whose text changes, so each new state is announced. */
function StepStatus({ waiting, failure }: { waiting: boolean; failure: VaultFailure | undefined }) {
  const { t } = useTranslation();
  const message = waiting
    ? t('vault.waiting')
    : failure === undefined
      ? ''
      : t('vault.failure', { reason: failure });
  return (
    <p role="status" className={failure === undefined && !waiting ? 'text-muted' : 'text-ink'}>
      {message}
    </p>
  );
}

function SetUp({
  accountId,
  onSecret,
}: {
  readonly accountId: string;
  readonly onSecret: (secret: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { waiting, failure, run } = useStep();
  return (
    <Section>
      <p>{t('vault.setUpLead')}</p>
      <Button
        disabled={waiting}
        aria-busy={waiting}
        onClick={() => {
          run(async () => {
            const secret = await setUpVault(vaultDevice, accountId);
            onSecret(secret);
            await queryClient.invalidateQueries({ queryKey: vaultStatusQuery.queryKey });
          });
        }}
      >
        {t('vault.setUp')}
      </Button>
      <StepStatus waiting={waiting} failure={failure} />
    </Section>
  );
}

function Locked({
  accountId,
  resealDue,
}: {
  readonly accountId: string;
  readonly resealDue: boolean;
}) {
  const { t } = useTranslation();
  const { waiting, failure, run } = useStep();
  const [needed, setNeeded] = useState<SecretNeeded>();
  if (needed !== undefined) return <EnterSecret needed={needed} />;
  return (
    <Section>
      {resealDue && <p>{t('vault.resealPending')}</p>}
      <p>{t('vault.unlockLead')}</p>
      <Button
        disabled={waiting}
        aria-busy={waiting}
        onClick={() => {
          run(async () => {
            setNeeded(await unlockVault(vaultDevice, accountId));
          });
        }}
      >
        {t('vault.unlock')}
      </Button>
      <StepStatus waiting={waiting} failure={failure} />
    </Section>
  );
}

function EnterSecret({ needed }: { readonly needed: SecretNeeded }) {
  const { t } = useTranslation();
  const { waiting, failure, run } = useStep();
  const [secret, setSecret] = useState('');
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(() => needed.openWithSecret(secret));
  };
  return (
    <Section>
      <p>{t('vault.secretLead')}</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('vault.kit.codeLabel')}
          {...recoveryCodeInput}
          value={secret}
          onChange={(event) => {
            setSecret(event.currentTarget.value);
          }}
        />
        <Button type="submit" disabled={waiting} aria-busy={waiting}>
          {t('vault.secretSubmit')}
        </Button>
      </form>
      <StepStatus waiting={waiting} failure={failure} />
    </Section>
  );
}

/**
 * After an account recovery or a new recovery kit, the vault part of the kit comes next: a new
 * secret sealed in before it is shown (spec 0003, R6).
 */
function NewSecret({
  vault,
  onSecret,
}: {
  readonly vault: UnlockedVault;
  readonly onSecret: (secret: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { waiting, failure, run } = useStep();
  return (
    <Section>
      <p>{t('vault.resealLead')}</p>
      <Button
        disabled={waiting}
        aria-busy={waiting}
        onClick={() => {
          run(async () => {
            onSecret(await replaceVaultSecret(vaultDevice, vault));
            await queryClient.invalidateQueries({ queryKey: vaultStatusQuery.queryKey });
          });
        }}
      >
        {t('vault.reseal')}
      </Button>
      <StepStatus waiting={waiting} failure={failure} />
    </Section>
  );
}

function Opened() {
  const { t } = useTranslation();
  return (
    <Section>
      <p role="status">{t('vault.opened', { minutes: vaultIdleMinutes })}</p>
      <Button
        onClick={() => {
          lockVault();
        }}
      >
        {t('vault.lock')}
      </Button>
    </Section>
  );
}
