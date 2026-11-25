import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { axes } from './theme/ids.js';
import { iconButtonClass } from './button.js';
import { Icon } from './icon.js';
import { Mark } from './mark.js';
import { MenuToggle } from './menu-toggle.js';
import { slideClass, useScrolledAway } from './shell/auto-hide.js';
import { Dock } from './shell/dock.js';
import { MenuPanel, type MenuGroup, type SignOut } from './shell/menu-panel.js';
import {
  NavLink,
  NavList,
  focusRing,
  navRowClass,
  menuToggleId,
  type DockEdge,
  type NavCollapse,
  type NavItem,
  type ShellLayout,
  type ShellLink,
} from './shell/nav.js';

export interface AppShellLabels {
  /** The accessible name of the navigation landmarks, such as "Navegação principal". */
  readonly navigation: string;
  readonly openMenu: string;
  readonly closeMenu: string;
  /** Group headings in the menu panel. */
  readonly navigationGroup: string;
  readonly accountGroup: string;
  /** The button that switches the bars and the side column to icons only, and back. */
  readonly collapseMenu: string;
  readonly expandMenu: string;
  /** The tooltip of the mark and the name. */
  readonly home: string;
}

export interface AppShellProps {
  /** Shown beside the mark in every bar. */
  readonly title: ReactNode;
  /** Where the mark and the name lead. */
  readonly homeHref: string;
  readonly skipToContentLabel: string;
  /** The navigation items whose page exists, in order. */
  readonly items: readonly NavItem[];
  /** The Settings entry, once its page exists: last in a dock, a gear in the top bar. */
  readonly settings?: NavItem;
  readonly signOut?: SignOut;
  readonly layout?: Partial<ShellLayout>;
  /** Called when the person drags the floating dock to another edge. */
  readonly onDockEdgeChange?: (edge: DockEdge) => void;
  /** Called from the collapse button in the top bar and the side column. */
  readonly onCollapseChange?: (collapse: NavCollapse) => void;
  readonly labels: AppShellLabels;
  readonly link: ShellLink;
  readonly children: ReactNode;
}

const mainId = 'main-content';
/** Tailwind's `md` breakpoint, where the wide layouts start. */
export const wideQuery = '(min-width: 48rem)';

const narrowMenuOf = (layout: ShellLayout) => layout.narrow === 'menu';
const wideMenuOf = (layout: ShellLayout) => layout.wide === 'menu';

const defaultLayout: ShellLayout = {
  wide: axes.navWide.default,
  narrow: axes.navNarrow.default,
  dockEdge: axes.dockEdge.default,
  collapse: axes.navCollapse.default,
  autoHide: axes.navAutoHide.default,
};

/*
 * Content clearance per layout, written out in full so Tailwind finds every class: the dock's size,
 * the floating dock's 14 px gap and the safe-area inset on the dock's side. A bottom dock's height
 * is also `--shell-bottom`, where `phoneBottomBarClass` sits.
 */
const narrowClearance = {
  menu: 'max-md:[--shell-bottom:env(safe-area-inset-bottom)]',
  'fixed-dock':
    'max-md:pb-(--shell-bottom) max-md:[--shell-bottom:calc(var(--spacing-dock)+env(safe-area-inset-bottom))]',
  'floating-dock': {
    bottom:
      'max-md:pb-(--shell-bottom) max-md:[--shell-bottom:calc(var(--spacing-dock)+14px+env(safe-area-inset-bottom))]',
    left: 'max-md:pl-[calc(5rem+14px+env(safe-area-inset-left))] max-md:[--shell-bottom:env(safe-area-inset-bottom)]',
    right:
      'max-md:pr-[calc(5rem+14px+env(safe-area-inset-right))] max-md:[--shell-bottom:env(safe-area-inset-bottom)]',
  },
} as const;

const sideClearance = {
  expanded: 'md:pl-[216px]',
  collapsed: 'md:pl-[72px]',
} as const;

