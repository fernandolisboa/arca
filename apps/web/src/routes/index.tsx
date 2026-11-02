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
  if (health.isPending) {
    return <p role="status">{t('health.checking')}</p>;
  }
  if (health.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="status" className="text-danger">
          {t('health.unreachable')}
        </p>
        <Button onClick={() => void health.refetch()}>{t('health.retry')}</Button>
      </div>
    );
  }
  const { status } = health.data;
  return (
    <p role="status" className={status === 'ok' ? 'text-ok' : 'text-warning'}>
      {t('health.status', { status })}
    </p>
  );
}
