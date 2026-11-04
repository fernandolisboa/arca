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
  credentialReader,
  credentialRows,
  databaseDriverFiles,
  databaseDrivers,
  databaseTestFiles,
  knowledgeCatalogReaders,
  knowledgeRuntimeFiles,
  pureRuntime,
  rawCatalog,
  reproductionLookup,
  reproductionLookupFiles,
  reproductionReexport,
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
  domain: [pureRuntime],
  /** packages/telemetry: runs in the API and in the browser, so no I/O and no host globals. */
  telemetry: [pureRuntime],
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
  /** packages/db: the role pool, the one place a database driver is imported (R7). */
  db: [],
  /** tooling/scripts: the build scripts, the only code allowed to read the owner variables (R7). */
  scripts: [],
  /** packages/knowledge: only its entry points read the built catalog; `src` is pure (below). */
  knowledge: [rawCatalog],
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
  const isScripts = kinds.includes('scripts');
  const restrictions = [
    ...kinds.flatMap((kind) => restrictionsByKind[kind]),
    ...(isScripts ? [] : [databaseDrivers]),
    ...(kinds.includes('db') ? [] : [credentialRows]),
    reproductionLookup,
  ];
  /** @typedef {import('./boundaries.js').Restrictions} Restrictions */
  /**
   * Rules for a group of files, replacing the package-wide ones. ESLint keeps the last block that
   * sets a rule, so groups must not overlap. Inside knowledge `src` the later, stricter blocks win:
   * the catalog readers keep the pure rules, and `src/reproduction/**` there gets no exemption.
   *
   * @param {Restrictions[]} exempt
   * @param {Restrictions[]} added
   */
  const scoped = (exempt, added = []) => ({
    'no-restricted-imports': 'off',
    'no-restricted-syntax': 'off',
    'no-restricted-globals': 'off',
    'no-restricted-properties': 'off',
    ...restrictionRules([...restrictions.filter((entry) => !exempt.includes(entry)), ...added]),
  });
  return tseslint.config(
    {
      ignores: [
        'dist/**',
        'coverage/**',
        '.output/**',
        '.nitro/**',
        '.vercel/**',
        'generated/**',
        'src/generated/**',
      ],
    },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        globals: kinds.some((kind) => kind === 'domain' || kind === 'telemetry')
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
        'arca/no-owner-environment': isScripts ? 'off' : 'error',
        ...restrictionRules(restrictions),
      },
    },
    restrictions.includes(workflowStart)
      ? { files: [workflowStartHelper], rules: scoped([workflowStart]) }
      : [],
    kinds.includes('api') ? { files: [credentialReader], rules: scoped([credentialRows]) } : [],
    restrictions.includes(databaseDrivers)
      ? {
          files: kinds.includes('db') ? databaseDriverFiles : databaseTestFiles,
          rules: scoped([databaseDrivers]),
        }
      : [],
    { files: reproductionLookupFiles, rules: scoped([reproductionLookup], [reproductionReexport]) },
    kinds.includes('knowledge')
      ? [
          {
            files: knowledgeRuntimeFiles,
            languageOptions: { globals: globals.es2025 },
            rules: scoped([], [pureRuntime]),
          },
          { files: knowledgeCatalogReaders, rules: scoped([rawCatalog], [pureRuntime]) },
        ]
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
