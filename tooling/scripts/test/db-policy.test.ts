import { describe, expect, it } from 'vitest';
import { parseGuardPolicy } from '../src/db/policy.ts';

const empty = {
  materializedViews: [],
  foreignTables: [],
  securityDefinerFunctions: [],
  migrationExtensions: [],
  deferrableConstraints: [],
  notBackedUp: [],
};

describe('the guard policy', () => {
  it('reads the tables left without row-level security, each with its reason', () => {
    const policy = parseGuardPolicy({
      ...empty,
      tablesWithoutRowLevelSecurity: [{ table: 'auth.user', reason: 'Only app_auth reads it.' }],
    });
    expect(policy.tablesWithoutRowLevelSecurity).toEqual(['auth.user']);
  });

  it.each([
    ['a plain table name', 'auth.user'],
    ['a missing reason', { table: 'auth.user' }],
    ['an empty reason', { table: 'auth.user', reason: '' }],
    ['a missing table', { reason: 'Only app_auth reads it.' }],
    ['an empty table', { table: '', reason: 'Only app_auth reads it.' }],
  ])('refuses %s', (_label, entry) => {
    expect(() => parseGuardPolicy({ ...empty, tablesWithoutRowLevelSecurity: [entry] })).toThrow(
      'tablesWithoutRowLevelSecurity[0] must have a table and a reason',
    );
  });

  it('reads the tables the backup leaves out, and refuses one without a reason', () => {
    expect(
      parseGuardPolicy({
        ...empty,
        tablesWithoutRowLevelSecurity: [],
        notBackedUp: [{ table: 'auth.session', reason: 'Live tokens.' }],
      }).notBackedUp,
    ).toEqual(['auth.session']);
    expect(() =>
      parseGuardPolicy({
        ...empty,
        tablesWithoutRowLevelSecurity: [],
        notBackedUp: [{ table: 'auth.session' }],
      }),
    ).toThrow('notBackedUp[0] must have a table and a reason');
  });
});
