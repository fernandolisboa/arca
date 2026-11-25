import {
  AppShell,
  type DockEdge,
  type NavCollapse,
  type NavItem,
  type ShellLinkProps,
} from '@arca/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, createRootRoute, useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { sessionQuery } from '../api.js';
import { appearance, useAppearance } from '../appearance/store.js';
import { TourGuide } from '../tour/guide.js';

export const Route = createRootRoute({ component: Root });

/** Only pages that exist get an item (spec 0006, R8); the list grows as features land. */
const homePath = '/';
const destinations = [
  { id: 'home', to: homePath, icon: 'home', adminOnly: false },
  { id: 'family', to: '/family', icon: 'family', adminOnly: false },
  { id: 'compare', to: '/compare', icon: 'countries', adminOnly: false },
  { id: 'departure', to: '/departure', icon: 'plan', adminOnly: false },
  { id: 'vault', to: '/vault', icon: 'vault', adminOnly: false },
  { id: 'knowledge', to: '/knowledge', icon: 'knowledge', adminOnly: true },
] as const;
const settingsPage = { id: 'settings', to: '/settings', icon: 'settings' } as const;

function ShellLink({ href, ...props }: ShellLinkProps) {
  return <Link to={href} activeOptions={{ exact: true }} {...props} />;
}

function Root() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { resolved } = useAppearance();
  const session = useQuery(sessionQuery);
  const admin = session.data?.admin === true;

  const items: NavItem[] = destinations
    .filter((destination) => admin || !destination.adminOnly)
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

  function onCollapseChange(collapse: NavCollapse) {
    appearance.set('navCollapse', collapse);
  }

  return (
    <>
      <AppShell
        title={<h1 className="truncate font-display text-title">{t('app.name')}</h1>}
        homeHref={homePath}
        skipToContentLabel={t('shell.skipToContent')}
        items={items}
        settings={{
          id: settingsPage.id,
          label: t('shell.nav.settings'),
          icon: settingsPage.icon,
          href: settingsPage.to,
          current: pathname === settingsPage.to,
        }}
        layout={{
          wide: resolved.navWide,
          narrow: resolved.navNarrow,
          dockEdge: resolved.dockEdge,
          collapse: resolved.navCollapse,
          autoHide: resolved.navAutoHide,
        }}
        onDockEdgeChange={onDockEdgeChange}
        onCollapseChange={onCollapseChange}
        labels={{
          navigation: t('shell.navigation'),
          openMenu: t('shell.openMenu'),
          closeMenu: t('shell.closeMenu'),
          navigationGroup: t('shell.navigationGroup'),
          accountGroup: t('shell.accountGroup'),
          collapseMenu: t('shell.collapseMenu'),
          expandMenu: t('shell.expandMenu'),
          home: t('shell.home'),
        }}
        link={ShellLink}
      >
        <Outlet />
      </AppShell>
      <TourGuide />
    </>
  );
}
