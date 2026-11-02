import { Button } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { healthQuery } from '../api.js';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-ink-muted">{t('app.description')}</p>
      <section
        aria-labelledby="health-title"
        className="rounded-lg border border-line bg-surface-raised p-4"
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
    ? [t('health.checking'), 'text-ink-muted']
    : health.isError
      ? [t('health.unreachable'), 'text-danger']
      : [
          t('health.status', { status: health.data.status }),
          health.data.status === 'ok' ? 'text-ok' : 'text-warning',
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
