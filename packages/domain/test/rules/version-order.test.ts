import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
import { identityKey, selectVersion } from '../../src/rules/catalog.js';
import { type VersionDates, checkVersionOrder } from '../../src/rules/version-order.js';

const version = (number: number, effectiveFrom: string, corrects?: number): VersionDates => ({
  routeId: 'qm-work',
  number,
  effectiveFrom: parseCalendarDate(effectiveFrom),
  ...(corrects === undefined ? {} : { corrects }),
});

/** Version 1 from 2020 and version 2 from 2022, the usual history a correction lands in. */
const history = [version(1, '2020-01-01'), version(2, '2022-01-01')];

describe('checkVersionOrder', () => {
  it.each([
    ['rule changes in date order', history],
    ['a correction on the date of the version it fixes', [...history, version(3, '2022-01-01', 2)]],
    ['a correction that starts earlier', [...history, version(3, '2021-06-01', 2)]],
    ['a correction found late, inside the period', [...history, version(3, '2023-01-01', 2)]],
    ['a correction of the first version before it', [...history, version(3, '2019-01-01', 1)]],
    [
      'two corrections of one version in date order',
      [...history, version(3, '2022-01-01', 2), version(4, '2023-01-01', 2)],
    ],
    [
      'a later correction of a version a late correction fixed',
      [...history, version(3, '2023-01-01', 2), version(4, '2023-01-01', 2)],
    ],
    [
      'two corrections of one version on its date',
      [version(1, '2020-01-01'), version(2, '2020-01-01', 1), version(3, '2020-01-01', 1)],
    ],
    [
      'a correction after a chain of corrections of the same version, on its date',
      [
        ...history,
        version(3, '2022-01-01', 2),
        version(4, '2022-01-01', 3),
        version(5, '2023-01-01', 2),
      ],
    ],
    [
      'a correction from the start of a version its chain removes',
      [version(1, '2020-01-01'), version(2, '2022-01-01', 1), version(3, '2020-01-01', 2)],
    ],
    [
      'a correction of a version whose late correction was itself corrected',
      [
        version(1, '2020-01-01'),
        version(2, '2022-01-01', 1),
        version(3, '2021-01-01', 2),
        version(4, '2021-01-01', 1),
      ],
    ],
    [
      'a correction whose chain removes the first version, before it',
      [version(1, '2019-01-01'), version(2, '2020-01-01', 1), version(3, '2018-01-01', 2)],
    ],
    [
      'a correction of a correction',
      [...history, version(3, '2022-01-01', 2), version(4, '2022-01-01', 3)],
    ],
  ])('accepts %s', (_, versions) => {
    expect(checkVersionOrder(versions)).toEqual(new Map());
  });

  it.each([
    [
      'a rule change dated with an earlier one',
      [version(1, '2020-01-01'), version(2, '2020-01-01')],
      2,
      'A version that corrects nothing starts after every lower-numbered version',
    ],
    [
      'a rule change dated before an earlier one',
      [version(1, '2020-01-01'), version(2, '2019-01-01')],
      2,
      'A version that corrects nothing starts after every lower-numbered version',
    ],
    [
      'a rule change dated on a correction',
      [version(1, '2020-01-01'), version(2, '2021-01-01', 1), version(3, '2021-01-01')],
      3,
      'A version that corrects nothing starts after every lower-numbered version',
    ],
    [
      'a correction once the next version applies',
      [...history, version(3, '2022-01-01', 1)],
      3,
      'From 2022-01-01, selection would pick version 3 instead of version 2',
    ],
    [
      'a correction on the start of the period before',
      [...history, version(3, '2020-01-01', 2)],
      3,
      "A correction must start after the start of version 1's period, which it does not fix",
    ],
    [
      'a correction before the period before',
      [...history, version(3, '2019-06-01', 2)],
      3,
      "A correction must start after the start of version 1's period, which it does not fix",
    ],
    [
      'a correction older than an earlier correction of the same version',
      [...history, version(3, '2023-01-01', 2), version(4, '2022-06-01', 2)],
      4,
      'From 2023-01-01, selection would pick version 3 instead of version 4',
    ],
    [
      'a correction older than a correction of an earlier correction of the same version',
      [
        ...history,
        version(3, '2022-01-01', 2),
        version(4, '2023-01-01', 3),
        version(5, '2022-06-01', 2),
      ],
      5,
      'From 2023-01-01, selection would pick version 4 instead of version 5',
    ],
    [
      'a correction older than the latest correction, not only the one before',
      [
        ...history,
        version(3, '2022-06-01', 2),
        version(4, '2023-01-01', 2),
        version(5, '2022-09-01', 2),
      ],
      5,
      'From 2023-01-01, selection would pick version 4 instead of version 5',
    ],
    [
      'a correction that lets a superseded correction come back',
      [
        version(1, '2020-01-01'),
        version(2, '2022-01-01', 1),
        version(3, '2022-01-01', 1),
        version(4, '2021-01-01', 3),
      ],
      4,
      'From 2022-01-01, selection would pick version 2 instead of version 4',
    ],
  ])('refuses %s', (_, versions, number, message) => {
    expect(checkVersionOrder(versions)).toEqual(new Map([[number, [message]]]));
  });

  it('never lets an older version of a corrected group come back once a correction starts', () => {
    const dates = ['2020-01-01', '2021-01-01', '2022-01-01', '2023-01-01', '2024-01-01'];
    const history = fc
      .array(fc.tuple(fc.constantFrom(...dates), fc.nat(6)), { minLength: 1, maxLength: 6 })
      .map((specs) =>
        specs.map(([date, pick], index) =>
          version(index + 1, date, pick === 0 || pick > index ? undefined : pick),
        ),
      );
    fc.assert(
      fc.property(history, (versions) => {
        fc.pre(checkVersionOrder(versions).size === 0);
        const identities = versions.map(({ routeId, number, effectiveFrom, corrects }) => ({
          routeId,
          number,
          effectiveFrom,
          ...(corrects === undefined ? {} : { corrects }),
          status: 'open' as const,
          hash: '',
        }));
        const states = new Map(
          identities.map((identity) => [identityKey(identity), 'active' as const]),
        );
        const byNumber = new Map(versions.map((entry) => [entry.number, entry]));
        const reaches = (from: number | undefined, target: number): boolean => {
          for (let next = from, steps = 0; next !== undefined && steps < 10; steps += 1) {
            if (next === target) return true;
            next = byNumber.get(next)?.corrects;
          }
          return false;
        };
        for (const correction of versions) {
          const target = correction.corrects;
          if (target === undefined) continue;
          for (const date of dates) {
            if (date < correction.effectiveFrom) continue;
            const selected = selectVersion(identities, parseCalendarDate(date), states)?.identity;
            if (selected === undefined || selected.number >= correction.number) continue;
            expect(selected.number === target || reaches(selected.corrects, target)).toBe(false);
          }
        }
      }),
      { numRuns: 5000 },
    );
  });
});
