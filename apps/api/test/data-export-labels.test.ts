import { registry } from '@arca/db/registry';
import { createI18n } from '@arca/i18n';
import { describe, expect, it } from 'vitest';

describe('data export labels (spec 0004, R7 and R8)', () => {
  it('names every registry entry in the pt-BR catalog', async () => {
    const i18n = await createI18n();
    const missing = registry.entries
      .map(({ label }) => label)
      .filter((label) => typeof i18n.getResource('pt-BR', 'translation', label) !== 'string');
    expect(missing).toEqual([]);
  });
});
