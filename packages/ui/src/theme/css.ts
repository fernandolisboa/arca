import { type FontRole, fontPairs } from './fonts.js';
import { axes, type ResolvedMode, type ThemeId } from './ids.js';
import { motion } from './motion.js';
import { type Palette, highContrast, mark, palettes, withHighContrast } from './palettes.js';
import { radii, textSizes } from './shape.js';

/** Custom properties are prefixed so Tailwind's `@theme` names can point at them. */
const prefix = '--arca-';

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

type Declarations = Readonly<Record<string, string>>;

function block(selector: string, declarations: Declarations, indent = ''): string {
  const body = Object.entries(declarations)
    .map(([name, value]) => `${indent}  ${name}: ${value};`)
    .join('\n');
  return `${indent}${selector} {\n${body}\n${indent}}`;
}

function prefixed(values: Readonly<Record<string, string>>, group = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`${prefix}${group}${kebab(key)}`, value]),
  );
}

function paletteDeclarations(palette: Palette, mode: ResolvedMode): Declarations {
  return {
    'color-scheme': mode,
    ...prefixed({ ...palette }),
    ...prefixed({ ...mark[mode] }, 'mark-'),
  };
}

function highContrastDeclarations(theme: ThemeId, mode: ResolvedMode): Declarations {
  const palette = withHighContrast(palettes[theme][mode], highContrast[theme][mode]);
  const { muted, line, second, primary, okInk, warnInk, dangerInk } = palette;
  return prefixed({ muted, line, second, primary, okInk, warnInk, dangerInk });
}

const stack = (role: FontRole) => `'${role.family}', ${role.fallback}`;

function fontDeclarations(id: keyof typeof fontPairs): Declarations {
  const { display, body, numeric } = fontPairs[id];
  return prefixed({
    fontDisplay: stack(display),
    fontDisplayWeight: String(display.weight),
    fontBody: stack(body),
    fontBodyWeight: String(body.weight),
    fontNumeric: stack(numeric),
    fontNumericWeight: String(numeric.weight),
  });
}

const motionOff = prefixed({
  durationFast: '0ms',
  durationBase: '0ms',
  durationSlow: '0ms',
  staggerStep: '0ms',
});

const attr = (axis: keyof typeof axes, value: string) => `[${axes[axis].attribute}="${value}"]`;

/**
 * The whole of `themes.css` (spec 0006, R2), from the theme data. `:root` carries the defaults so a
 * bare `<html>` has every token; attribute blocks override them.
 */
export function renderThemesCss(): string {
  const defaults = {
    theme: axes.theme.default,
    mode: axes.mode.default,
    font: axes.font.default,
    corners: axes.corners.default,
  };
  const parts: string[] = [
    '/* Generated from packages/ui/src/theme by `pnpm --filter @arca/ui themes`. Do not edit. */',
    block(':root', {
      ...paletteDeclarations(palettes[defaults.theme][defaults.mode], defaults.mode),
      ...fontDeclarations(defaults.font),
      ...prefixed({ ...radii[defaults.corners] }, 'radius-'),
      ...prefixed({ ...motion }),
    }),
  ];

  for (const theme of axes.theme.values) {
    const light = paletteDeclarations(palettes[theme].light, 'light');
    const dark = paletteDeclarations(palettes[theme].dark, 'dark');
    const on = (mode: string) => `${attr('theme', theme)}${attr('mode', mode)}`;
    const high = attr('contrast', 'high');
    parts.push(
      block(`${on('light')},\n${on('system')}`, light),
      block(on('dark'), dark),
      `@media (prefers-color-scheme: dark) {\n${block(on('system'), dark, '  ')}\n}`,
      block(
        `${on('light')}${high},\n${on('system')}${high}`,
        highContrastDeclarations(theme, 'light'),
      ),
      block(`${on('dark')}${high}`, highContrastDeclarations(theme, 'dark')),
      `@media (prefers-color-scheme: dark) {\n${block(
        `${on('system')}${high}`,
        highContrastDeclarations(theme, 'dark'),
        '  ',
      )}\n}`,
    );
  }

  for (const font of axes.font.values)
    parts.push(block(attr('font', font), fontDeclarations(font)));
  for (const corners of axes.corners.values) {
    parts.push(block(attr('corners', corners), prefixed({ ...radii[corners] }, 'radius-')));
  }
  for (const size of axes.textSize.values) {
    parts.push(block(attr('textSize', size), { 'font-size': textSizes[size] }));
  }
  parts.push(
    block(attr('motion', 'off'), motionOff),
    `@media (prefers-reduced-motion: reduce) {\n${block(':root,\n  [data-motion]', motionOff, '  ')}\n}`,
  );
  return `${parts.join('\n\n')}\n`;
}
