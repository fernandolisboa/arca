import type { CornersId, TextSizeId } from './ids.js';

export interface Radii {
  readonly card: string;
  readonly control: string;
  readonly chip: string;
  readonly dock: string;
}

/** Corner sets (spec 0006, Shape, space and motion). */
export const radii: Readonly<Record<CornersId, Radii>> = {
  square: { card: '4px', control: '4px', chip: '4px', dock: '6px' },
  soft: { card: '16px', control: '8px', chip: '999px', dock: '18px' },
  round: { card: '28px', control: '999px', chip: '999px', dock: '999px' },
};

/**
 * Elevation. Borders carry a card's edge, so its shadow stays a hairline lift in every theme and
 * mode; on a white page it is what separates a card from the page together with the border.
 */
export const shadows = { card: '0 1px 2px 0 rgb(0 0 0 / 0.04)' } as const;

/** Root font size per text-size step, as a percentage of the browser's size. */
export const textSizes: Readonly<Record<TextSizeId, string>> = {
  '100': '100%',
  '112': '112%',
  '125': '125%',
  '150': '150%',
};
