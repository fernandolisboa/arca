import { RuleTester } from 'eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import { arcaConfig } from '../index.js';
import { noOwnerEnvironment } from '../rules/no-owner-environment.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.afterAll = afterAll;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    sourceType: 'module',
    globals: globals.node,
  },
});

/** @param {string} code @param {string} messageId */
const invalid = (code, messageId) => ({ code, errors: [{ messageId }] });

tester.run('no-owner-environment', noOwnerEnvironment, {
  valid: [
    "const password = process.env['ARCA_DB_API_PASSWORD'];",
    'const level = process.env.LOG_LEVEL;',
    "process.env['ARCA_FLAG'] = '1';",
    'process.stdout.write("x");',
    'const { argv } = process;',
    "if (typeof process !== 'undefined') {}",
    "import process from 'node:process'; const flag = process.env['ARCA_FLAG'];",
    "import { argv } from 'node:process'; argv.slice(2);",
    'function local(process) { return process.env.PGUSER; }',
    "const port = globalThis.process.env['PORT'];",
    "import { loadEnv } from 'vite'; const env = loadEnv(mode, root);",
    "import { loadEnv } from 'vite'; const env = loadEnv(mode, root, 'VITE_');",
    "import { loadEnv } from 'vite'; const env = loadEnv(mode, root, ['VITE_', 'VITE_PUBLIC_']);",
  ],
  invalid: [
    invalid("const user = process.env['PGUSER'];", 'owner'),
    invalid('const url = process.env.DATABASE_URL;', 'owner'),
    invalid('const url = process.env.DATABASE_URL_UNPOOLED;', 'owner'),
    invalid('const host = process.env.PGHOST_UNPOOLED;', 'owner'),
    invalid("const url = process.env['POSTGRES_PRISMA_URL'];", 'owner'),
    invalid('const id = process.env.NEON_PROJECT_ID;', 'owner'),
    invalid('const user = process?.env?.PGUSER;', 'owner'),
    invalid('const user = process.env!.PGUSER;', 'owner'),
    invalid('const user = globalThis.process.env.PGPASSWORD;', 'owner'),
    invalid("import process from 'node:process'; const u = process.env.PGUSER;", 'owner'),
    invalid("import { env } from 'node:process'; const u = env.PGUSER;", 'owner'),
    invalid("import * as proc from 'process'; const u = proc.env.PGUSER;", 'owner'),
    invalid("const name = 'PGUSER'; const value = process.env[name];", 'indirect'),
    invalid('const key = `PG${"USER"}`; const value = process.env[`PG${key}`];', 'indirect'),
    invalid('const { PGUSER } = process.env;', 'indirect'),
    invalid('const { env } = process;', 'indirect'),
    invalid('const { ...rest } = process;', 'indirect'),
    invalid('const all = { ...process.env };', 'indirect'),
    invalid('connect(process.env);', 'indirect'),
    invalid('const env = process.env;', 'indirect'),
    invalid('const values = Object.values(process.env);', 'indirect'),
    invalid("const has = 'PGUSER' in process.env;", 'indirect'),
    invalid('const env = process.env as Record<string, string>;', 'indirect'),
    invalid("const env = process['e' + 'nv'];", 'indirect'),
    invalid("import { env } from 'node:process'; read(env);", 'indirect'),
    invalid('read(process);', 'processValue'),
    invalid('const p = process;', 'processValue'),
    invalid("const value = Reflect.get(process, 'env');", 'processValue'),
    invalid("const { env } = await import('node:process');", 'processModule'),
    invalid("export { env } from 'node:process';", 'processModule'),
    invalid("export * from 'process';", 'processModule'),
    invalid("import p = require('node:process');", 'processModule'),
    invalid("const p = require('process');", 'processModule'),
    invalid(
      "import { createRequire } from 'node:module'; const u = createRequire(import.meta.url)('node:process').env.PGUSER;",
      'processModule',
    ),
    invalid("import { loadEnv } from 'vite'; const env = loadEnv(mode, root, '');", 'loadEnv'),
    invalid(
      "import { loadEnv } from 'vite'; const env = loadEnv(mode, root, ['VITE_', '']);",
      'loadEnv',
    ),
  ],
});

describe('arcaConfig', () => {
  /** @param {import('../index.js').Kind[]} kinds */
  const level = (kinds) =>
    arcaConfig({ rootDir: import.meta.dirname, kinds })
      .map((entry) => entry.rules?.['arca/no-owner-environment'])
      .filter((value) => value !== undefined)
      .at(-1);

  it('applies the rule to every package kind except the build scripts', () => {
    for (const kind of /** @type {const} */ ([
      'domain',
      'browser',
      'client',
      'web',
      'api',
      'contract',
    ])) {
      expect(level([kind])).toBe('error');
    }
    expect(level([])).toBe('error');
    expect(level(['scripts'])).toBe('off');
  });
});
