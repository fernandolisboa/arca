import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enforcedRows } from '../src/account/retention.js';

// RETENTION.md and the daily jobs say the same thing (spec 0004, R10).
const notMigratedYet = ['Pending document uploads', 'Notification messages', 'Vault envelopes'];

async function rowsForTheDailyJobs(): Promise<string[]> {
  const text = await readFile(join(import.meta.dirname, '../../../docs/RETENTION.md'), 'utf8');
  const ours = text.slice(text.indexOf('## In our systems'), text.indexOf('## At processors'));
  return ours
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Data |'))
    .map((line) => line.split(' | '))
    .filter(([, , enforcedBy = '']) => /daily cleanup job|inactivity job/i.test(enforcedBy))
    .map(([data = '']) => data.slice(2))
    .filter((data) => !notMigratedYet.some((prefix) => data.startsWith(prefix)));
}

describe('the retention schedule (spec 0004, R10)', () => {
  it('has a rule for every row the daily jobs enforce, and no rule without a row', async () => {
    const rows = await rowsForTheDailyJobs();
    expect(rows.length).toBeGreaterThan(0);
    for (const data of rows) {
      expect(
        enforcedRows.filter((rule) => data.startsWith(rule)),
        data,
      ).toHaveLength(1);
    }
    for (const rule of enforcedRows) {
      expect(
        rows.filter((data) => data.startsWith(rule)),
        rule,
      ).toHaveLength(1);
    }
  });
});
