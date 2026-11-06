import type { ResolvedMode, ThemeId } from './ids.js';

/** Every key a palette defines (spec 0006, Color). */
export interface Palette {
  readonly bg: string;
  readonly surface: string;
  readonly ink: string;
  readonly muted: string;
  readonly line: string;
  readonly primary: string;
  readonly onPrimary: string;
  /** Eyebrows, link underlines and the current step: the warm detail of the paper theme. */
  readonly accent: string;
  readonly soft: string;
  readonly track: string;
  readonly second: string;
  readonly okBg: string;
  readonly okInk: string;
  readonly warnBg: string;
  readonly warnInk: string;
  readonly dangerBg: string;
  readonly dangerInk: string;
}

/** What `data-contrast="high"` changes; every other key keeps its value (spec 0006, High contrast). */
export interface HighContrast {
  readonly line: string;
  readonly second: string;
  readonly primary: string;
  readonly accent: string;
  readonly okInk: string;
  readonly warnInk: string;
  readonly dangerInk: string;
}

export type ByMode<T> = Readonly<Record<ResolvedMode, T>>;

const danger: ByMode<Pick<Palette, 'dangerBg' | 'dangerInk'>> = {
  light: { dangerBg: '#FBE3E0', dangerInk: '#9B1C1C' },
  dark: { dangerBg: '#3E1A19', dangerInk: '#FFB4A8' },
};

export const palettes: Readonly<Record<ThemeId, ByMode<Palette>>> = {
  paper: {
    light: {
      bg: '#FFFFFF',
      surface: '#FFFFFF',
      ink: '#1A1A1D',
      muted: '#5C5959',
      line: '#ECEBEA',
      primary: '#1A1A1D',
      onPrimary: '#FFFFFF',
      accent: '#945424',
      soft: '#F5F4F3',
      track: '#ECEBEA',
      second: '#A7A2A1',
      okBg: '#E9F6EC',
      okInk: '#166534',
      warnBg: '#FFFBEB',
      warnInk: '#945424',
      ...danger.light,
    },
    dark: {
      bg: '#141312',
      surface: '#1B1A18',
      ink: '#F3F1EE',
      muted: '#B5AFA9',
      line: '#2B2926',
      primary: '#F3F1EE',
      onPrimary: '#141312',
      accent: '#F2B866',
      soft: '#24221F',
      track: '#2B2926',
      second: '#78716C',
      okBg: '#12301F',
      okInk: '#86EFAC',
      warnBg: '#2A2114',
      warnInk: '#F2C47E',
      ...danger.dark,
    },
  },
  notebook: {
    light: {
      bg: '#FAF6EF',
      surface: '#FFFDF8',
      ink: '#2B2622',
      muted: '#6B5F55',
      line: '#E6DCCB',
      primary: '#A8461F',
      onPrimary: '#FFFFFF',
      accent: '#A8461F',
      soft: '#F1E8DA',
      track: '#EADFCD',
      second: '#8C7F73',
      okBg: '#E3EBD9',
      okInk: '#34491F',
      warnBg: '#F6DDCB',
      warnInk: '#7E3315',
      ...danger.light,
    },
    dark: {
      bg: '#1E1A17',
      surface: '#29231F',
      ink: '#F3EDE4',
      muted: '#C2B6A8',
      line: '#3D352E',
      primary: '#E58A60',
      onPrimary: '#1E1A17',
      accent: '#E58A60',
      soft: '#352D27',
      track: '#3D352E',
      second: '#9C8F82',
      okBg: '#2C3A22',
      okInk: '#BFD8A5',
      warnBg: '#45281A',
      warnInk: '#F4BE9F',
      ...danger.dark,
    },
  },
  serene: {
    light: {
      bg: '#F6F8F8',
      surface: '#FFFFFF',
      ink: '#14262B',
      muted: '#4A5F65',
      line: '#D9E2E4',
      primary: '#1D5B69',
      onPrimary: '#FFFFFF',
      accent: '#1D5B69',
      soft: '#E6EDEE',
      track: '#E6EDEE',
      second: '#8FA3A8',
      okBg: '#DDF1E6',
      okInk: '#145C36',
      warnBg: '#FCEFCF',
      warnInk: '#6B4A00',
      ...danger.light,
    },
    dark: {
      bg: '#0F1C20',
      surface: '#16272C',
      ink: '#E8F0F1',
      muted: '#A3B6BA',
      line: '#2A3F44',
      primary: '#6CC0D0',
      onPrimary: '#0F1C20',
      accent: '#6CC0D0',
      soft: '#1D3338',
      track: '#2A3F44',
      second: '#6F878C',
      okBg: '#173A2A',
      okInk: '#A6E2C1',
      warnBg: '#3D3115',
      warnInk: '#F5D58A',
      ...danger.dark,
    },
  },
  panel: {
    light: {
      bg: '#F4F5F7',
      surface: '#FFFFFF',
      ink: '#1B1F24',
      muted: '#5A6470',
      line: '#DDE1E6',
      primary: '#2457D6',
      onPrimary: '#FFFFFF',
      accent: '#2457D6',
      soft: '#E9ECF1',
      track: '#E9ECF1',
      second: '#9AA4B0',
      okBg: '#EAF6EF',
      okInk: '#17603A',
      warnBg: '#FDF0E6',
      warnInk: '#8A3A07',
      ...danger.light,
    },
    dark: {
      bg: '#111418',
      surface: '#1A1E24',
      ink: '#E9ECF0',
      muted: '#9AA4B0',
      line: '#2C323A',
      primary: '#7AA2FF',
      onPrimary: '#111418',
      accent: '#7AA2FF',
      soft: '#222831',
      track: '#2C323A',
      second: '#5D6672',
      okBg: '#173326',
      okInk: '#9FDDB9',
      warnBg: '#3A2414',
      warnInk: '#FFC49E',
      ...danger.dark,
    },
  },
};

