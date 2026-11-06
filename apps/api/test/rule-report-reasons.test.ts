import { ruleReportReasons } from '@arca/api-contract/routes';
import { ruleReportReasons as storedReasons } from '@arca/db/case-schema';
import { describe, expect, it } from 'vitest';

describe('rule report reasons (spec 0007, R8)', () => {
  it('are the ones the database accepts, so no valid report fails on insert', () => {
    expect([...ruleReportReasons]).toEqual([...storedReasons]);
  });
});
