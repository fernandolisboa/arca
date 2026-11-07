import { AppShell, type DockEdge, type NavItem, type ShellLinkProps } from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, createRootRoute, useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { sessionQuery } from '../api.js';
import { appearance, useAppearance } from '../appearance/store.js';

export const Route = createRootRoute({ component: Root });

/** Only pages that exist get an item (spec 0006, R8); the list grows as features land. */
const destinations = [
  { id: 'home', to: '/', icon: 'home', approverOnly: false },
  { id: 'family', to: '/family', icon: 'family', approverOnly: false },
  { id: 'vault', to: '/vault', icon: 'vault', approverOnly: false },
  { id: 'knowledge', to: '/knowledge', icon: 'knowledge', approverOnly: true },
] as const;
const settingsPage = { id: 'settings', to: '/settings', icon: 'settings' } as const;

function ShellLink({ href, ...props }: ShellLinkProps) {
  return <Link to={href} {...props} />;
}

function Root() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { resolved } = useAppearance();
  const session = useQuery(sessionQuery);
  const approver = session.data?.approver === true;

  const items: NavItem[] = destinations
    .filter((destination) => approver || !destination.approverOnly)
    .map((destination) => ({
      id: destination.id,
      label: t(`shell.nav.${destination.id}`),
      icon: destination.icon,
      href: destination.to,
      current: pathname === destination.to,
    }));

  function onDockEdgeChange(dockEdge: DockEdge) {
    appearance.set('dockEdge', dockEdge);
  }

  return (
    <AppShell
      title={<h1 className="truncate font-display text-title">{t('app.name')}</h1>}
      skipToContentLabel={t('shell.skipToContent')}
      items={items}
      settings={{
        id: settingsPage.id,
        label: t('shell.nav.settings'),
        icon: settingsPage.icon,
        href: settingsPage.to,
        current: pathname === settingsPage.to,
      }}
      layout={{ wide: resolved.navWide, narrow: resolved.navNarrow, dockEdge: resolved.dockEdge }}
      onDockEdgeChange={onDockEdgeChange}
      labels={{
        navigation: t('shell.navigation'),
        openMenu: t('shell.openMenu'),
        closeMenu: t('shell.closeMenu'),
        navigationGroup: t('shell.navigationGroup'),
        accountGroup: t('shell.accountGroup'),
      }}
      link={ShellLink}
    >
      <Outlet />
    </AppShell>
  );
}
