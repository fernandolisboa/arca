import { builtinModules } from 'node:module';

const nodeBuiltins = builtinModules.filter((name) => !name.startsWith('_'));

/**
 * Restrictions per package kind (spec 0001, R2). Each kind contributes import paths, import
 * patterns and syntax selectors; arcaConfig merges them, because a later flat-config entry for the
 * same rule would replace an earlier one instead of adding to it.
 *
 * @typedef {{ name: string, importNames?: string[], message: string }} RestrictedPath
 * @typedef {{ group?: string[], regex?: string, message: string }} RestrictedPattern
 * @typedef {{ selector: string, message: string }} RestrictedSyntax
 * @typedef {{ name: string, message: string }} RestrictedGlobal
 * @typedef {{ object: string, property: string, message: string }} RestrictedProperty
 * @typedef {{
 *   paths?: RestrictedPath[],
 *   patterns?: RestrictedPattern[],
 *   syntax?: RestrictedSyntax[],
 *   globals?: RestrictedGlobal[],
 *   properties?: RestrictedProperty[],
 * }} Restrictions
 */

const pureIo =
  'The pure packages (domain, the knowledge runtime, telemetry) do no I/O. Pass data in from the app.';
const pureTime =
  'The pure packages (domain, the knowledge runtime, telemetry) take time as an argument; do not read the clock.';
const pureLogging =
  'The pure packages (domain, the knowledge runtime, telemetry) never log: snapshots and evaluations are personal data (spec 0002, R5).';

/**
 * Pure code: packages/domain, the knowledge runtime entry and packages/telemetry.
 *
 * @type {Restrictions}
 */
export const pureRuntime = {
  paths: nodeBuiltins.map((name) => ({ name, message: pureIo })),
  patterns: [
    { group: ['node:*'], message: pureIo },
    {
      group: [
        'pg',
        'pg-*',
        'postgres',
        '@neondatabase/*',
        '@vercel/postgres',
        'drizzle-orm',
        'drizzle-orm/*',
        '@arca/db',
        '@arca/db/*',
      ],
      message: pureIo,
    },
    {
      group: [
        'axios',
        'undici',
        'node-fetch',
        'cross-fetch',
        'ky',
        'got',
        'superagent',
        'hono',
        'hono/*',
        '@hono/*',
      ],
      message: pureIo,
    },
  ],
  globals: [
    ...['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'process'].map((name) => ({
      name,
      message: pureIo,
    })),
    { name: 'console', message: pureLogging },
  ],
  properties: ['globalThis', 'window', 'self'].flatMap((object) => [
    { object, property: 'fetch', message: pureIo },
    { object, property: 'console', message: pureLogging },
  ]),
  // Syntactic guards against mistakes, not enforcement: an alias such as `const D = Date` passes.
  syntax: [
    {
      selector:
        "NewExpression[arguments.length=0]:matches([callee.name='Date'], [callee.property.name='Date'])",
      message: pureTime,
    },
    {
      selector: "CallExpression:matches([callee.name='Date'], [callee.property.name='Date'])",
      message: pureTime,
    },
    {
      selector:
        "CallExpression[callee.property.name='now']:matches([callee.object.name='Date'], [callee.object.property.name='Date'])",
      message: pureTime,
    },
  ],
};

const ownerFallback =
  'Database drivers fill missing fields from PG* and POSTGRES_* variables, which are the owner role. ' +
  'Connect through createRolePool in @arca/db.';

/**
 * Every package except the build scripts: database drivers only in the @arca/db files that
 * build the role pool, and their tests (spec 0001, R7).
 *
 * @type {Restrictions}
 */
// A regex, not a group: gitignore-style groups match any path segment, so `pg-*` would also
// catch `drizzle-orm/pg-core`, which holds no driver.
const databaseDriverModule =
  '^(?:pg|pg-[^/]+|postgres|@neondatabase/[^/]+|@vercel/postgres|drizzle-orm/(?:node-postgres|neon-[^/]+|postgres-js|vercel-postgres))(?:/.*)?$';

export const databaseDrivers = {
  patterns: [{ regex: databaseDriverModule, message: ownerFallback }],
  syntax: [
    {
      // require('pg') and createRequire(import.meta.url)('pg'), which no-restricted-imports ignores.
      selector: `CallExpression[arguments.0.value=/${selectorRegex(databaseDriverModule)}/]:matches([callee.name='require'], [callee.type='CallExpression'])`,
      message: ownerFallback,
    },
  ],
};

