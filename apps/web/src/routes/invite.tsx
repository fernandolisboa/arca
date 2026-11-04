import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recoveryKitQuery, sessionQuery } from '../api.js';
import { registerFromLink } from '../enrollment.js';
import { textLinkClass } from '../forms/text-link.js';
import { acceptFailure, inviteFrom, type AcceptFailure } from '../invites.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';
import { commonFailure } from '../requests.js';
import { useLinkToken } from '../use-link-token.js';

export const Route = createFileRoute('/invite')({ component: AcceptInvite });

/** The invite's link shows who sent it, then creates the invitee's passkey and account. */
function AcceptInvite() {
  const { t } = useTranslation();
  const [token] = useLinkToken();
  if (token === undefined) {
    return (
      <Page title={t('acceptInvite.title')}>
        <p>{t('acceptInvite.noLink')}</p>
        <Link to="/sign-in" className={textLinkClass}>
          {t('acceptInvite.signIn')}
        </Link>
      </Page>
    );
  }
  return <Accept token={token} />;
}

function Accept({ token }: { readonly token: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => inviteFrom(token),
    networkMode: 'always',
    retry: false,
    // The link is single use: once accepted, nothing it showed may come back from a cache.
    gcTime: 0,
  });
  const [available, setAvailable] = useState<boolean>();
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<AcceptFailure | 'unavailable'>();

  useEffect(() => {
    let current = true;
    void passkeys.isAvailable().then((supported) => {
      if (current) setAvailable(supported);
    });
    return () => {
      current = false;
    };
  }, []);

  const accept = () => {
    setFailure(undefined);
    setWaiting(true);
    registerFromLink(passkeys, { token })
      .then(async () => {
        await queryClient.resetQueries({ queryKey: sessionQuery.queryKey });
        await queryClient.resetQueries({ queryKey: recoveryKitQuery.queryKey });
        await navigate({ to: '/recovery-kit' });
      })
      .catch((error: unknown) => {
        setFailure(acceptFailure(error));
        setWaiting(false);
      });
  };

  const reason: AcceptFailure | 'unavailable' | undefined = invite.isError
    ? commonFailure(invite.error)
    : invite.data === null
      ? 'expired'
      : available === false
        ? 'unavailable'
        : failure;
  const message = invite.isPending
    ? t('acceptInvite.checking')
    : waiting
      ? t('acceptInvite.waiting')
      : reason === undefined
        ? ''
        : t('acceptInvite.failure', { reason });
  const inviter = invite.data?.inviterEmail ?? undefined;

  return (
    <Page title={t('acceptInvite.title')}>
      {inviter !== undefined && (
        <div className="flex flex-col gap-2">
          <p className="text-lead">{t('acceptInvite.from', { email: inviter })}</p>
          <p className="text-muted">{t('acceptInvite.lead')}</p>
        </div>
      )}
      {inviter !== undefined && (
        <Button disabled={available !== true || waiting} aria-busy={waiting} onClick={accept}>
          {t('acceptInvite.submit')}
        </Button>
      )}
      {/* One live region whose text changes, so each new state is announced. */}
      <p role="status" className={reason === undefined && !waiting ? 'text-muted' : 'text-ink'}>
        {message}
      </p>
      {failure === 'refused' && (
        <Link to="/sign-in" className={textLinkClass}>
          {t('acceptInvite.signIn')}
        </Link>
      )}
    </Page>
  );
}
