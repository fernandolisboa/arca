import { createI18n } from '@arca/i18n';
import { axes, axisNames } from '@arca/ui/theme/ids';
import { describe, expect, it } from 'vitest';

describe('Settings labels', () => {
  it('has a pt-BR label for every axis and every value', async () => {
    const i18n = await createI18n();
    const keys = axisNames.flatMap((axis) => [
      `settings.appearance.${axis}.legend`,
      ...axes[axis].values.map((value) => `settings.appearance.${axis}.${value}`),
    ]);
    expect(keys.filter((key) => !i18n.exists(key))).toEqual([]);
  });
});
