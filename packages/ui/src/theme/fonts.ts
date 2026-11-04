import type { FontPairId } from './ids.js';

export interface FontRole {
  /** The family name the generated `@font-face` rules declare. */
  readonly family: string;
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

const sans = (family: string, weight: number): FontRole => ({
  family,
  fallback: 'sans-serif',
  weight,
});
const serif = (family: string, weight: number): FontRole => ({ family, fallback: 'serif', weight });

export const fontPairs: Readonly<Record<FontPairId, FontPair>> = {
  retro: {
    display: serif('Young Serif', 400),
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
    display: serif('Instrument Serif', 400),
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
    numeric: { family: 'IBM Plex Mono', fallback: 'monospace', weight: 500 },
  },
};
