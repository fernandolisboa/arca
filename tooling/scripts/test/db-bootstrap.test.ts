import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderBootstrap, type RolePasswords } from '../src/db/bootstrap.ts';
import { buildTarget } from '../src/db/connection.ts';

const passwords: RolePasswords = {
  app_migrator: 'm'.repeat(32),
  app_api: 'a'.repeat(32),
  app_jobs: 'j'.repeat(32),
  app_auth: 'u'.repeat(32),
  app_audit: 'l'.repeat(32),
  app_backup: 'b'.repeat(32),
};
const template = [
  "ALTER ROLE app_migrator PASSWORD '{{app_migrator}}';",
  "ALTER ROLE app_api PASSWORD '{{app_api}}';",
  "ALTER ROLE app_jobs PASSWORD '{{app_jobs}}';",
  "ALTER ROLE app_auth PASSWORD '{{app_auth}}';",
  "ALTER ROLE app_audit PASSWORD '{{app_audit}}';",
  "ALTER ROLE app_backup PASSWORD '{{app_backup}}';",
].join('\n');

describe('renderBootstrap', () => {
  it('fills every placeholder with the password of its role', () => {
    expect(renderBootstrap(template, passwords)).toBe(
      [
        `ALTER ROLE app_migrator PASSWORD '${passwords.app_migrator}';`,
        `ALTER ROLE app_api PASSWORD '${passwords.app_api}';`,
        `ALTER ROLE app_jobs PASSWORD '${passwords.app_jobs}';`,
        `ALTER ROLE app_auth PASSWORD '${passwords.app_auth}';`,
        `ALTER ROLE app_audit PASSWORD '${passwords.app_audit}';`,
        `ALTER ROLE app_backup PASSWORD '${passwords.app_backup}';`,
      ].join('\n'),
    );
  });

  it.each([
    ['short', 'a'.repeat(31)],
    ['long', 'a'.repeat(129)],
    ['a quote', `${'a'.repeat(32)}'; DROP ROLE app_api; --`],
    ['a backslash', `${'a'.repeat(32)}\\`],
    ['a space', `${'a'.repeat(32)} `],
    ['non-ASCII', `${'a'.repeat(32)}é`],
  ])('refuses a password that is %s', (_case, password) => {
    expect(() => renderBootstrap(template, { ...passwords, app_api: password })).toThrow(
      'the app_api password must be 32 to 128 base64url characters',
    );
  });

  it('renders the real bootstrap.sql', async () => {
    const sql = await readFile(
      join(import.meta.dirname, '../../../packages/db/bootstrap.sql'),
      'utf8',
    );
    expect(renderBootstrap(sql, passwords)).not.toContain('{{');
  });

  it.each([
    [
      'a missing role',
      template.split('\n').slice(0, 4).join('\n'),
      'does not set the password of app_audit',
    ],
    ['a repeated role', `${template}\n${template}`, 'sets the password of app_migrator twice'],
    [
      'an unknown role',
      `${template}\nALTER ROLE app_stray PASSWORD '{{app_stray}}';`,
      'app_stray, which has no password',
    ],
    ['a malformed placeholder', `${template}\nSELECT '{{ app_api }}';`, 'malformed placeholder'],
  ])('refuses %s', (_case, sql, message) => {
    expect(() => renderBootstrap(sql, passwords)).toThrow(message);
  });
});

describe('buildTarget', () => {
  const credentials = { user: 'app_migrator', password: 'secret' };

  it('reads the unpooled host and database, and requires TLS off loopback', () => {
    expect(
      buildTarget(
        { PGHOST_UNPOOLED: 'ep-x.sa-east-1.aws.neon.tech', PGHOST: 'pooled', PGDATABASE: 'neondb' },
        credentials,
      ),
    ).toEqual({
      host: 'ep-x.sa-east-1.aws.neon.tech',
      port: 5432,
      database: 'neondb',
      ...credentials,
      ssl: true,
    });
    expect(
      buildTarget(
        { PGHOST_UNPOOLED: '127.0.0.1', PGPORT: '5433', PGDATABASE: 'arca' },
        credentials,
      ),
    ).toMatchObject({ port: 5433, ssl: false });
  });

  it.each([
    [{ PGDATABASE: 'neondb' }, 'PGHOST_UNPOOLED is not set'],
    [{ PGHOST_UNPOOLED: 'h' }, 'PGDATABASE is not set'],
    [{ PGHOST_UNPOOLED: 'h', PGDATABASE: 'd', PGPORT: 'x' }, 'PGPORT is not a port'],
  ])('refuses incomplete settings', (env, message) => {
    expect(() => buildTarget(env, credentials)).toThrow(message);
  });
});
