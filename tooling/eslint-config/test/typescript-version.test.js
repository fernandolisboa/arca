import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { arcaConfig } from '../index.js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));

describe('typescript-eslint', () => {
  it('loads TypeScript 6.0, not the workspace compiler', () => {
    const requireFromPlugin = createRequire(
      createRequire(import.meta.url).resolve('typescript-eslint'),
    );
    const { version } = requireFromPlugin('typescript/package.json');
    expect(version).toMatch(/^6\.0\./);
  });

  it('runs type-aware rules', async () => {
    const eslint = new ESLint({
      cwd: fixtures,
      overrideConfigFile: true,
      overrideConfig: arcaConfig({ rootDir: fixtures }),
    });
    const [result] = await eslint.lintFiles(['floating-promise.ts']);
    expect(result?.messages.map((message) => message.ruleId)).toContain(
      '@typescript-eslint/no-floating-promises',
    );
  });
});
