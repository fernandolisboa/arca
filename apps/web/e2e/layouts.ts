import { axes as axisList, type AxisName } from '@arca/ui/theme/ids';
import { expect, type Page } from '@playwright/test';

/** One navigation layout, as the person would store it in Settings. */
export interface Layout {
  readonly narrow: string;
  readonly wide: string;
  readonly edge: string;
  readonly textSize?: string;
}

/** The defaults: the menu on phones and the top bar from 768 px. */
export const defaultLayout: Layout = { narrow: 'menu', wide: 'top', edge: 'bottom' };

export const narrowLayouts: readonly Layout[] = [
  defaultLayout,
  { narrow: 'fixed-dock', wide: 'top', edge: 'bottom' },
  { narrow: 'floating-dock', wide: 'top', edge: 'bottom' },
  { narrow: 'floating-dock', wide: 'top', edge: 'left' },
  { narrow: 'floating-dock', wide: 'top', edge: 'right' },
];

export const wideLayouts: readonly Layout[] = [
  defaultLayout,
  { narrow: 'menu', wide: 'menu', edge: 'bottom' },
  { narrow: 'menu', wide: 'side', edge: 'bottom' },
  { narrow: 'menu', wide: 'floating-dock', edge: 'bottom' },
  { narrow: 'menu', wide: 'floating-dock', edge: 'left' },
  { narrow: 'menu', wide: 'floating-dock', edge: 'right' },
];

/** Phone, tablet and desktop, each with the layouts that apply at that width (spec 0006, R11). */
export const sizes = [
  [390, narrowLayouts],
  [820, wideLayouts],
  [1280, wideLayouts],
] as const;

/** The shell switches layouts at 768 px. */
export const isWide = (width: number) => width >= 768;

export const usesMenu = (layout: Layout, wide: boolean) =>
  (wide ? layout.wide : layout.narrow) === 'menu';

export const layoutName = (layout: Layout) => `${layout.narrow} / ${layout.wide} / ${layout.edge}`;

/**
 * Stores the layout and any other axes as the person's choice, so the boot script applies them
 * before first paint, then opens the page and checks that every stored axis took effect: the
 * parser falls back to the defaults on an unknown value, which would let a test pass unchecked.
 */
export async function open(
  page: Page,
  layout: Layout,
  { path = '/', extra = {} }: { path?: string; extra?: Partial<Record<AxisName, string>> } = {},
) {
  const stored: Partial<Record<AxisName, string>> = {
    navNarrow: layout.narrow,
    navWide: layout.wide,
    dockEdge: layout.edge,
    textSize: layout.textSize ?? '100',
    ...extra,
  };
  await page.addInitScript((chosen) => {
    localStorage.setItem('arca.appearance', JSON.stringify({ v: 1, axes: chosen }));
  }, stored);
  await page.goto(path);
  for (const [axis, value] of Object.entries(stored)) {
    await expect(page.locator('html')).toHaveAttribute(axisList[axis as AxisName].attribute, value);
  }
}

/** How far the page scrolls sideways; 0 means no horizontal scroll. */
export const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
