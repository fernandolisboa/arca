import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell, type AppShellProps } from '../src/app-shell.js';
import { nextScrolledAway } from '../src/shell/auto-hide.js';
import { nearestEdge } from '../src/shell/dock.js';
import {
  navTargetIds,
  type NavItem,
  type ShellLayout,
  type ShellLinkProps,
} from '../src/shell/nav.js';

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
    collapseMenu: 'Recolher menu',
    expandMenu: 'Expandir menu',
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
    const column = /<nav[^>]*class="[^"]*w-\[calc\(216px[^]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(column.indexOf('href="/"')).toBeGreaterThan(-1);
    expect(column.lastIndexOf('href=')).toBe(column.indexOf('href="/configuracoes"'));
    expect(html).toContain('md:pl-[216px]');
  });

  it('says how tall a bottom dock is, for a bar that sits above it', () => {
    expect(render({ narrow: 'fixed-dock' })).toContain(
      'max-md:[--shell-bottom:calc(var(--spacing-dock)+env(safe-area-inset-bottom))]',
    );
    expect(render({ narrow: 'floating-dock', dockEdge: 'bottom' })).toContain(
      'max-md:[--shell-bottom:calc(var(--spacing-dock)+14px+env(safe-area-inset-bottom))]',
    );
    expect(render({ narrow: 'floating-dock', dockEdge: 'left' })).toContain(
      'max-md:[--shell-bottom:env(safe-area-inset-bottom)]',
    );
  });

  it('keeps content clear of a floating dock on its edge', () => {
    expect(render({ narrow: 'floating-dock', dockEdge: 'left' })).toContain(
      'max-md:pl-[calc(5rem+14px+env(safe-area-inset-left))]',
    );
    expect(render({ wide: 'floating-dock', dockEdge: 'right' })).toContain(
      'md:pr-[calc(5rem+14px+env(safe-area-inset-right))]',
    );
  });

  it('gives every layout a unique target for each destination: its link or the menu button', () => {
    const layouts: Partial<ShellLayout>[] = [
      {},
      { wide: 'menu' },
      { wide: 'side', narrow: 'fixed-dock' },
      { wide: 'floating-dock', narrow: 'fixed-dock' },
      { wide: 'floating-dock', narrow: 'floating-dock' },
    ];
    for (const layout of layouts) {
      const ids = [...render(layout).matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
      expect(new Set(ids).size).toBe(ids.length);
      for (const item of [home, settings]) {
        expect(navTargetIds(item.id).some((id) => ids.includes(id))).toBe(true);
      }
    }
  });

  it('offers the drag grip only when the app saves the dock edge', () => {
    expect(render({ narrow: 'floating-dock' })).not.toContain('data-dock-grip');
    expect(render({ narrow: 'floating-dock' }, { onDockEdgeChange: () => undefined })).toContain(
      'data-dock-grip',
    );
  });
});

describe('collapsed navigation', () => {
  const save = { onCollapseChange: () => undefined };

  it('narrows the side column to icons, keeps every name readable and clears less of the page', () => {
    const html = render({ wide: 'side', collapse: 'collapsed' });
    const column = /<nav[^>]*class="[^"]*w-\[calc\(72px[^]*?<\/nav>/.exec(html)?.[0] ?? '';
    expect(column).toMatch(/href="\/"[^>]*title="Início"/);
    expect(column).toContain('<span class="sr-only">Início</span>');
    expect(html).toContain('md:pl-[72px]');
    expect(html).not.toContain('md:pl-[216px]');
  });

  it('shows the names in the top bar until collapsed', () => {
    expect(render({ wide: 'top' })).toContain('lg:not-sr-only');
    expect(render({ wide: 'top', collapse: 'collapsed' })).not.toContain('lg:not-sr-only');
  });

  it('shrinks a collapsed dock to the touch target', () => {
    expect(render({ narrow: 'fixed-dock', collapse: 'collapsed' })).toContain(
      '[--spacing-dock-cell:var(--spacing-touch)]',
    );
    expect(render({ narrow: 'fixed-dock' })).not.toContain('--spacing-dock-cell:');
  });

  it('offers the collapse button in the top bar and the side column once the app saves it', () => {
    expect(render({ wide: 'top' })).not.toContain('title="Recolher menu"');
    expect(render({ wide: 'top' }, save)).toContain('title="Recolher menu"');
    expect(render({ wide: 'side', collapse: 'collapsed' }, save)).toContain(
      'title="Expandir menu"',
    );
    expect(render({ wide: 'menu' }, save)).not.toContain('title="Recolher menu"');
  });
});

describe('auto-hidden navigation', () => {
  it('lays the side column over the page and leaves it waiting at the left edge', () => {
    const html = render({ wide: 'side', autoHide: 'on' });
    expect(html).toContain('data-side-edge');
    expect(html).toMatch(
      /<nav[^>]*data-hidden=""[^>]*-translate-x-full has-\[:focus-visible\]:translate-x-0/,
    );
    expect(html).not.toContain('md:pl-[216px]');
  });

  it('keeps everything in view with auto-hide off', () => {
    const html = render({ wide: 'side', narrow: 'fixed-dock' });
    expect(html).not.toContain('data-hidden');
    expect(html).not.toContain('data-side-edge');
  });

  it('gives touch screens a handle as large as a touch target to bring the side column back', () => {
    expect(render({ wide: 'side', autoHide: 'on' })).toMatch(
      /pointer-coarse:md:block"><button[^>]*aria-label="Abrir menu"[^>]*min-h-touch/,
    );
  });

  it.each([
    [100, 300, true],
    [300, 100, false],
    [300, 304, null],
    [300, 296, null],
    [200, 40, false],
    [0, 60, false],
  ] as const)('scrolling %i → %i leaves the bars away: %s', (from, to, next) => {
    expect(nextScrolledAway(from, to)).toBe(next);
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
