import i18next, { type i18n } from 'i18next';
import ICU from 'i18next-icu';
import { ptBR } from './catalogs/pt-BR.js';

export const defaultLocale = 'pt-BR';

export const resources = { [defaultLocale]: { translation: ptBR } } as const;

export type Messages = typeof ptBR;

/** An instance from {@link createI18n}, for packages that render messages without React. */
export type I18n = i18n;

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: Messages };
  }
}

export interface I18nOptions {
  /** Called with the key whenever a message is missing, so tests and e2e can fail on it. */
  readonly onMissingKey?: (key: string) => void;
}

/** An i18next instance with ICU messages and only the pt-BR catalog (spec 0001, R5). */
export async function createI18n({ onMissingKey }: I18nOptions = {}): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.use(ICU).init({
    lng: defaultLocale,
    fallbackLng: false,
    resources,
    // React escapes rendered text.
    interpolation: { escapeValue: false },
    saveMissing: onMissingKey !== undefined,
    missingKeyHandler: (_locales, _namespace, key) => {
      onMissingKey?.(key);
    },
  });
  return instance;
}
