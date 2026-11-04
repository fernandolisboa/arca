import { Button } from '@arca/ui';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sessionQuery } from '../api.js';
import { passkeys } from '../platform.js';
import { failureOf, signInWithPasskey, type SignInFailure } from '../sign-in.js';

export const Route = createFileRoute('/sign-in')({ component: SignIn });

interface Support {
  readonly available: boolean;
  readonly autofill: boolean;
}

/** Autofill waits on the account field; a press of the button replaces it until it ends. */
type Ceremony = 'autofill' | 'button';

/**
 * Browsers never time out an autofill request, but its challenge expires after five minutes on
 * the server, so a waiting one is replaced before that.
 */
const autofillRefreshMs = 4 * 60 * 1000;
const autofillRetryMs = 1000;

function SignIn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountId = useId();
  const hintId = useId();
  const [support, setSupport] = useState<Support>();
  const [ceremony, setCeremony] = useState<Ceremony>('autofill');
  const [failure, setFailure] = useState<SignInFailure>();
  // Bumped to start a new autofill ceremony while the ceremony state stays 'autofill'.
  const [autofillRun, setAutofillRun] = useState(0);

  useEffect(() => {
    let current = true;
    void Promise.all([passkeys.isAvailable(), passkeys.supportsAutofill().catch(() => false)]).then(
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
    let restart: ReturnType<typeof setTimeout> | undefined;
    const restartAutofill = (delayMs: number) => {
      clearTimeout(restart);
      restart = setTimeout(() => {
        setAutofillRun((run) => run + 1);
      }, delayMs);
    };
    if (ceremony === 'autofill') restartAutofill(autofillRefreshMs);
    signInWithPasskey(passkeys, { autofill: ceremony === 'autofill', signal: controller.signal })
      .then(async () => {
        // Reset, not invalidated: the home page must not show the signed-out state it cached.
        await queryClient.resetQueries({ queryKey: sessionQuery.queryKey });
        await navigate({ to: '/' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const reason = failureOf(error);
        setFailure(reason);
        if (ceremony === 'button') setCeremony('autofill');
        // A pick that failed offers the field again soon; a server that failed waits longer.
        else if (reason === 'cancelled' || reason === 'refused') restartAutofill(autofillRetryMs);
      });
    return () => {
      clearTimeout(restart);
      controller.abort();
      passkeys.cancel();
    };
  }, [support, ceremony, autofillRun, queryClient, navigate]);

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
