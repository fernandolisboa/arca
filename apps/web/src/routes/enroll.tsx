import { Button } from '@arca/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { recoveryKitQuery, sessionQuery } from '../api.js';
import {
  clearFragment,
  linkRequestFailure,
  linkTokenFrom,
  registerFromLink,
  registrationFailure,
  requestOwnerLink,
  type LinkRequestFailure,
  type RegistrationFailure,
} from '../enrollment.js';
import { TextField } from '../forms/text-field.js';
import { textLinkClass } from '../forms/text-link.js';
import { passkeys } from '../platform.js';

export const Route = createFileRoute('/enroll')({ component: Enroll });

/** The enrollment code as the owner types it: no autofill, no autocorrect. */
const codeInput = {
  name: 'enrollment-code',
  type: 'text',
  required: true,
  maxLength: 64,
  autoComplete: 'off',
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
} as const;

const emailInput = {
  name: 'email',
  type: 'email',
  required: true,
  maxLength: 254,
  autoComplete: 'email',
} as const;

/** Without a link token, the owner asks for the link; with one, they create the passkey. */
function Enroll() {
  const [token, setToken] = useState(() => linkTokenFrom(window.location.hash));
  useEffect(() => {
    clearFragment(window.location, window.history);
    // A link opened in a tab already on this page changes only the fragment.
    const onHashChange = () => {
      const linked = linkTokenFrom(window.location.hash);
      clearFragment(window.location, window.history);
      if (linked !== undefined) setToken(linked);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);
  return token === undefined ? (
    <RequestLink />
  ) : (
    <Register
      token={token}
      onNewLink={() => {
        setToken(undefined);
      }}
    />
  );
}

function Page({
  title,
  lead,
  children,
}: {
  readonly title: string;
  readonly lead: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby="enroll-title" className="mx-auto flex max-w-md flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id="enroll-title" className="font-display text-title">
          {title}
        </h2>
        <p className="text-muted">{lead}</p>
      </div>
      {children}
    </section>
  );
}

function RequestLink() {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [failure, setFailure] = useState<LinkRequestFailure>();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    setState('sending');
    requestOwnerLink(code, email)
      .then(() => {
        setState('sent');
      })
      .catch((error: unknown) => {
        setFailure(linkRequestFailure(error));
        setState('idle');
      });
  };

  const message =
    state === 'sending'
      ? t('enroll.request.sending')
      : state === 'sent'
        ? t('enroll.request.sent')
        : failure === undefined
          ? ''
          : t('enroll.request.failure', { reason: failure });

  return (
    <Page title={t('enroll.request.title')} lead={t('enroll.request.lead')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('enroll.request.code')}
          {...codeInput}
          value={code}
          onChange={(event) => {
            setCode(event.currentTarget.value);
          }}
        />
        <TextField
          label={t('enroll.request.email')}
          {...emailInput}
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);
          }}
        />
        <Button type="submit" disabled={state !== 'idle'} aria-busy={state === 'sending'}>
          {t('enroll.request.submit')}
        </Button>
      </form>
      {/* One live region whose text changes, so each new state is announced. */}
      <p role="status" className={failure === undefined ? 'text-muted' : 'text-ink'}>
        {message}
      </p>
    </Page>
  );
}

function Register({
  token,
  onNewLink,
}: {
  readonly token: string;
  readonly onNewLink: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [available, setAvailable] = useState<boolean>();
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<RegistrationFailure | 'unavailable'>();

  useEffect(() => {
    let current = true;
    void passkeys.isAvailable().then((supported) => {
      if (current) setAvailable(supported);
    });
    return () => {
      current = false;
    };
  }, []);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    setWaiting(true);
    registerFromLink(passkeys, { token, code })
      .then(async () => {
        // The new session replaces whatever the signed-out pages cached.
        await queryClient.resetQueries({ queryKey: sessionQuery.queryKey });
        await queryClient.resetQueries({ queryKey: recoveryKitQuery.queryKey });
        await navigate({ to: '/recovery-kit' });
      })
      .catch((error: unknown) => {
        setFailure(registrationFailure(error));
        setWaiting(false);
      });
  };

  const reason = available === false ? 'unavailable' : failure;
  const message = waiting
    ? t('enroll.register.waiting')
    : reason === undefined
      ? ''
      : t('enroll.register.failure', { reason });

  return (
    <Page title={t('enroll.register.title')} lead={t('enroll.register.lead')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('enroll.register.code')}
          {...codeInput}
          value={code}
          onChange={(event) => {
            setCode(event.currentTarget.value);
          }}
        />
        <Button type="submit" disabled={available !== true || waiting} aria-busy={waiting}>
          {t('enroll.register.submit')}
        </Button>
      </form>
      <p role="status" className={reason === undefined && !waiting ? 'text-muted' : 'text-ink'}>
        {message}
      </p>
      {failure === 'expired' && (
        <button type="button" className={textLinkClass} onClick={onNewLink}>
          {t('enroll.register.newLink')}
        </button>
      )}
      {failure === 'refused' && (
        <Link to="/sign-in" className={textLinkClass}>
          {t('enroll.register.signIn')}
        </Link>
      )}
    </Page>
  );
}
