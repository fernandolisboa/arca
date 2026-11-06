import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell, type AppShellProps } from '../src/app-shell.js';
import { nearestEdge } from '../src/shell/dock.js';
import type { NavItem, ShellLayout, ShellLinkProps } from '../src/shell/nav.js';

function Anchor({ href, className, children, ...rest }: ShellLinkProps) {
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  );
}

const home: NavItem = { id: 'home', label: 'Início', icon: 'home', href: '/', current: true };
const settings: NavItem = {
  id: 'settings',
  label: 'Configurações',
  icon: 'settings',
  href: '/configuracoes',
  current: false,
};
const text = {
  title: 'Arca',
  skip: 'Pular para o conteúdo',
  labels: {
    navigation: 'Navegação principal',
    openMenu: 'Abrir menu',
    closeMenu: 'Fechar menu',
    navigationGroup: 'Navegar',
    accountGroup: 'Sua conta',
  },
};

function render(layout: Partial<ShellLayout>, extra: Partial<AppShellProps> = {}) {
  return renderToStaticMarkup(
    <AppShell
      title={text.title}
      skipToContentLabel={text.skip}
      items={[home]}
      settings={settings}
      layout={layout}
      labels={text.labels}
      link={Anchor}
      {...extra}
    >
      {text.title}
    </AppShell>,
  );
}

const count = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].length;

describe('AppShell', () => {
  it('shows the top bar on wide screens and the menu button on phones by default', () => {
    const html = render({});
    expect(count(html, /aria-label="Abrir menu"/g)).toBe(1);
    expect(html).toMatch(/href="\/configuracoes"[^>]*aria-label="Configurações"/);
  });

  it('shows only the menu button in the menu layout, with the mark and a skip link', () => {
    const html = render({ wide: 'menu' });
    expect(count(html, /aria-label="Abrir menu"/g)).toBe(1);
    expect(html).not.toContain('<nav');
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('fill-(--arca-mark-hull)');
  });

  it('puts the Settings entry last in a dock, after the items', () => {
    const html = render({ narrow: 'fixed-dock' });
    const dock = /<nav[^>]*data-dock="fixed"[^]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(dock.indexOf('href="/"')).toBeLessThan(dock.indexOf('href="/configuracoes"'));
    expect(dock).toMatch(/href="\/"[^>]*aria-current="page"/);
    expect(dock).toContain('md:hidden');
  });

  it('gives the top bar a gear named by its label', () => {
    const html = render({ wide: 'top' });
    expect(html).toMatch(/href="\/configuracoes"[^>]*aria-label="Configurações"/);
  });

  it('renders the side column with the Settings entry at its foot', () => {
    const html = render({ wide: 'side' });
    const column = /<nav[^>]*class="[^"]*w-\[216px\][^]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(column.indexOf('href="/"')).toBeGreaterThan(-1);
    expect(column.lastIndexOf('href=')).toBe(column.indexOf('href="/configuracoes"'));
    expect(html).toContain('md:pl-[216px]');
  });

  it('keeps content clear of a floating dock on its edge', () => {
    expect(render({ narrow: 'floating-dock', dockEdge: 'left' })).toContain(
      'max-md:pl-[calc(5rem+14px+env(safe-area-inset-left))]',
    );
    expect(render({ wide: 'floating-dock', dockEdge: 'right' })).toContain(
      'md:pr-[calc(5rem+14px+env(safe-area-inset-right))]',
    );
  });

  it('offers the drag grip only when the app saves the dock edge', () => {
    expect(render({ narrow: 'floating-dock' })).not.toContain('data-dock-grip');
    expect(render({ narrow: 'floating-dock' }, { onDockEdgeChange: () => undefined })).toContain(
      'data-dock-grip',
    );
  });
});

describe('nearestEdge', () => {
  it.each([
    [200, 790, 'bottom'],
    [10, 400, 'left'],
    [380, 400, 'right'],
    [10, 795, 'bottom'],
  ] as const)('snaps (%i, %i) to %s', (x, y, edge) => {
    expect(nearestEdge(x, y, 390, 800)).toBe(edge);
  });
});