const wideClearance = {
  menu: '',
  top: '',
  'floating-dock': {
    bottom: 'md:pb-[calc(var(--spacing-dock)+14px+env(safe-area-inset-bottom))]',
    left: 'md:pl-[calc(5rem+14px+env(safe-area-inset-left))]',
    right: 'md:pr-[calc(5rem+14px+env(safe-area-inset-right))]',
  },
} as const;

function wideClearanceOf(layout: ShellLayout): string {
  // An auto-hidden side column waits at the edge and slides over the page, so the page keeps the width.
  if (layout.wide === 'side') return layout.autoHide === 'on' ? '' : sideClearance[layout.collapse];
  const wide = wideClearance[layout.wide];
  return typeof wide === 'string' ? wide : wide[layout.dockEdge];
}

function clearance(layout: ShellLayout): string {
  const narrow = narrowClearance[layout.narrow];
  return [
    typeof narrow === 'string' ? narrow : narrow[layout.dockEdge],
    wideClearanceOf(layout),
  ].join(' ');
}

/** A collapsed dock is as tall as a touch target, and the page clears that smaller height. */
const collapsedDock =
  '[--spacing-dock-cell:var(--spacing-touch)] [--spacing-dock:calc(var(--spacing-touch)+0.5rem)]';

/** A flex element shown below 768 px, from 768 px, or at both widths. */
function at(narrow: boolean, wide: boolean): string {
  if (narrow && wide) return 'flex';
  return narrow ? 'flex md:hidden' : 'hidden md:flex';
}

/** The same for the floating dock, which is a flex container of its own. */
function dockAt(narrow: boolean, wide: boolean): string {
  if (narrow && wide) return '';
  return narrow ? 'md:hidden' : 'max-md:hidden';
}

/**
 * The page frame (spec 0006, R8): the navigation layout chosen for each width, switching at 768 px
 * with CSS only, clear of notches and home indicators, with a skip link for keyboard users.
 */
