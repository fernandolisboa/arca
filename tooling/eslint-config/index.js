import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import {
  client,
  contractSurface,
  contractSurfaceFiles,
  domain,
  restrictionRules,
  web,
  workflowStart,
  workflowStartHelper,
} from './boundaries.js';
import { noOwnerEnvironment } from './rules/no-owner-environment.js';
import { noRelativeImportOutsidePackage } from './rules/no-relative-import-outside-package.js';

/** Package kinds (spec 0001, R2) and the restrictions each one adds. */
const restrictionsByKind = {
  /** packages/domain: pure code, no I/O and no clock. */
  domain: [domain],
  /** packages/platform: browser globals; native APIs are allowed here and nowhere else. */
  browser: [],
  /** apps/web and packages/ui: no OS sniffing or native imports; React and i18n rules. */
  client: [client],
  /** apps/web: the API contract only through its client entry. */
  web: [web],
  /** apps/api: workflows start only through the shared helper. */
  api: [workflowStart],
  /** packages/api-contract: ./routes and ./client import no Hono (restricted per file below). */
  contract: [],
  /** tooling/scripts: the build scripts, the only code allowed to read the owner variables (R7). */
  scripts: [],
};

/** @typedef {keyof typeof restrictionsByKind} Kind */

const arcaPlugin = {
  meta: { name: '@arca/eslint-config' },
  rules: {
    'no-owner-environment': noOwnerEnvironment,
    'no-relative-import-outside-package': noRelativeImportOutsidePackage,
  },
};

/**
 * Shared flat config. Each package calls it from its own eslint.config.js with its directory and
 * the kinds that describe it (spec 0001, R2).
 *
 * @param {{ rootDir: string, kinds?: Kind[] }} options
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function arcaConfig({ rootDir, kinds = [] }) {
  const isClient = kinds.includes('client');
  const inBrowser = isClient || kinds.includes('browser');
  const restrictions = kinds.flatMap((kind) => restrictionsByKind[kind]);
  return tseslint.config(
    { ignores: ['dist/**', 'coverage/**'] },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        globals: kinds.includes('domain')
          ? globals.es2025
          : inBrowser
            ? globals.browser
            : globals.node,
        parserOptions: {
          projectService: { allowDefaultProject: ['*.config.js', '*.config.ts'] },
          tsconfigRootDir: rootDir,
        },
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      plugins: { arca: arcaPlugin },
      rules: {
        'arca/no-relative-import-outside-package': ['error', { rootDir }],
        'arca/no-owner-environment': kinds.includes('scripts') ? 'off' : 'error',
        ...restrictionRules(restrictions),
      },
    },
    restrictions.includes(workflowStart)
      ? {
          files: [workflowStartHelper],
          rules: {
            'no-restricted-imports': 'off',
            'no-restricted-syntax': 'off',
            ...restrictionRules(restrictions.filter((entry) => entry !== workflowStart)),
          },
        }
      : [],
    kinds.includes('contract')
      ? {
          files: contractSurfaceFiles,
          rules: restrictionRules([...restrictions, contractSurface]),
        }
      : [],
    isClient
      ? [
          {
            files: ['**/*.{ts,tsx}'],
            ...eslintReact.configs['strict-type-checked'],
          },
          reactHooks.configs.flat['recommended-latest'],
          {
            files: ['**/*.{ts,tsx}'],
            plugins: { i18next },
            rules: { 'i18next/no-literal-string': ['error', { mode: 'jsx-only' }] },
          },
        ]
      : [],
    {
      files: ['**/*.js'],
      extends: [tseslint.configs.disableTypeChecked],
    },
  );
}
