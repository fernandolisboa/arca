import type { AxisName } from '@arca/ui/theme/ids';
import type { IconName } from '@arca/ui';

/** The Settings page's categories, in menu order. */
export const settingsSections = [
  'appearance',
  'navigation',
  'accessibility',
  'account',
  'knowledge',
  'help',
] as const;

export type SettingsSection = (typeof settingsSections)[number];

export const sectionIcons = {
  appearance: 'appearance',
  navigation: 'layout',
  accessibility: 'accessibility',
  account: 'profile',
  knowledge: 'knowledge',
  help: 'help',
} as const satisfies Record<SettingsSection, IconName>;

/** Each appearance axis lives in exactly one category; the test checks none is left out. */
export const sectionAxes = {
  appearance: ['theme', 'mode', 'font', 'corners'],
  navigation: ['navNarrow', 'navWide', 'dockEdge'],
  accessibility: ['textSize', 'contrast', 'motion'],
} as const satisfies Partial<Record<SettingsSection, readonly AxisName[]>>;

export type AxisSection = keyof typeof sectionAxes;

export function isSettingsSection(value: unknown): value is SettingsSection {
  return settingsSections.some((section) => section === value);
}

/** The `?section=` search parameter; anything unknown falls back to the first category. */
export function settingsSearch(search: Record<string, unknown>): { section?: SettingsSection } {
  const section = search['section'];
  return isSettingsSection(section) ? { section } : {};
}