export function AppShell({
  title,
  homeHref,
  skipToContentLabel,
  items,
  settings,
  signOut,
  layout: chosen,
  onDockEdgeChange,
  onCollapseChange,
  labels,
  link: Link,
  children,
}: AppShellProps) {
  const layout = { ...defaultLayout, ...chosen };
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sideShown, setSideShown] = useState(false);
  const sideRef = useRef<HTMLElement | null>(null);
  const autoHide = layout.autoHide === 'on';
  const collapsed = layout.collapse === 'collapsed';
  const barsAway = useScrolledAway(autoHide) && !menuOpen;
  const leaveSide = useCallback(() => {
    setSideShown(false);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    toggleRef.current?.focus();
  }, []);
  const leaveMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  // When only one width uses the menu, crossing 768 px hides its button; close the panel with it.
  const menuAtOneWidth = narrowMenuOf(layout) !== wideMenuOf(layout);
  useEffect(() => {
    if (!menuOpen || !menuAtOneWidth) return;
    const wide = matchMedia(wideQuery);
    const close = () => {
      setMenuOpen(false);
    };
    wide.addEventListener('change', close);
    return () => {
      wide.removeEventListener('change', close);
    };
  }, [menuOpen, menuAtOneWidth]);

  // A press anywhere outside the auto-hidden side column, or a mouse over the page, sends it back.
  const sideOpenOverPage = autoHide && layout.wide === 'side' && sideShown;
  useEffect(() => {
    if (!sideOpenOverPage) return;
    const outside = (event: globalThis.PointerEvent) =>
      event.target instanceof Element &&
      sideRef.current?.contains(event.target) !== true &&
      event.target.closest('[data-side-edge]') === null;
    const pressAway = (event: globalThis.PointerEvent) => {
      if (outside(event)) setSideShown(false);
    };
    // A mouse sends it back once it moves over the page, wherever it entered from.
    const moveAway = (event: globalThis.PointerEvent) => {
      if (event.pointerType === 'mouse' && outside(event)) setSideShown(false);
    };
    document.addEventListener('pointerdown', pressAway);
    document.addEventListener('pointermove', moveAway);
    return () => {
      document.removeEventListener('pointerdown', pressAway);
      document.removeEventListener('pointermove', moveAway);
    };
  }, [sideOpenOverPage]);

  const withSettings = settings === undefined ? items : [...items, settings];
  const narrowMenu = narrowMenuOf(layout);
  const wideMenu = wideMenuOf(layout);
  const fixedDock = layout.narrow === 'fixed-dock';
  const narrowFloating = layout.narrow === 'floating-dock';
  const wideFloating = layout.wide === 'floating-dock';
  const side = layout.wide === 'side';
  const top = layout.wide === 'top';

  // At most one menu button exists: a width whose layout is not the menu has none.
  const menuToggle = (visibility: string) => (
    <div className={visibility}>
      <MenuToggle
        ref={toggleRef}
        id={menuToggleId}
        open={menuOpen}
        onToggle={() => {
          if (menuOpen) closeMenu();
          else setMenuOpen(true);
        }}
        controls={menuId}
        openLabel={labels.openMenu}
        closeLabel={labels.closeMenu}
      />
    </div>
  );

  const brandLink = (nameHidden: boolean, onNavigate?: () => void) => (
    <Link
      href={homeHref}
      title={labels.home}
      className={`flex min-h-touch ${nameHidden ? 'min-w-touch justify-center' : 'min-w-0'} items-center gap-2 rounded-control ${focusRing}`}
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
    >
      <Mark size={36} />
      <div className={nameHidden ? 'sr-only' : 'min-w-0'}>{title}</div>
    </Link>
  );

  const collapseLabel = collapsed ? labels.expandMenu : labels.collapseMenu;
  const collapseToggle = (withText: boolean) =>
    onCollapseChange !== undefined && (
      <button
        type="button"
        title={collapseLabel}
        onClick={() => {
          onCollapseChange(collapsed ? 'expanded' : 'collapsed');
        }}
        className={`${withText ? `${navRowClass} ${focusRing} text-small` : iconButtonClass} ${collapsed ? 'justify-center' : ''} text-muted transition-colors hover:bg-soft hover:text-ink`}
      >
        <Icon name={collapsed ? 'expandNav' : 'collapseNav'} />
        <span className={withText && !collapsed ? '' : 'sr-only'}>{collapseLabel}</span>
      </button>
    );

  const groups: MenuGroup[] = [
    { id: 'navigation', label: labels.navigationGroup, items },
    ...(settings === undefined
      ? []
      : [{ id: 'account', label: labels.accountGroup, items: [settings] }]),
  ];

  return (
    <div
      className={`flex min-h-dvh flex-col bg-bg ${collapsed ? collapsedDock : ''} pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] font-sans text-ink`}
    >
      <a
        href={`#${mainId}`}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:inline-flex focus:min-h-touch focus:items-center focus:rounded-control focus:bg-primary focus:px-4 focus:text-on-primary"
      >
        {skipToContentLabel}
      </a>

      <header
        data-hidden={barsAway ? '' : undefined}
        className={`sticky top-0 z-40 border-b border-line bg-surface pt-[env(safe-area-inset-top)] ${slideClass} ${barsAway ? '-translate-y-full has-[:focus-visible]:translate-y-0' : ''} ${side ? 'md:hidden' : ''}`}
      >
        <div className="@container mx-auto flex h-bar w-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          {brandLink(false, menuOpen ? leaveMenu : undefined)}
          {(narrowMenu || wideMenu) && menuToggle(at(narrowMenu, wideMenu))}
          {top && (
            <nav
              aria-label={labels.navigation}
              inert={menuOpen}
              className={`${at(false, true)} items-center gap-2`}
            >
              <NavList
                items={items}
                link={Link}
                place="bar"
                shape="row"
                direction="row"
                compact
                hideLabel={collapsed}
              />
              {settings !== undefined && (
                <NavLink item={settings} link={Link} place="bar" shape="row" iconOnly />
              )}
              {collapseToggle(false)}
            </nav>
          )}
        </div>
      </header>

      {side && autoHide && (
        <div
          aria-hidden="true"
          data-side-edge=""
          onPointerEnter={() => {
            setSideShown(true);
          }}
          onPointerDown={() => {
            setSideShown(true);
          }}
          className="fixed inset-y-0 left-0 z-10 hidden w-3 md:block"
        />
      )}
      {side && autoHide && !sideShown && (
        <div className="fixed top-1/2 left-0 z-10 hidden -translate-y-1/2 pointer-coarse:md:block">
          <button
            type="button"
            aria-label={labels.openMenu}
            title={labels.openMenu}
            onClick={() => {
              setSideShown(true);
            }}
            className={`${iconButtonClass} rounded-l-none border border-l-0 border-line bg-surface text-muted shadow-md shadow-ink/10`}
          >
            <Icon name="expandNav" />
          </button>
        </div>
      )}
      {side && (
        <nav
          ref={sideRef}
          aria-label={labels.navigation}
          inert={menuOpen}
          data-hidden={autoHide && !sideShown ? '' : undefined}
          className={`fixed inset-y-0 left-0 z-20 hidden ${collapsed ? 'w-[calc(72px+env(safe-area-inset-left))]' : 'w-[calc(216px+env(safe-area-inset-left))]'} flex-col gap-6 border-r border-line bg-surface pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[calc(0.75rem+env(safe-area-inset-left))] pr-3 md:flex ${slideClass} ${autoHide ? 'shadow-lg shadow-ink/15' : ''} ${autoHide && !sideShown ? '-translate-x-full has-[:focus-visible]:translate-x-0' : ''}`}
        >
          <div className={collapsed ? 'flex justify-center' : 'px-1'}>
            {brandLink(collapsed, autoHide ? leaveSide : undefined)}
          </div>
          <div className="flex-1">
            <NavList
              items={items}
              link={Link}
              place="side"
              shape="row"
              direction="column"
              hideLabel={collapsed}
              {...(autoHide ? { onNavigate: leaveSide } : {})}
            />
          </div>
          {settings !== undefined && (
            <NavLink
              item={settings}
              link={Link}
              place="side"
              shape="row"
              hideLabel={collapsed}
              {...(autoHide ? { onNavigate: leaveSide } : {})}
            />
          )}
          {collapseToggle(true)}
        </nav>
      )}

      <div
        inert={menuOpen}
        className={`flex flex-1 flex-col ${side ? 'md:pt-[env(safe-area-inset-top)]' : ''} ${clearance(layout)}`}
      >
        <main id={mainId} tabIndex={-1} className="mx-auto w-full flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>

      {fixedDock && (
        <Dock
          kind="fixed"
          edge="bottom"
          label={labels.navigation}
          items={withSettings}
          link={Link}
          inert={menuOpen}
          collapsed={collapsed}
          hidden={barsAway}
          className="md:hidden"
        />
      )}
      {(narrowFloating || wideFloating) && (
        <Dock
          kind="floating"
          edge={layout.dockEdge}
          label={labels.navigation}
          items={withSettings}
          link={Link}
          inert={menuOpen}
          collapsed={collapsed}
          hidden={barsAway}
          className={dockAt(narrowFloating, wideFloating)}
          {...(onDockEdgeChange === undefined ? {} : { onEdgeChange: onDockEdgeChange })}
        />
      )}

      {menuOpen && (
        <MenuPanel
          id={menuId}
          groups={groups}
          link={Link}
          toggle={toggleRef}
          onClose={closeMenu}
          onNavigate={leaveMenu}
          {...(signOut === undefined ? {} : { signOut })}
        />
      )}
    </div>
  );
}