/** The @arca/db files allowed to import a database driver. */
export const databaseDriverFiles = ['src/pool.ts', 'src/database.ts', 'test/**'];

/**
 * In any package, the tests against a disposable Postgres server, which set up databases, roles
 * and synthetic accounts as its admin. They pass every connection field explicitly.
 */
export const databaseTestFiles = ['test/postgres/**', 'e2e/postgres/**'];

/** The knowledge runtime entry: pure like the domain; scripts and tests read files (spec 0002, R1). */
export const knowledgeRuntimeFiles = ['src/**'];

/** The knowledge runtime files that read the built catalog, each behind its own entry point. */
export const knowledgeCatalogReaders = ['src/index.ts', 'src/reproduction.ts'];

/**
 * packages/knowledge: only the entry points read the built catalog, so no other module can hand
 * out every version regardless of its decision state.
 *
 * @type {Restrictions}
 */
export const rawCatalog = {
  patterns: [
    {
      regex: '(?:^|/)generated/catalog(?:\\.[jt]s)?$',
      message:
        'Only the entry points read the built catalog; the runtime reaches it through routeCatalog (spec 0002, R5).',
    },
  ],
};

const reproductionOnly =
  'Modules named reproduction are the reproduction path: they ignore decision states, so only the cases runner and the reproduction path import them (spec 0002, R5).';
// The lookup's entry point, and any relative import of a module or folder named reproduction.
const reproductionModule =
  '^(?:@arca/knowledge/reproduction|(?:\\.{1,2}/)+(?:[^/]+/)*reproduction(?:\\.[jt]s|/.*)?)$';

/**
 * Every package: the reproduction lookup only where reproducing an old evaluation is the job.
 *
 * @type {Restrictions}
 */
export const reproductionLookup = {
  patterns: [{ regex: reproductionModule, message: reproductionOnly }],
};

/**
 * The files allowed to import the reproduction lookup may not re-export it with `export … from`.
 * Other ways of passing it on are left to review.
 *
 * @type {Restrictions}
 */
export const reproductionReexport = {
  syntax: [
    {
      selector: `:matches(ExportAllDeclaration, ExportNamedDeclaration)[source.value=/${selectorRegex(reproductionModule)}/]`,
      message: reproductionOnly,
    },
  ],
};

/** The cases runner and the reproduction path, with their tests. */
export const reproductionLookupFiles = [
  'test/cases/**',
  'src/reproduction/**',
  'test/reproduction/**',
  'test/reproduction.test.ts',
];

const sniffing =
  'Do not detect the operating system or browser. Read capabilities through @arca/platform.';
const sniffedProperty = '/^(userAgent|userAgentData|platform)$/';
const nativeApi = 'Native APIs are reached only through @arca/platform.';

/** @type {Restrictions} */
export const client = {
  patterns: [
    {
      group: ['@capacitor/*', '@capacitor-community/*', '@capawesome/*', '@tauri-apps/*'],
      message: nativeApi,
    },
  ],
  syntax: [
    {
      selector: `MemberExpression:matches([object.name='navigator'], [object.property.name='navigator']):matches([property.name=${sniffedProperty}], [property.value=${sniffedProperty}])`,
      message: sniffing,
    },
    {
      selector: `VariableDeclarator:matches([init.name='navigator'], [init.property.name='navigator']) > ObjectPattern > Property[key.name=${sniffedProperty}]`,
      message: sniffing,
    },
  ],
};

const contractEntry = 'apps/web imports the API contract only through @arca/api-contract/client.';

const iconsInUi =
  'Icons come from the Icon component in @arca/ui, the only place lucide-react is imported (spec 0006, R5).';

/** @type {Restrictions} */
export const web = {
  paths: [
    { name: '@arca/api-contract', message: contractEntry },
    { name: 'lucide-react', message: iconsInUi },
  ],
  patterns: [
    { regex: '^@arca/api-contract/(?!client$)', message: contractEntry },
    { regex: '^lucide-react/', message: iconsInUi },
  ],
};

const contractWithoutHono =
  'The contract routes and client stay free of Hono, so it never reaches the web bundle.';

/** The api-contract entries the web client imports (spec 0001, R3). */
export const contractSurfaceFiles = ['src/routes/**', 'src/client/**'];

/** @type {Restrictions} */
export const contractSurface = {
  patterns: [{ group: ['hono', 'hono/*', '@hono/*'], message: contractWithoutHono }],
};

