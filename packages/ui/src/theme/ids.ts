/**
 * The ten appearance axes, their identifiers and built-in defaults (spec 0006, Defaults). This
 * module imports nothing, so the boot script and the build config can use it without React or CSS.
 */
export const axes = {
  theme: { attribute: 'data-theme', values: ['notebook', 'serene', 'panel'], default: 'notebook' },
  mode: { attribute: 'data-mode', values: ['dark', 'light', 'system'], default: 'dark' },
  font: {
    attribute: 'data-font',
    values: [
      'retro',
      'expressive',
      'editorial',
      'elegant',
      'geometric',
      'friendly',
      'readable',
      'clean',
      'technical',
    ],
    default: 'retro',
  },
  corners: { attribute: 'data-corners', values: ['square', 'soft', 'round'], default: 'square' },
  navWide: {
    attribute: 'data-nav-wide',
    values: ['menu', 'top', 'side', 'floating-dock'],
    default: 'menu',
  },
  navNarrow: {
    attribute: 'data-nav-narrow',
    values: ['menu', 'fixed-dock', 'floating-dock'],
    default: 'menu',
  },
  dockEdge: { attribute: 'data-dock-edge', values: ['bottom', 'left', 'right'], default: 'bottom' },
  textSize: { attribute: 'data-text-size', values: ['100', '112', '125', '150'], default: '100' },
  contrast: { attribute: 'data-contrast', values: ['standard', 'high'], default: 'standard' },
  motion: { attribute: 'data-motion', values: ['on', 'off'], default: 'on' },
} as const;

export type Axes = typeof axes;
export type AxisName = keyof Axes;
export type AxisValue<A extends AxisName> = Axes[A]['values'][number];

export type ThemeId = AxisValue<'theme'>;
export type FontPairId = AxisValue<'font'>;
export type CornersId = AxisValue<'corners'>;
export type TextSizeId = AxisValue<'textSize'>;
/** The mode a palette is drawn for; `system` resolves to one of these. */
export type ResolvedMode = Exclude<AxisValue<'mode'>, 'system'>;

export const axisNames = Object.keys(axes) as AxisName[];
