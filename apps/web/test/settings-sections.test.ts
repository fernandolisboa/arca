import { axisNames } from '@arca/ui/theme/ids';
import { createI18n } from '@arca/i18n';
import { describe, expect, it } from 'vitest';
import { sectionAxes, settingsSearch, settingsSections } from '../src/settings/sections.js';

describe('Settings sections', () => {
  it('puts every appearance axis in exactly one category', () => {
    const placed = Object.values(sectionAxes).flat();
    expect([...placed].sort()).toEqual([...axisNames].sort());
  });

  it('has a pt-BR label for every category', async () => {
    const i18n = await createI18n();
    const keys = settingsSections.map((section) => `settings.sections.${section}`);
    expect(keys.filter((key) => !i18n.exists(key))).toEqual([]);
  });

  it.each([
    [{ section: 'navigation' }, { section: 'navigation' }],
    [{ section: 'knowledge' }, { section: 'knowledge' }],
    [{ section: 'nope' }, {}],
    [{ section: ['account'] }, {}],
    [{}, {}],
  ])('reads %j from the address as %j', (search, expected) => {
    expect(settingsSearch(search)).toEqual(expected);
  });
});
