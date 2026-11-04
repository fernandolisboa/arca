import { Button } from '@arca/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sessionQuery } from '../api.js';
import { passkeys } from '../platform.js';
import { failureOf, signInWithPasskey, wasAborted, type SignInFailure } from '../sign-in.js';

export const Route = createFileRoute('/sign-in')({ component: SignIn });

interface Support {
  readonly available: boolean;
  readonly autofill: boolean;
}

/** Autofill waits on the account field; a press of the button replaces it until it ends. */
type Ceremony = 'autofill' | 'button';

function SignIn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountId = useId();
  const hintId = useId();
  const [support, setSupport] = useState<Support>();
  const [ceremony, setCeremony] = useState<Ceremony>('autofill');
  const [failure, setFailure] = useState<SignInFailure>();

  useEffect(() => {
    let current = true;
    void Promise.all([passkeys.isAvailable(), passkeys.supportsAutofill()]).then(
      ([available, autofill]) => {
        if (current) setSupport({ available, autofill });
      },
    );
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (support?.available !== true) return;
    if (ceremony === 'autofill' && !support.autofill) return;
    const controller = new AbortController();
    signInWithPasskey(passkeys, { autofill: ceremony === 'autofill', signal: controller.signal })
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
        await navigate({ to: '/' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || wasAborted(error)) return;
        setFailure(failureOf(error));
        setCeremony('autofill');
      });
    return () => {
      controller.abort();
      passkeys.cancel();
    };
  }, [support, ceremony, queryClient, navigate]);

  const waiting = ceremony === 'button';
  const message =
    support?.available === false
      ? t('signIn.failure', { reason: 'unavailable' })
      : waiting
        ? t('signIn.waiting')
        : failure === undefined
          ? ''
          : t('signIn.failure', { reason: failure });

  return (
    <section aria-labelledby="sign-in-title" className="mx-auto flex max-w-md flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id="sign-in-title" className="font-display text-title">
          {t('signIn.title')}
        </h2>
        <p className="text-muted">{t('signIn.lead')}</p>
      </div>
      {support?.autofill === true && (
        <div className="flex flex-col gap-1">
          <label htmlFor={accountId} className="font-medium">
            {t('signIn.account')}
          </label>
          <input
            id={accountId}
            name="username"
            type="text"
            autoComplete="username webauthn"
            aria-describedby={hintId}
            className="min-h-touch rounded-control border border-line bg-surface px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <p id={hintId} className="text-small text-muted">
            {t('signIn.accountHint')}
          </p>
        </div>
      )}
      <Button
        disabled={support?.available !== true || waiting}
        aria-busy={waiting}
        onClick={() => {
          setFailure(undefined);
          setCeremony('button');
        }}
      >
        {t('signIn.button')}
      </Button>
      {/* One live region whose text changes, so each new state is announced. */}
      <p role="status" className={failure === undefined && !waiting ? 'text-muted' : 'text-ink'}>
        {message}
      </p>
      <p className="text-small text-muted">{t('signIn.inviteOnly')}</p>
    </section>
  );
}
