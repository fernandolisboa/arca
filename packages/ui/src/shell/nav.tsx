import type { ComponentType, ReactNode } from 'react';
import type { AxisValue } from '../theme/ids.js';
import { iconButtonClass } from '../button.js';
import { Icon, type IconName } from '../icon.js';

/** One destination. The app builds the list, so only pages that exist appear (spec 0006, R8). */
export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly href: string;
  readonly current: boolean;
}

export interface ShellLinkProps {
  readonly href: string;
  readonly className: string;
  readonly 'aria-current'?: 'page';
  readonly 'aria-label'?: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}

/** The app's router link, so the shell navigates without a page load and without knowing the router. */
export type ShellLink = ComponentType<ShellLinkProps>;

export interface ShellLayout {
  readonly wide: AxisValue<'navWide'>;
  readonly narrow: AxisValue<'navNarrow'>;
  readonly dockEdge: AxisValue<'dockEdge'>;
}

export type DockEdge = ShellLayout['dockEdge'];

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const shapes = {
  /** A row in a bar, the side column or the menu: icon beside the label. */
  row: 'flex min-h-touch items-center gap-3 rounded-control px-3',
  /** A dock cell: icon over the label. */
  cell: 'flex min-h-14 min-w-touch flex-1 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-caption',
} as const;

export type NavShape = keyof typeof shapes;

interface NavLinkProps {
  readonly item: NavItem;
  readonly link: ShellLink;
  readonly shape: NavShape;
  /** Icon only, with the label as the accessible name (the top bar's gear). */
  readonly iconOnly?: boolean;
  readonly onNavigate?: () => void;
}

export function NavLink({ item, link: Link, shape, iconOnly = false, onNavigate }: NavLinkProps) {
  const tone = item.current ? 'bg-soft text-primary' : 'text-ink hover:bg-soft';
  return (
    <Link
      href={item.href}
      className={`${iconOnly ? iconButtonClass : `${shapes[shape]} ${focusRing}`} ${tone} transition-colors`}
      {...(item.current ? { 'aria-current': 'page' as const } : {})}
      {...(iconOnly ? { 'aria-label': item.label } : {})}
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
    >
      <Icon name={item.icon} />
      {!iconOnly && <span className="max-w-full truncate">{item.label}</span>}
    </Link>
  );
}

interface NavListProps {
  readonly items: readonly NavItem[];
  readonly link: ShellLink;
  readonly shape: NavShape;
  readonly direction: 'row' | 'column';
  readonly onNavigate?: () => void;
}

export function NavList({ items, link, shape, direction, onNavigate }: NavListProps) {
  return (
    <ul className={`flex gap-1 ${direction === 'row' ? 'flex-row' : 'flex-col'}`}>
      {items.map((item) => (
        <li key={item.id} className={shape === 'cell' ? 'flex min-w-0 flex-1' : undefined}>
          <NavLink
            item={item}
            link={link}
            shape={shape}
            {...(onNavigate === undefined ? {} : { onNavigate })}
          />
        </li>
      ))}
    </ul>
  );
}
