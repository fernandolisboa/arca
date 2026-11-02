import { describe, expect, it } from 'vitest';
import { apiDatabase } from '../src/database.js';
import type { Logger } from '../src/logger.js';

const silentLogger: Logger = { info: () => undefined, error: () => undefined };

describe('apiDatabase', () => {
  // Nothing listens on this port, so every check fails to connect.
  const unreachable = { host: '127.0.0.1', port: 1, database: 'arca', ssl: false };

  it('reports an unreachable database as a failed check, which health shows as unavailable', async () => {
    const database = apiDatabase(unreachable, 'test-only-password', silentLogger);
    try {
      await expect(database.checkDatabase()).rejects.toThrow();
      await expect(database.ready()).rejects.toThrow();
    } finally {
      await database.close();
    }
  });

  it('refuses a target without a host', () => {
    expect(() =>
      apiDatabase({ ...unreachable, host: '' }, 'test-only-password', silentLogger),
    ).toThrow('database host is missing');
  });
});
