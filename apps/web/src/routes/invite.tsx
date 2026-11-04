import { Button } from '@arca/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resetAccount, sessionQuery } from '../api.js';
import { registerFromLink } from '../enrollment.js';
import { textLinkClass } from '../forms/text-link.js';
import { acceptFailure, inviteFrom, type AcceptFailure } from '../invites.js';
import { Page } from '../page.js';
import { passkeys } from '../platform.js';
import { commonFailure } from '../requests.js';
import { SignedInNotice } from '../signed-in-notice.js';
import { useLinkToken } from '../use-link-token.js';
import { usePasskeyAvailable } from '../use-passkey-available.js';

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
  // A new link starts over: nothing the previous one showed or failed with carries across.
  return <Accept key={token} token={token} />;
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
  const session = useQuery(sessionQuery);
  const available = usePasskeyAvailable();
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<AcceptFailure | 'unavailable'>();

  const accept = () => {
    setFailure(undefined);
    setWaiting(true);
    registerFromLink(passkeys, { token })
      .then(async () => {
        await resetAccount(queryClient);
        await navigate({ to: '/recovery-kit' });
      })
      .catch(async (error: unknown) => {
        const reason = acceptFailure(error);
        setWaiting(false);
        // Signed in from another tab meanwhile: the notice takes over once the session refetches.
        if (reason === 'signed_in') await queryClient.invalidateQueries(sessionQuery);
        else setFailure(reason);
      });
  };

  // While waiting, a session that appears is this registration's own, on its way to the kit.
  const signedIn = session.isSuccess && !waiting ? session.data.email : undefined;
  const reason: AcceptFailure | 'unavailable' | undefined = invite.isError
    ? undefined
    : invite.data === null
      ? 'expired'
      : available === false
        ? 'unavailable'
        : failure;
  const message = invite.isPending
    ? t('acceptInvite.checking')
    : invite.isError
      ? t('acceptInvite.checkFailure', { reason: commonFailure(invite.error) })
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
      {inviter !== undefined && signedIn !== undefined && <SignedInNotice email={signedIn} />}
      {inviter !== undefined && signedIn === undefined && (
        <Button
          disabled={available !== true || session.isPending || waiting}
          aria-busy={waiting}
          onClick={accept}
        >
          {t('acceptInvite.submit')}
        </Button>
      )}
      {/* One live region whose text changes, so each new state is announced. */}
      <p
        role="status"
        className={reason === undefined && !invite.isError && !waiting ? 'text-muted' : 'text-ink'}
      >
        {message}
      </p>
      {invite.isError && (
        <Button
          disabled={invite.isFetching}
          aria-busy={invite.isFetching}
          onClick={() => void invite.refetch()}
        >
          {t('acceptInvite.retry')}
        </Button>
      )}
      {failure === 'refused' && (
        <Link to="/sign-in" className={textLinkClass}>
          {t('acceptInvite.signIn')}
        </Link>
      )}
    </Page>
  );
}
