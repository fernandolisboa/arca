import { pendingPasskeyHours, recoveryLinkMinutes } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { emailInput, recoveryCodeInput } from '../forms/inputs.js';
import { TextField } from '../forms/text-field.js';
import { textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';
import { RecoveryCodeSheet } from '../recovery-code.js';
import {
  createRecoveryPasskey,
  recoveryLinkFailure,
  recoveryPasskeyFailure,
  redeemFailure,
  redeemRecoveryCode,
  requestRecoveryLink,
  type RecoveryLinkFailure,
  type RecoveryPasskeyFailure,
  type RedeemFailure,
} from '../recovery.js';
import { useLinkToken } from '../use-link-token.js';
import { forgetVault } from '../vault-guard.js';
import { usePasskeyAvailable } from '../use-passkey-available.js';

export const Route = createFileRoute('/recover')({ component: Recover });

/**
 * Account recovery (spec 0003, R6): without a link token, the person asks for the link; with
 * one, they type the recovery code, keep the new one and create the new passkey. The new code
 * and the registration token live only in this page's state.
 */
function Recover() {
  const [token, setToken] = useLinkToken();
  const [opened, setOpened] = useState<{ readonly code: string; readonly token: string }>();
  const [kept, setKept] = useState(false);
  if (token === undefined) return <RequestLink />;
  if (opened === undefined) {
    return (
      <RedeemCode
        token={token}
        onOpened={setOpened}
        onNewLink={() => {
          setToken(undefined);
        }}
      />
    );
  }
  if (!kept) {
    return (
      <NewCode
        code={opened.code}
        onKept={() => {
          setKept(true);
        }}
      />
    );
  }
  return <CreatePasskey token={opened.token} />;
}

function RequestLink() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [failure, setFailure] = useState<RecoveryLinkFailure>();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    setState('sending');
    requestRecoveryLink(email)
      .then(() => {
        setState('sent');
      })
      .catch((error: unknown) => {
        setFailure(recoveryLinkFailure(error));
        setState('idle');
      });
  };

  const message =
    state === 'sending'
      ? t('recover.request.sending')
      : state === 'sent'
        ? t('recover.request.sent', { minutes: recoveryLinkMinutes })
        : failure === undefined
          ? ''
          : t('recover.request.failure', { reason: failure });

  return (
    <Page narrow title={t('recover.request.title')} lead={t('recover.request.lead')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('recover.request.email')}
          {...emailInput}
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);
          }}
        />
        <Button type="submit" disabled={state !== 'idle'} aria-busy={state === 'sending'}>
          {t('recover.request.submit')}
        </Button>
      </form>
      {/* One live region whose text changes, so each new state is announced. */}
      <p role="status" className={failure === undefined ? 'text-muted' : 'text-ink'}>
        {message}
      </p>
    </Page>
  );
}

function RedeemCode({
  token,
  onOpened,
  onNewLink,
}: {
  readonly token: string;
  readonly onOpened: (opened: { readonly code: string; readonly token: string }) => void;
  readonly onNewLink: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<RedeemFailure>();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    setWaiting(true);
    redeemRecoveryCode(token, code)
      .then(onOpened)
      .catch((error: unknown) => {
        setFailure(redeemFailure(error));
        setWaiting(false);
      });
  };

  const message = waiting
    ? t('recover.code.checking')
    : failure === undefined
      ? ''
      : t('recover.code.failure', { reason: failure });

  return (
    <Page narrow title={t('recover.code.title')} lead={t('recover.code.lead')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('recover.code.label')}
          {...recoveryCodeInput}
          value={code}
          onChange={(event) => {
            setCode(event.currentTarget.value);
          }}
        />
        <Button type="submit" disabled={waiting || failure === 'locked'} aria-busy={waiting}>
          {t('recover.code.submit')}
        </Button>
      </form>
      <p role="status" className={failure === undefined ? 'text-muted' : 'text-ink'}>
        {message}
      </p>
      {failure === 'expired' && (
        <button type="button" className={textLinkClass} onClick={onNewLink}>
          {t('recover.newLink')}
        </button>
      )}
    </Page>
  );
}

function NewCode({ code, onKept }: { readonly code: string; readonly onKept: () => void }) {
  const { t } = useTranslation();
  return (
    <Page narrow title={t('recover.newCode.title')} lead={t('recover.newCode.lead')}>
      <RecoveryCodeSheet
        code={code}
        onSaved={() => {
          onKept();
          return Promise.resolve();
        }}
      />
    </Page>
  );
}

function CreatePasskey({ token }: { readonly token: string }) {
  const { t } = useTranslation();
  const available = usePasskeyAvailable();
  const [state, setState] = useState<'idle' | 'waiting' | 'done'>('idle');
  const [failure, setFailure] = useState<RecoveryPasskeyFailure>();

  if (state === 'done') {
    return (
      <Page
        narrow
        title={t('recover.done.title')}
        lead={t('recover.done.lead', { hours: pendingPasskeyHours })}
      >
        <Link to="/sign-in" className={textLinkClass}>
          {t('recover.done.signIn')}
        </Link>
      </Page>
    );
  }

  const create = () => {
    setFailure(undefined);
    setState('waiting');
    createRecoveryPasskey(passkeys, token)
      // A recovery forgets the vault identity wrapped on this device (ADR-0018), best effort.
      .then(() => forgetVault().catch(() => undefined))
      .then(() => {
        setState('done');
      })
      .catch((error: unknown) => {
        setFailure(recoveryPasskeyFailure(error));
        setState('idle');
      });
  };

  const reason = available === false ? 'unavailable' : failure;
  const message =
    state === 'waiting'
      ? t('recover.passkey.waiting')
      : reason === undefined
        ? ''
        : t('recover.passkey.failure', { reason });

  return (
    <Page
      narrow
      title={t('recover.passkey.title')}
      lead={t('recover.passkey.lead', { hours: pendingPasskeyHours })}
    >
      <Button
        disabled={available !== true || state === 'waiting' || failure === 'expired'}
        aria-busy={state === 'waiting'}
        onClick={create}
      >
        {t('recover.passkey.submit')}
      </Button>
      <p role="status" className={reason === undefined ? 'text-muted' : 'text-ink'}>
        {message}
      </p>
    </Page>
  );
}
