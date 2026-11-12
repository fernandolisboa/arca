import {
  Accessibility,
  ArrowRight,
  Bell,
  BookOpenCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Earth,
  FileText,
  Flag,
  House,
  KeyRound,
  LayoutGrid,
  List,
  LockKeyhole,
  LogOut,
  Network,
  Palette,
  PanelsTopLeft,
  Route,
  Settings,
  Sparkles,
  Star,
  TriangleAlert,
  UserPlus,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';

const icons = {
  home: House,
  family: UsersRound,
  countries: Earth,
  plan: Route,
  documents: FileText,
  settings: Settings,
  profile: UserRound,
  passkeys: KeyRound,
  appearance: Palette,
  layout: PanelsTopLeft,
  accessibility: Accessibility,
  knowledge: BookOpenCheck,
  notifications: Bell,
  help: CircleHelp,
  report: Flag,
  signOut: LogOut,
  chevron: ChevronRight,
  back: ChevronLeft,
  check: Check,
  close: X,
  copy: Copy,
  alert: TriangleAlert,
  vault: LockKeyhole,
  next: ArrowRight,
  ai: Sparkles,
  star: Star,
  cards: LayoutGrid,
  list: List,
  tree: Network,
  addPerson: UserPlus,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export const iconNames = Object.keys(icons) as readonly IconName[];

export interface IconProps {
  readonly name: IconName;
  /** Size in px; defaults to 20. */
  readonly size?: number;
  /** Set only when the icon carries meaning that no nearby text gives; otherwise (or empty) it is hidden. */
  readonly label?: string;
}

/** The only door to lucide-react (spec 0006, R5): a fixed set of names, `currentColor`, 2 px stroke. */
export function Icon({ name, size = 20, label }: IconProps) {
  const Glyph = icons[name];
  const a11y =
    label === undefined || label === ''
      ? { 'aria-hidden': true }
      : { role: 'img', 'aria-label': label, 'aria-hidden': false };
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      nonScalingStroke
      focusable={false}
      className="shrink-0"
      {...a11y}
    />
  );
}
