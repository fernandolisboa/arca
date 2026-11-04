import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { resetAccount, sessionQuery } from '../api.js';
import {
  linkRequestFailure,
  registerFromLink,
  registrationFailure,
  requestOwnerLink,
  type LinkRequestFailure,
  type RegistrationFailure,
} from '../enrollment.js';
import { emailInput } from '../forms/inputs.js';
import { TextField } from '../forms/text-field.js';
import { textLinkClass } from '../forms/text-link.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';
import { SignedInNotice } from '../signed-in-notice.js';
import { useLinkToken } from '../use-link-token.js';
import { usePasskeyAvailable } from '../use-passkey-available.js';

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

/** Without a link token, the owner asks for the link; with one, they create the passkey. */
function Enroll() {
  const [token, setToken] = useLinkToken();
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
  const session = useQuery(sessionQuery);
  const available = usePasskeyAvailable();
  const [code, setCode] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<RegistrationFailure | 'unavailable'>();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(undefined);
    setWaiting(true);
    registerFromLink(passkeys, { token, code })
      .then(async () => {
        await resetAccount(queryClient);
        await navigate({ to: '/recovery-kit' });
      })
      .catch(async (error: unknown) => {
        const reason = registrationFailure(error);
        setWaiting(false);
        // Signed in from another tab meanwhile: the notice takes over once the session refetches.
        if (reason === 'signed_in') await queryClient.invalidateQueries(sessionQuery);
        else setFailure(reason);
      });
  };

  const reason = available === false ? 'unavailable' : failure;
  const message = waiting
    ? t('enroll.register.waiting')
    : reason === undefined
      ? ''
      : t('enroll.register.failure', { reason });

  // While waiting, a session that appears is this registration's own, on its way to the kit.
  if (session.isSuccess && !waiting) {
    return (
      <Page title={t('enroll.register.title')}>
        <SignedInNotice email={session.data.email} />
      </Page>
    );
  }

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
        <Button
          type="submit"
          disabled={available !== true || session.isPending || waiting}
          aria-busy={waiting}
        >
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
