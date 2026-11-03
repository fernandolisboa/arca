import { describe, expect, it } from 'vitest';
import { parseCalendarDate } from '../../src/calendar/calendar-date.js';
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
    ],
    [
      'a rule change dated before an earlier one',
      [version(1, '2020-01-01'), version(2, '2019-01-01')],
      2,
    ],
    [
      'a rule change dated on a correction',
      [version(1, '2020-01-01'), version(2, '2021-01-01', 1), version(3, '2021-01-01')],
      3,
    ],
    ['a correction once the next version applies', [...history, version(3, '2022-01-01', 1)], 3],
    [
      'a correction on the start of the period before',
      [...history, version(3, '2020-01-01', 2)],
      3,
    ],
    ['a correction before the period before', [...history, version(3, '2019-06-01', 2)], 3],
    [
      'a correction older than an earlier correction of the same version',
      [...history, version(3, '2023-01-01', 2), version(4, '2022-06-01', 2)],
      4,
    ],
    [
      'a correction older than the latest correction, not only the one before',
      [
        ...history,
        version(3, '2023-01-01', 2),
        version(4, '2022-06-01', 2),
        version(5, '2022-09-01', 2),
      ],
      5,
    ],
  ])('refuses %s', (_, versions, number) => {
    expect(checkVersionOrder(versions).get(number)).toHaveLength(1);
  });
});
