import { AppShell, type DockEdge, type NavItem, type ShellLinkProps } from '@arca/ui';
import { axes } from '@arca/ui/theme/ids';
import { Link, Outlet, createRootRoute, useLocation } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { layoutFromDocument } from '../shell/layout.js';

export const Route = createRootRoute({ component: Root });

/** Only pages that exist get an item (spec 0006, R8); the list grows as features land. */
const destinations = [{ id: 'home', to: '/', icon: 'home' }] as const;

function ShellLink({ href, ...props }: ShellLinkProps) {
  return <Link to={href} {...props} />;
}

function Root() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [layout, setLayout] = useState(layoutFromDocument);

  const items: NavItem[] = destinations.map((destination) => ({
    id: destination.id,
    label: t(`shell.nav.${destination.id}`),
    icon: destination.icon,
    href: destination.to,
    current: pathname === destination.to,
  }));

  function onDockEdgeChange(dockEdge: DockEdge) {
    document.documentElement.setAttribute(axes.dockEdge.attribute, dockEdge);
    setLayout((current) => ({ ...current, dockEdge }));
  }

  return (
    <AppShell
      title={<h1 className="truncate font-display text-title">{t('app.name')}</h1>}
      skipToContentLabel={t('shell.skipToContent')}
      items={items}
      layout={layout}
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
