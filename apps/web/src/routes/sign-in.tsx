import { pendingPasskeyHours } from '@arca/api-contract/client';
import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { healthQuery, resetAccount } from '../api.js';
import { TextField } from '../forms/text-field.js';
import { textLinkClass } from '../forms/text-link.js';
import { passkeys } from '../platform.js';
import { failureOf, signInWithPasskey, type SignInFailure } from '../sign-in.js';

export const Route = createFileRoute('/sign-in')({ component: SignInPage });

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
/** A pick that failed offers the field again soon, then less often, up to once a minute. */
const autofillRetryMs = 1000;
const autofillRetryMaxMs = 60 * 1000;

/** The account field that offers the device's saved passkeys. */
const accountInput = { name: 'username', type: 'text', autoComplete: 'username webauthn' } as const;

/** A deployment that takes no accounts yet has nobody to sign in (spec 0003, R9). */
function SignInPage() {
  const { t } = useTranslation();
  const health = useQuery(healthQuery);
  if (health.data?.accounts !== 'closed') return <SignIn />;
  return (
    <section aria-labelledby="sign-in-title" className="mx-auto flex max-w-md flex-col gap-5">
      <h2 id="sign-in-title" className="font-display text-title">
        {t('signIn.title')}
      </h2>
      <p>{t('signIn.closed')}</p>
    </section>
  );
}

function SignIn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [support, setSupport] = useState<Support>();
  const [ceremony, setCeremony] = useState<Ceremony>('autofill');
  const [failure, setFailure] = useState<SignInFailure>();
  // Bumped to start a new autofill ceremony while the ceremony state stays 'autofill'.
  const [autofillRun, setAutofillRun] = useState(0);
  const autofillRetries = useRef(0);

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
    // Only quick retries after failed picks back off; a refresh or a button press starts over.
    if (ceremony === 'button') autofillRetries.current = 0;
    const restartAutofill = (delayMs: number, { retry = false } = {}) => {
      clearTimeout(restart);
      restart = setTimeout(() => {
        if (!retry) autofillRetries.current = 0;
        setAutofillRun((run) => run + 1);
      }, delayMs);
    };
    if (ceremony === 'autofill') restartAutofill(autofillRefreshMs);
    signInWithPasskey(passkeys, { autofill: ceremony === 'autofill', signal: controller.signal })
      .then(async () => {
        await resetAccount(queryClient);
        await navigate({ to: '/' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const reason = failureOf(error);
        setFailure(reason);
        if (ceremony === 'button') setCeremony('autofill');
        // A server that failed waits for the refresh instead.
        else if (reason === 'cancelled' || reason === 'refused') {
          const delayMs = Math.min(
            autofillRetryMs * 2 ** autofillRetries.current,
            autofillRetryMaxMs,
          );
          autofillRetries.current += 1;
          restartAutofill(delayMs, { retry: true });
        }
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
          : t('signIn.failure', { reason: failure, hours: pendingPasskeyHours });

  return (
    <section aria-labelledby="sign-in-title" className="mx-auto flex max-w-md flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id="sign-in-title" className="font-display text-title">
          {t('signIn.title')}
        </h2>
        <p className="text-muted">{t('signIn.lead')}</p>
      </div>
      {support?.autofill === true && (
        <TextField label={t('signIn.account')} hint={t('signIn.accountHint')} {...accountInput} />
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
      <div className="flex flex-col gap-1">
        <p className="text-small text-muted">{t('signIn.lostAccess')}</p>
        <Link to="/recover" className={textLinkClass}>
          {t('signIn.recover')}
        </Link>
      </div>
    </section>
  );
}
