import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { createI18n, defaultLocale, resources } from '../src/index.js';

function messages(tree: object, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] =>
    typeof value === 'string'
      ? [[`${prefix}${key}`, value]]
      : messages(value as object, `${prefix}${key}.`),
  );
}

const catalog = messages(resources[defaultLocale].translation);

describe('pt-BR catalog', () => {
  it.each(catalog)('%s is a valid ICU message', (_key, message) => {
    expect(() => new IntlMessageFormat(message, defaultLocale)).not.toThrow();
  });

  it('formats an ICU select', async () => {
    const i18n = await createI18n();
    expect(i18n.t('health.status', { status: 'ok' })).toBe('Tudo funcionando');
    expect(i18n.t('health.status', { status: 'degraded' })).toBe('Funcionando com limitações');
    expect(i18n.t('health.status', { status: 'other' })).toBe('Status desconhecido');
  });

  it('reports a missing key', async () => {
    const missing: string[] = [];
    const i18n = await createI18n({ onMissingKey: (key) => missing.push(key) });
    expect(i18n.t('app.name')).toBe('Arca');
    // An untyped call, as a key that is not in the catalog does not type-check.
    Reflect.apply(i18n.t, i18n, ['home.missing']);
    expect(missing).toEqual(['home.missing']);
  });
});
