import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { axes } from './theme/ids.js';
import { Mark } from './mark.js';
import { MenuToggle } from './menu-toggle.js';
import { Dock } from './shell/dock.js';
import { MenuPanel, type MenuGroup, type SignOut } from './shell/menu-panel.js';
import {
  NavLink,
  NavList,
  type DockEdge,
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
}

export interface AppShellProps {
  /** Shown beside the mark in every bar. */
  readonly title: ReactNode;
  readonly skipToContentLabel: string;
  /** The navigation items whose page exists, in order. */
  readonly items: readonly NavItem[];
  /** The Settings entry, once its page exists: last in a dock, a gear in the top bar. */
  readonly settings?: NavItem;
  readonly signOut?: SignOut;
  readonly layout?: Partial<ShellLayout>;
  /** Called when the person drags the floating dock to another edge. */
  readonly onDockEdgeChange?: (edge: DockEdge) => void;
  readonly labels: AppShellLabels;
  readonly link: ShellLink;
  readonly children: ReactNode;
}

const mainId = 'main-content';
/** Tailwind's `md` breakpoint, where the wide layouts start. */
const wideQuery = '(min-width: 48rem)';

const narrowMenuOf = (layout: ShellLayout) => layout.narrow === 'menu';
const wideMenuOf = (layout: ShellLayout) => layout.wide === 'menu';

const defaultLayout: ShellLayout = {
  wide: axes.navWide.default,
  narrow: axes.navNarrow.default,
  dockEdge: axes.dockEdge.default,
};

/*
 * Content clearance per layout, written out in full so Tailwind finds every class: the dock's size,
 * the floating dock's 14 px gap and the safe-area inset on the dock's side.
 */
const narrowClearance = {
  menu: '',
  'fixed-dock': 'max-md:pb-[calc(4rem+env(safe-area-inset-bottom))]',
  'floating-dock': {
    bottom: 'max-md:pb-[calc(4rem+14px+env(safe-area-inset-bottom))]',
    left: 'max-md:pl-[calc(5rem+14px+env(safe-area-inset-left))]',
    right: 'max-md:pr-[calc(5rem+14px+env(safe-area-inset-right))]',
  },
} as const;

const wideClearance = {
  menu: '',
  top: '',
  side: 'md:pl-[216px]',
  'floating-dock': {
    bottom: 'md:pb-[calc(4rem+14px+env(safe-area-inset-bottom))]',
    left: 'md:pl-[calc(5rem+14px+env(safe-area-inset-left))]',
    right: 'md:pr-[calc(5rem+14px+env(safe-area-inset-right))]',
  },
} as const;

function clearance(layout: ShellLayout): string {
  const narrow = narrowClearance[layout.narrow];
  const wide = wideClearance[layout.wide];
  return [
    typeof narrow === 'string' ? narrow : narrow[layout.dockEdge],
    typeof wide === 'string' ? wide : wide[layout.dockEdge],
  ].join(' ');
}

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
  skipToContentLabel,
  items,
  settings,
  signOut,
  layout: chosen,
  onDockEdgeChange,
  labels,
  link,
  children,
}: AppShellProps) {
  const layout = { ...defaultLayout, ...chosen };
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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

  const brand = (
    <div className="flex min-w-0 items-center gap-2">
      <Mark size={36} />
      <div className="min-w-0">{title}</div>
    </div>
  );

  const groups: MenuGroup[] = [
    { id: 'navigation', label: labels.navigationGroup, items },
    ...(settings === undefined
      ? []
      : [{ id: 'account', label: labels.accountGroup, items: [settings] }]),
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-bg pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] font-sans text-ink">
      <a
        href={`#${mainId}`}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:inline-flex focus:min-h-touch focus:items-center focus:rounded-control focus:bg-primary focus:px-4 focus:text-on-primary"
      >
        {skipToContentLabel}
      </a>

      <header
        className={`sticky top-0 z-40 border-b border-line bg-surface pt-[env(safe-area-inset-top)] ${side ? 'md:hidden' : ''}`}
      >
        <div className="mx-auto flex h-bar w-full max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
          {brand}
          {(narrowMenu || wideMenu) && menuToggle(at(narrowMenu, wideMenu))}
          {top && (
            <nav
              aria-label={labels.navigation}
              inert={menuOpen}
              className={`${at(false, true)} items-center gap-2`}
            >
              <NavList items={items} link={link} shape="row" direction="row" compact />
              {settings !== undefined && (
                <NavLink item={settings} link={link} shape="row" iconOnly />
              )}
            </nav>
          )}
        </div>
      </header>

      {side && (
        <nav
          aria-label={labels.navigation}
          inert={menuOpen}
          className="fixed inset-y-0 left-0 z-20 hidden w-[216px] flex-col gap-6 border-r border-line bg-surface pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[calc(0.75rem+env(safe-area-inset-left))] pr-3 md:flex"
        >
          <div className="px-1">{brand}</div>
          <div className="flex-1">
            <NavList items={items} link={link} shape="row" direction="column" />
          </div>
          {settings !== undefined && <NavLink item={settings} link={link} shape="row" />}
        </nav>
      )}

      <div
        inert={menuOpen}
        className={`flex flex-1 flex-col ${side ? 'md:pt-[env(safe-area-inset-top)]' : ''} ${clearance(layout)}`}
      >
        <main
          id={mainId}
          tabIndex={-1}
          className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6"
        >
          {children}
        </main>
      </div>

      {fixedDock && (
        <Dock
          kind="fixed"
          edge="bottom"
          label={labels.navigation}
          items={withSettings}
          link={link}
          inert={menuOpen}
          className="md:hidden"
        />
      )}
      {(narrowFloating || wideFloating) && (
        <Dock
          kind="floating"
          edge={layout.dockEdge}
          label={labels.navigation}
          items={withSettings}
          link={link}
          inert={menuOpen}
          className={dockAt(narrowFloating, wideFloating)}
          {...(onDockEdgeChange === undefined ? {} : { onEdgeChange: onDockEdgeChange })}
        />
      )}

      {menuOpen && (
        <MenuPanel
          id={menuId}
          groups={groups}
          link={link}
          toggle={toggleRef}
          onClose={closeMenu}
          onNavigate={leaveMenu}
          {...(signOut === undefined ? {} : { signOut })}
        />
      )}
    </div>
  );
}
