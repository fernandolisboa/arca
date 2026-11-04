import { AppShell } from '@arca/ui';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createRootRoute({ component: Root });

function Root() {
  const { t } = useTranslation();
  return (
    <AppShell
      title={<h1 className="font-display text-title">{t('app.name')}</h1>}
      skipToContentLabel={t('shell.skipToContent')}
    >
      <Outlet />
    </AppShell>
  );
}
