import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { arcaConfig } from '../index.js';

const fixtures = fileURLToPath(new URL('./fixtures/boundaries/', import.meta.url));

/**
 * @param {string} dir fixture directory, used as the package root
 * @param {import('../index.js').Kind[]} kinds
 * @param {string} file path relative to dir
 */
async function ruleIds(dir, kinds, file) {
  const rootDir = `${fixtures}${dir}`;
  const eslint = new ESLint({
    cwd: rootDir,
    overrideConfigFile: true,
    overrideConfig: arcaConfig({ rootDir, kinds }),
  });
  const [result] = await eslint.lintFiles([file]);
  return result?.messages.map((message) => message.ruleId) ?? [];
}

describe('domain', () => {
  it.each([
    ['node-import.ts', 'no-restricted-imports'],
    ['bare-builtin.ts', 'no-restricted-imports'],
    ['db-client.ts', 'no-restricted-imports'],
    ['drizzle.ts', 'no-restricted-imports'],
    ['http-client.ts', 'no-restricted-imports'],
    ['fetch.ts', 'no-restricted-globals'],
    ['console.ts', 'no-restricted-globals'],
    ['global-fetch.ts', 'no-restricted-properties'],
    ['clock-now.ts', 'no-restricted-syntax'],
    ['clock-new.ts', 'no-restricted-syntax'],
    ['global-clock.ts', 'no-restricted-syntax'],
    ['global-new-date.ts', 'no-restricted-syntax'],
    ['dynamic-builtin.ts', 'no-restricted-syntax'],
    ['dynamic-db-client.ts', 'no-restricted-syntax'],
    ['dynamic-computed.ts', 'no-restricted-syntax'],
  ])('%s fails with %s', async (file, rule) => {
    expect(await ruleIds('domain', ['domain'], file)).toContain(rule);
  });

  it('allows building a date from an argument', async () => {
    expect(await ruleIds('domain', ['domain'], 'allowed.ts')).toEqual([]);
  });
});

describe('client', () => {
  it.each([
    ['user-agent.ts', 'no-restricted-syntax'],
    ['user-agent-data.ts', 'no-restricted-syntax'],
    ['platform-computed.ts', 'no-restricted-syntax'],
    ['platform-destructure.ts', 'no-restricted-syntax'],
    ['window-destructure.ts', 'no-restricted-syntax'],
    ['dynamic-capacitor.ts', 'no-restricted-syntax'],
    ['capacitor.ts', 'no-restricted-imports'],
    ['tauri.ts', 'no-restricted-imports'],
    ['literal-string.tsx', 'i18next/no-literal-string'],
    ['conditional-hook.tsx', 'react-hooks/rules-of-hooks'],
    ['missing-key.tsx', '@eslint-react/no-missing-key'],
  ])('%s fails with %s', async (file, rule) => {
    expect(await ruleIds('client', ['client'], file)).toContain(rule);
  });

  it('allows text passed in from i18n', async () => {
    expect(await ruleIds('client', ['client'], 'prop-text.tsx')).not.toContain(
      'i18next/no-literal-string',
    );
  });
});

describe('web', () => {
  it.each([
    ['contract-root.ts', 'no-restricted-imports'],
    ['contract-server.ts', 'no-restricted-imports'],
    ['dynamic-contract-server.ts', 'no-restricted-syntax'],
  ])('%s fails with %s', async (file, rule) => {
    expect(await ruleIds('web', ['client', 'web'], file)).toContain(rule);
  });

  it('allows the client entry point', async () => {
    expect(await ruleIds('web', ['client', 'web'], 'contract-client.ts')).not.toContain(
      'no-restricted-imports',
    );
  });
});

describe('api', () => {
  it('forbids start() outside the helper', async () => {
    expect(await ruleIds('api', ['api'], 'src/start-elsewhere.ts')).toContain(
      'no-restricted-imports',
    );
  });

  it('forbids a dynamic import of workflow/api outside the helper', async () => {
    expect(await ruleIds('api', ['api'], 'src/dynamic-start.ts')).toContain('no-restricted-syntax');
  });

  it('allows start() in the helper', async () => {
    expect(await ruleIds('api', ['api'], 'src/workflows/start-workflow.ts')).not.toContain(
      'no-restricted-imports',
    );
  });
});

describe('contract', () => {
  it.each([
    ['src/routes/hono.ts', 'no-restricted-imports'],
    ['src/client/hono-openapi.ts', 'no-restricted-imports'],
    ['src/client/dynamic-hono.ts', 'no-restricted-syntax'],
  ])('%s fails with %s', async (file, rule) => {
    expect(await ruleIds('contract', ['contract'], file)).toContain(rule);
  });

  it('allows Hono in the server entry', async () => {
    expect(await ruleIds('contract', ['contract'], 'src/server/hono.ts')).toEqual([]);
  });
});

describe('package root', () => {
  it('forbids relative imports that leave the package', async () => {
    expect(await ruleIds('cross/pkg', [], 'src/outside.ts')).toContain(
      'arca/no-relative-import-outside-package',
    );
  });

  it('allows relative imports inside the package', async () => {
    expect(await ruleIds('cross/pkg', [], 'src/inside.ts')).toEqual([]);
  });
});

describe('database drivers', () => {
  it.each([
    ['api', ['api'], 'src/pg-pool.ts', 'no-restricted-imports'],
    ['api', ['api'], 'src/vercel-postgres.ts', 'no-restricted-imports'],
    ['db', ['db'], 'src/other.ts', 'no-restricted-imports'],
    ['db', ['db'], 'src/drizzle-driver.ts', 'no-restricted-imports'],
    ['db', ['db'], 'src/dynamic.ts', 'no-restricted-syntax'],
    ['api', ['api'], 'src/require-pg.ts', 'no-restricted-syntax'],
    ['api', ['api'], 'test/unit-pg.ts', 'no-restricted-imports'],
  ])('%s/%s fails with %s', async (dir, kinds, file, rule) => {
    expect(await ruleIds(dir, /** @type {import('../index.js').Kind[]} */ (kinds), file)).toContain(
      rule,
    );
  });

  it.each([
    ['db', ['db'], 'src/pool.ts'],
    ['db', ['db'], 'test/support.ts'],
    ['db', ['scripts'], 'src/other.ts'],
    ['api', ['api'], 'src/pg-core.ts'],
    ['api', ['api'], 'test/postgres/admin.ts'],
  ])('%s/%s allows a driver', async (dir, kinds, file) => {
    const rules = await ruleIds(dir, /** @type {import('../index.js').Kind[]} */ (kinds), file);
    expect(rules).not.toContain('no-restricted-imports');
    expect(rules).not.toContain('no-restricted-syntax');
  });
});
