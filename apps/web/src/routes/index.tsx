import { Button } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { healthQuery, sessionQuery } from '../api.js';

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
  if (session.isSuccess) return <p>{t('session.signedIn', { email: session.data.email })}</p>;
  return (
    <Link
      to="/sign-in"
      className="inline-flex min-h-touch items-center self-start font-medium text-ink underline decoration-primary decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {t('session.signIn')}
    </Link>
  );
}
