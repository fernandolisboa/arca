import type { FontPairId } from './ids.js';

/**
 * Where a family's files come from: a Fontsource package and the file stem it uses. Variable
 * packages ship one `wght` file per subset; static packages one file per weight.
 */
export type FontSource =
  | {
      readonly kind: 'variable';
      readonly package: `@fontsource-variable/${string}`;
      readonly id: string;
    }
  | { readonly kind: 'static'; readonly package: `@fontsource/${string}`; readonly id: string };

export interface FontRole {
  /** The family name the generated `@font-face` rules declare. */
  readonly family: string;
  readonly source: FontSource;
  readonly fallback: 'serif' | 'sans-serif' | 'monospace';
  /** Weight used for this role. */
  readonly weight: number;
}

/** A pair (spec 0006, Type): display for titles and hero numbers, body text, table numbers. */
export interface FontPair {
  readonly display: FontRole;
  readonly body: FontRole;
  readonly numeric: FontRole;
}

const slug = (family: string) => family.toLowerCase().replaceAll(' ', '-');
const variable = (family: string): FontSource => ({
  kind: 'variable',
  package: `@fontsource-variable/${slug(family)}`,
  id: slug(family),
});
const fixed = (family: string): FontSource => ({
  kind: 'static',
  package: `@fontsource/${slug(family)}`,
  id: slug(family),
});

const sans = (family: string, weight: number, source = variable(family)): FontRole => ({
  family,
  source,
  fallback: 'sans-serif',
  weight,
});
const serif = (family: string, weight: number, source = variable(family)): FontRole => ({
  family,
  source,
  fallback: 'serif',
  weight,
});

export const fontPairs: Readonly<Record<FontPairId, FontPair>> = {
  retro: {
    display: serif('Young Serif', 400, fixed('Young Serif')),
    body: sans('Work Sans', 400),
    numeric: sans('Work Sans', 500),
  },
  expressive: {
    display: sans('Bricolage Grotesque', 700),
    body: sans('DM Sans', 400),
    numeric: sans('DM Sans', 500),
  },
  editorial: {
    display: serif('Fraunces', 600),
    body: sans('Source Sans 3', 400),
    numeric: sans('Source Sans 3', 500),
  },
  elegant: {
    display: serif('Instrument Serif', 400, fixed('Instrument Serif')),
    body: sans('Instrument Sans', 400),
    numeric: sans('Instrument Sans', 500),
  },
  geometric: {
    display: sans('Space Grotesk', 700),
    body: sans('Manrope', 400),
    numeric: sans('Space Grotesk', 500),
  },
  friendly: {
    display: sans('Nunito', 800),
    body: sans('Nunito', 400),
    numeric: sans('Nunito', 600),
  },
  readable: {
    display: sans('Atkinson Hyperlegible Next', 700),
    body: sans('Atkinson Hyperlegible Next', 400),
    numeric: sans('Atkinson Hyperlegible Next', 400),
  },
  clean: { display: sans('Inter', 700), body: sans('Inter', 400), numeric: sans('Inter', 500) },
  technical: {
    display: sans('IBM Plex Sans', 600),
    body: sans('IBM Plex Sans', 400),
    numeric: {
      family: 'IBM Plex Mono',
      source: fixed('IBM Plex Mono'),
      fallback: 'monospace',
      weight: 500,
    },
  },
};

/** Every family the pairs use, once each. */
export function fontFamilies(): readonly FontRole[] {
  const byFamily = new Map<string, FontRole>();
  for (const pair of Object.values(fontPairs)) {
    for (const role of [pair.display, pair.body, pair.numeric]) {
      if (!byFamily.has(role.family)) byFamily.set(role.family, role);
    }
  }
  return [...byFamily.values()];
}
