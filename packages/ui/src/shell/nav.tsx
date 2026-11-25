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
  readonly id?: string;
  readonly href: string;
  readonly className: string;
  readonly 'aria-current'?: 'page';
  readonly 'aria-label'?: string;
  readonly title?: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}

/** The app's router link, so the shell navigates without a page load and without knowing the router. */
export type ShellLink = ComponentType<ShellLinkProps>;

export interface ShellLayout {
  readonly wide: AxisValue<'navWide'>;
  readonly narrow: AxisValue<'navNarrow'>;
  readonly dockEdge: AxisValue<'dockEdge'>;
  /** Icons only in the bars, the side column and the docks; the menu panel is unchanged. */
  readonly collapse: AxisValue<'navCollapse'>;
  /** The bars and docks slide away while the page scrolls down; the side column waits at its edge. */
  readonly autoHide: AxisValue<'navAutoHide'>;
}

export type DockEdge = ShellLayout['dockEdge'];
export type NavCollapse = ShellLayout['collapse'];

export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export const navRowClass = 'flex min-h-touch min-w-touch items-center gap-3 rounded-control px-3';

const shapes = {
  /** A row in a bar, the side column or the menu: icon beside the label. */
  row: navRowClass,
  /** A dock cell: icon over the label. */
  cell: 'flex min-h-dock-cell min-w-touch flex-1 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-caption',
} as const;

export type NavShape = keyof typeof shapes;

/** The copies of the navigation a layout may render; a link's id names its copy, so ids stay unique. */
const places = ['bar', 'side', 'dock', 'floating-dock', 'menu'] as const;

export type NavPlace = (typeof places)[number];

const navLinkId = (place: NavPlace, itemId: string) => `nav-${place}-${itemId}`;

export const menuToggleId = 'nav-menu-toggle';

/**
 * The ids that lead to a destination, in order of preference: its link in each copy of the
 * navigation, then the menu button, which is what shows while the link sits in the closed menu.
 */
export function navTargetIds(itemId: string): string[] {
  return [
    ...places.filter((place) => place !== 'menu').map((place) => navLinkId(place, itemId)),
    menuToggleId,
  ];
}

interface NavLinkProps {
  readonly item: NavItem;
  readonly link: ShellLink;
  readonly place: NavPlace;
  readonly shape: NavShape;
  /** Icon only, with the label as the accessible name (the top bar's gear). */
  readonly iconOnly?: boolean;
  /**
   * The label shows once the top bar is 64rem wide, which grows with the text size; narrower, it is
   * read but not shown, so the name and a full top bar fit.
   */
  readonly compact?: boolean;
  /** The collapsed navigation: the shape stays, the label is read and shown as a tooltip only. */
  readonly hideLabel?: boolean;
  readonly onNavigate?: () => void;
}

function labelClass(compact: boolean, hideLabel: boolean): string {
  if (hideLabel) return 'sr-only';
  return compact ? 'sr-only @5xl:not-sr-only @5xl:truncate' : 'max-w-full truncate';
}

export function NavLink({
  item,
  link: Link,
  place,
  shape,
  iconOnly = false,
  compact = false,
  hideLabel = false,
  onNavigate,
}: NavLinkProps) {
  const tone = item.current ? 'bg-soft text-primary' : 'text-ink hover:bg-soft';
  return (
    <Link
      id={navLinkId(place, item.id)}
      href={item.href}
      className={[
        iconOnly ? iconButtonClass : `${shapes[shape]} ${focusRing}`,
        hideLabel ? 'justify-center' : '',
        tone,
        'transition-colors',
      ].join(' ')}
      {...(item.current ? { 'aria-current': 'page' as const } : {})}
      {...(iconOnly ? { 'aria-label': item.label } : {})}
      {...(iconOnly || hideLabel ? { title: item.label } : {})}
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
    >
      <Icon name={item.icon} />
      {!iconOnly && <span className={labelClass(compact, hideLabel)}>{item.label}</span>}
    </Link>
  );
}

interface NavListProps {
  readonly items: readonly NavItem[];
  readonly link: ShellLink;
  readonly place: NavPlace;
  readonly shape: NavShape;
  readonly direction: 'row' | 'column';
  readonly compact?: boolean;
  readonly hideLabel?: boolean;
  readonly onNavigate?: () => void;
}

export function NavList({
  items,
  link,
  place,
  shape,
  direction,
  compact,
  hideLabel,
  onNavigate,
}: NavListProps) {
  return (
    <ul className={`flex gap-1 ${direction === 'row' ? 'flex-row' : 'flex-col'}`}>
      {items.map((item) => (
        <li key={item.id} className={shape === 'cell' ? 'flex min-w-0 flex-1' : undefined}>
          <NavLink
            item={item}
            link={link}
            place={place}
            shape={shape}
            {...(compact === undefined ? {} : { compact })}
            {...(hideLabel === undefined ? {} : { hideLabel })}
            {...(onNavigate === undefined ? {} : { onNavigate })}
          />
        </li>
      ))}
    </ul>
  );
}