const vaultTypes =
  'packages/platform imports @arca/vault for types only: the vault decrypts, the platform carries opaque values (spec 0005, R1).';
const vaultModule = `/${selectorRegex('^@arca/vault(/|$)')}/`;

/**
 * packages/platform: only `import type` and `export type` from @arca/vault. With
 * verbatimModuleSyntax, `import { type X }` still compiles to `import {}`, which loads the module.
 *
 * @type {Restrictions}
 */
export const vaultTypesOnly = {
  syntax: [
    `ImportDeclaration[source.value=${vaultModule}][importKind!='type']`,
    `ExportNamedDeclaration[source.value=${vaultModule}][exportKind!='type']`,
    `ExportAllDeclaration[source.value=${vaultModule}][exportKind!='type']`,
    `ImportExpression[source.value=${vaultModule}]`,
  ].map((selector) => ({ selector, message: vaultTypes })),
};

/** The one apps/api module that reads the auth schema, credential rows included (spec 0003, R1). */
export const credentialReader = 'src/auth/auth.ts';

/**
 * Every package except packages/db: the auth schema only in the module that mounts Better Auth.
 *
 * @type {Restrictions}
 */
export const credentialRows = {
  paths: [
    {
      name: '@arca/db/auth-schema',
      message: `Only ${credentialReader} in apps/api reads the auth schema (spec 0003, R1).`,
    },
  ],
};

/** The one file allowed to call start() from workflow/api (spec 0001, R6). */
export const workflowStartHelper = 'src/workflows/start-workflow.ts';

/** @type {Restrictions} */
export const workflowStart = {
  paths: [
    {
      name: 'workflow/api',
      importNames: ['start'],
      message: `Start workflows through startWorkflow in ${workflowStartHelper}.`,
    },
  ],
};

/**
 * @param {Restrictions[]} kinds
 * @returns {import('eslint').Linter.RulesRecord}
 */
export function restrictionRules(kinds) {
  /** @param {keyof Restrictions} key */
  const all = (key) => kinds.flatMap((kind) => kind[key] ?? []);
  /** @type {import('eslint').Linter.RulesRecord} */
  const rules = {};
  const paths = all('paths');
  const patterns = all('patterns');
  if (paths.length > 0 || patterns.length > 0) {
    rules['no-restricted-imports'] = ['error', { paths, patterns }];
    rules['@typescript-eslint/no-restricted-imports'] = 'off';
  }
  // no-restricted-imports ignores import(); the same paths and patterns are matched on it here.
  const syntax = [...all('syntax'), ...dynamicImportSyntax(paths, patterns)];
  if (syntax.length > 0) rules['no-restricted-syntax'] = ['error', ...syntax];
  const globals = all('globals');
  if (globals.length > 0) rules['no-restricted-globals'] = ['error', ...globals];
  const properties = all('properties');
  if (properties.length > 0) rules['no-restricted-properties'] = ['error', ...properties];
  return rules;
}

const dynamicImportOfNonLiteral = {
  selector: "ImportExpression:not([source.type='Literal'])",
  message: 'Import modules by a string literal, so package boundaries can be checked.',
};

/**
 * @param {RestrictedPath[]} paths
 * @param {RestrictedPattern[]} patterns
 * @returns {RestrictedSyntax[]}
 */
function dynamicImportSyntax(paths, patterns) {
  if (paths.length === 0 && patterns.length === 0) return [];
  /** @type {(source: string, message: string) => RestrictedSyntax} */
  const matching = (source, message) => ({
    selector: `ImportExpression[source.value=/${selectorRegex(source)}/]`,
    message,
  });
  return [
    dynamicImportOfNonLiteral,
    ...paths.map(({ name, message }) => matching(`^${escapeRegex(name)}$`, message)),
    ...patterns.flatMap(({ group, regex, message }) => [
      ...(group ?? []).map((glob) => matching(globToRegex(glob), message)),
      ...(regex === undefined ? [] : [matching(regex, message)]),
    ]),
  ];
}

/** @param {string} text */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} glob a no-restricted-imports group entry, where `*` matches any characters */
function globToRegex(glob) {
  return `^${glob.split('*').map(escapeRegex).join('.*')}$`;
}

/** esquery regex literals end at the first `/`, so slashes are written as an escape. */
function selectorRegex(/** @type {string} */ source) {
  return source.replaceAll('/', '\\u002F');
}