/**
 * High-contrast overrides, chosen so every text pair reaches 7:1 and `line` and `second` reach
 * 3:1 against `bg` and `surface`; `muted` becomes `ink`. The contrast test checks them.
 */
export const highContrast: Readonly<Record<ThemeId, ByMode<HighContrast>>> = {
  paper: {
    light: {
      line: '#8E8986',
      second: '#8E8986',
      primary: '#1A1A1D',
      accent: '#7A4419',
      okInk: '#14532D',
      warnInk: '#7A4419',
      dangerInk: '#961819',
    },
    dark: {
      line: '#77716C',
      second: '#78716C',
      primary: '#F3F1EE',
      accent: '#F7CB8A',
      okInk: '#86EFAC',
      warnInk: '#F2C47E',
      dangerInk: '#FFB4A8',
    },
  },
  notebook: {
    light: {
      line: '#968E81',
      second: '#8C7F73',
      primary: '#882F04',
      accent: '#882F04',
      okInk: '#34491F',
      warnInk: '#7B3113',
      dangerInk: '#961819',
    },
    dark: {
      line: '#746C66',
      second: '#9C8F82',
      primary: '#FEA67E',
      accent: '#FEA67E',
      okInk: '#BFD8A5',
      warnInk: '#F4BE9F',
      dangerInk: '#FFB4A8',
    },
  },
  serene: {
    light: {
      line: '#8A9193',
      second: '#809398',
      primary: '#175563',
      accent: '#175563',
      okInk: '#125A34',
      warnInk: '#6B4A00',
      dangerInk: '#961819',
    },
    dark: {
      line: '#5D7176',
      second: '#6F878C',
      primary: '#77C9D8',
      accent: '#77C9D8',
      okInk: '#A6E2C1',
      warnInk: '#F5D58A',
      dangerInk: '#FFB4A8',
    },
  },
  panel: {
    light: {
      line: '#8B8E92',
      second: '#868F9A',
      primary: '#1542B9',
      accent: '#1542B9',
      okInk: '#155E38',
      warnInk: '#893906',
      dangerInk: '#961819',
    },
    dark: {
      line: '#636971',
      second: '#606975',
      primary: '#8BB3FF',
      accent: '#8BB3FF',
      okInk: '#9FDDB9',
      warnInk: '#FFC49E',
      dangerInk: '#FFB4A8',
    },
  },
};

/** The palette with high contrast applied. */
export function withHighContrast(palette: Palette, overrides: HighContrast): Palette {
  return { ...palette, ...overrides, muted: palette.ink };
}

/** The mark keeps one wood palette in every theme (spec 0006, Mark). */
export interface MarkPalette {
  readonly hull: string;
  readonly house: string;
  readonly roof: string;
  readonly ramp: string;
  readonly windows: string;
}

export const mark: ByMode<MarkPalette> = {
  light: {
    hull: '#805840',
    house: '#AE8546',
    roof: '#5B4033',
    ramp: '#AD7853',
    windows: '#F1DCA9',
  },
  dark: { hull: '#A67C63', house: '#E9CB88', roof: '#C7845F', ramp: '#C59770', windows: '#F5E2B8' },
};
