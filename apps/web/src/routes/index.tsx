import { Button } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { healthQuery, recoveryKitQuery, sessionQuery } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';
import { DeletionPendingNotice } from '../account-deletion.js';
import { useDateFormat } from '../use-date-format.js';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-muted">{t('app.description')}</p>
      <SessionLine />
      <section
        aria-labelledby="health-title"
        className="rounded-card border border-line bg-surface p-4"
      >
        <h2 id="health-title" className="font-semibold">
          {t('health.title')}
        </h2>
        <HealthStatus />
      </section>
    </div>
  );
}

function HealthStatus() {
  const { t } = useTranslation();
  const health = useQuery(healthQuery);
  // One live region whose text changes, so screen readers announce each new state.
  const [message, tone] = health.isPending
    ? [t('health.checking'), 'text-muted']
    : health.isError
      ? [t('health.unreachable'), 'text-danger-ink']
      : [
          t('health.status', { status: health.data.status }),
          health.data.status === 'ok' ? 'text-ok-ink' : 'text-warn-ink',
        ];
  return (
    <div className="flex flex-col items-start gap-3">
      <p role="status" className={tone}>
        {message}
      </p>
      {health.isError && (
        <Button
          disabled={health.isFetching}
          aria-busy={health.isFetching}
          onClick={() => void health.refetch()}
        >
          {t('health.retry')}
        </Button>
      )}
    </div>
  );
}

function SessionLine() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  if (session.isPending) return null;
  if (session.isSuccess && session.data.deletionDueAt !== null) {
    return (
      <>
        <p>{t('session.signedIn', { email: session.data.email })}</p>
        {session.data.recoveryPending && <RecoveryPendingNotice />}
        <DeletionPendingNotice dueAt={session.data.deletionDueAt} />
      </>
    );
  }
  if (session.isSuccess && session.data.recoveryPending) {
    return (
      <>
        <p>{t('session.signedIn', { email: session.data.email })}</p>
        <RecoveryPendingNotice />
      </>
    );
  }
  if (session.isSuccess) {
    return (
      <>
        <p>{t('session.signedIn', { email: session.data.email })}</p>
        {session.data.pendingPasskeyUntil !== null && (
          <PendingPasskeyNotice activeFrom={session.data.pendingPasskeyUntil} />
        )}
        <KitNotice />
        <Link to="/devices" className={textLinkClass}>
          {t('session.devices')}
        </Link>
        <Link to="/vault" className={textLinkClass}>
          {t('session.vault')}
        </Link>
        {session.data.confirmed ? (
          <Link to="/invites" className={textLinkClass}>
            {t('session.invites')}
          </Link>
        ) : (
          <p className="text-warn-ink">{t('session.unconfirmed')}</p>
        )}
      </>
    );
  }
  return (
    <Link to="/sign-in" className={textLinkClass}>
      {t('session.signIn')}
    </Link>
  );
}

/** Until the recovery kit is saved, losing every passkey would lock the account (spec 0003, R6). */
function KitNotice() {
  const { t } = useTranslation();
  const kit = useQuery(recoveryKitQuery);
  if (!kit.isSuccess || kit.data.status === 'saved') return null;
  return (
    <section
      aria-labelledby="kit-notice-title"
      className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
    >
      <p id="kit-notice-title" className="text-warn-ink">
        {t('session.kitPending')}
      </p>
      <Link to="/recovery-kit" className={textLinkClass}>
        {t('session.kitLink')}
      </Link>
    </section>
  );
}

/**
 * While a recovery passkey waits, every session of the account can only show this and cancel
 * the recovery from the device list (spec 0003, R6).
 */
function RecoveryPendingNotice() {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="recovery-pending-title"
      className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
    >
      <p id="recovery-pending-title" className="text-warn-ink">
        {t('session.recoveryPending')}
      </p>
      <Link to="/devices" className={textLinkClass}>
        {t('session.recoveryLink')}
      </Link>
    </section>
  );
}

/** Every session of the account sees a passkey added while it waits (spec 0003, R4). */
function PendingPasskeyNotice({ activeFrom }: { readonly activeFrom: string }) {
  const { t } = useTranslation();
  const when = useDateFormat();
  return (
    <section
      aria-labelledby="pending-passkey-title"
      className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
    >
      <p id="pending-passkey-title" className="text-warn-ink">
        {t('session.pendingPasskey', { activeFrom: when.format(new Date(activeFrom)) })}
      </p>
      <Link to="/devices" className={textLinkClass}>
        {t('session.pendingLink')}
      </Link>
    </section>
  );
}
