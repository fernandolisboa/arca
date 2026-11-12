import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/runner.ts';
import { retiredRoles, runtimeRoles } from '../../src/db/policy.ts';
import {
  adminTarget,
  containerPolicy,
  dropDatabase,
  freshDatabase,
  migratorTarget,
  realMigrations,
  withClient,
} from './support.ts';

/**
 * The access matrix over the real migrations (spec 0003, R1): which runtime role may touch the
 * auth schema, and how. Read from the catalog, so a grant added by any later migration shows up.
 */
let database: string;
beforeAll(async () => {
  database = await freshDatabase();
  await migrate(migratorTarget(database), await realMigrations(), await containerPolicy());
});
afterAll(async () => {
  await dropDatabase(database);
});

const authTables = [
  'account',
  'erased_account',
  'invite',
  'outbox',
  'passkey',
  'passkey_activation',
  'passkey_capability',
  'passkey_challenge',
  'passkey_client',
  'rate_limit',
  'recovery_code',
  'recovery_link',
  'recovery_lock',
  'registration_context',
  'session',
  'setup',
  'step_up',
  'step_up_challenge',
  'user',
  'verification',
];
const tablePrivileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
];

async function privileges(role: string): Promise<Record<string, string[]>> {
  return withClient(adminTarget(database), async (client) => {
    const schema = await client.query<{ usage: boolean; create: boolean }>(
      `SELECT pg_catalog.has_schema_privilege($1, 'auth', 'USAGE') AS usage,
              pg_catalog.has_schema_privilege($1, 'auth', 'CREATE') AS create`,
      [role],
    );
    const result: Record<string, string[]> = {
      schema: Object.entries(schema.rows[0] ?? {})
        .filter(([, granted]) => granted)
        .map(([privilege]) => privilege.toUpperCase()),
    };
    for (const table of authTables) {
      const granted: string[] = [];
      for (const privilege of tablePrivileges) {
        const row = await client.query<{ granted: boolean }>(
          `SELECT pg_catalog.has_table_privilege($1, pg_catalog.format('auth.%I', $2::text), $3) AS granted`,
          [role, table, privilege],
        );
        if (row.rows[0]?.granted === true) granted.push(privilege);
      }
      result[table] = granted;
    }
    return result;
  });
}

describe('the auth schema access matrix', () => {
  it('has exactly the tables the matrix lists', async () => {
    const tables = await withClient(adminTarget(database), async (client) => {
      const result = await client.query<{ name: string }>(
        `SELECT c.relname AS name FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'auth' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY 1`,
      );
      return result.rows.map((row) => row.name);
    });
    expect(tables).toEqual(authTables);
  });

  it('lets app_auth read and write its tables, and nothing more', async () => {
    const dml = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
    expect(await privileges('app_auth')).toEqual({
      schema: ['USAGE'],
      ...Object.fromEntries(authTables.map((table) => [table, dml])),
      erased_account: ['SELECT', 'INSERT', 'DELETE'],
      invite: ['SELECT', 'INSERT', 'DELETE'],
      outbox: ['SELECT', 'INSERT', 'DELETE'],
      passkey_activation: ['SELECT', 'INSERT', 'DELETE'],
      passkey_capability: ['SELECT', 'INSERT'],
      passkey_challenge: ['SELECT', 'INSERT', 'DELETE'],
      passkey_client: ['SELECT', 'INSERT', 'DELETE'],
      recovery_code: ['SELECT', 'INSERT', 'DELETE'],
      recovery_link: ['SELECT', 'INSERT', 'DELETE'],
      recovery_lock: ['SELECT', 'INSERT', 'DELETE'],
      registration_context: ['SELECT', 'INSERT', 'DELETE'],
      setup: ['SELECT', 'INSERT'],
      step_up: ['SELECT', 'INSERT', 'DELETE'],
      step_up_challenge: ['SELECT', 'INSERT', 'DELETE'],
    });
  });

  it.each([
    ['step_up', ['consumed_at']],
    ['recovery_code', ['salt', 'code_hash', 'created_at', 'confirmed_at', 'provisional_until']],
    ['recovery_link', ['token_hash', 'redeemed_at', 'challenge', 'challenge_expires_at']],
    ['recovery_lock', ['failures', 'locked_until']],
    ['invite', ['accepted_at', 'accepted_account_id']],
    ['erased_account', []],
  ])('lets app_auth update only the columns it must on auth.%s', async (table, columns) => {
    const updatable = await withClient(adminTarget(database), async (client) => {
      const result = await client.query<{ name: string }>(
        `SELECT attname AS name FROM pg_catalog.pg_attribute
          WHERE attrelid = pg_catalog.format('auth.%I', $1::text)::regclass
            AND attnum > 0 AND NOT attisdropped
            AND pg_catalog.has_column_privilege('app_auth', attrelid, attnum, 'UPDATE')
          ORDER BY attnum`,
        [table],
      );
      return result.rows.map((row) => row.name);
    });
    expect(updatable).toEqual(columns);
  });

  it.each([...runtimeRoles.filter((role) => role !== 'app_auth'), ...retiredRoles])(
    'gives %s no access to the auth schema',
    async (role) => {
      expect(await privileges(role)).toEqual({
        schema: [],
        ...Object.fromEntries(authTables.map((table) => [table, []])),
      });
    },
  );
});

const auditColumns = [
  'id',
  'time',
  'actor_account_id',
  'subject_account_id',
  'code',
  'request_id',
  'details',
];

/** The assertion an ADR-0022 decision copies; no role writes one since ADR-0027. */
const decisionStepUpColumns = [
  'credential_id',
  'public_key',
  'action_nonce',
  'server_nonce',
  'authenticator_data',
  'client_data_json',
  'signature',
  'step_up_id',
];

const decisionColumns = [
  'id',
  'kind',
  'subject_kind',
  'route_id',
  'comparison_id',
  'version_number',
  'content_hash',
  'approver_account_id',
  'proof',
  'admin_basis',
  'admin_grant_id',
  ...decisionStepUpColumns,
  'decided_at',
];

/** The admin role's history (ADR-0027); the database sets `at`. */
const adminGrantColumns = [
  'id',
  'kind',
  'grantee_account_id',
  'actor_account_id',
  'actor_basis',
  'actor_grant_id',
  'removes_grant_id',
  'step_up_id',
  'at',
];

/** Per column, the privileges a role holds on one table, table-level grants included. */
async function columnPrivileges(role: string, table: string, columns: readonly string[]) {
  const [schemaName = ''] = table.split('.');
  return withClient(adminTarget(database), async (client) => {
    const schema = await client.query<{ usage: boolean; create: boolean }>(
      `SELECT pg_catalog.has_schema_privilege($1, $2, 'USAGE') AS usage,
              pg_catalog.has_schema_privilege($1, $2, 'CREATE') AS create`,
      [role, schemaName],
    );
    const granted: Record<string, string[]> = {};
    for (const column of columns) {
      const held: string[] = [];
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
        const row = await client.query<{ granted: boolean }>(
          `SELECT pg_catalog.has_column_privilege($1, $2, $3, $4) AS granted`,
          [role, table, column, privilege],
        );
        if (row.rows[0]?.granted) held.push(privilege);
      }
      granted[column] = held;
    }
    const tablePrivileges: string[] = [];
    for (const privilege of ['DELETE', 'TRUNCATE', 'TRIGGER']) {
      const row = await client.query<{ granted: boolean }>(
        `SELECT pg_catalog.has_table_privilege($1, $2, $3) AS granted`,
        [role, table, privilege],
      );
      if (row.rows[0]?.granted) tablePrivileges.push(privilege);
    }
    return {
      usage: schema.rows[0]?.usage,
      create: schema.rows[0]?.create,
      columns: granted,
      table: tablePrivileges,
    };
  });
}

const auditPrivileges = (role: string) => columnPrivileges(role, 'audit.event', auditColumns);
const decisionPrivileges = (role: string) =>
  columnPrivileges(role, 'knowledge.decision', decisionColumns);
const adminGrantPrivileges = (role: string) =>
  columnPrivileges(role, 'knowledge.admin_grant', adminGrantColumns);
const summaryColumns = ['content_hash', 'prompt_version', 'model', 'overview', 'watch_points'];
const summaryPrivileges = (role: string) =>
  columnPrivileges(role, 'knowledge.rule_summary', summaryColumns);

const startColumns = ['id', 'route_id', 'version_number', 'started_at'];
const startPrivileges = (role: string) =>
  columnPrivileges(role, 'knowledge.check_start', startColumns);
const progressColumns = ['start_id', 'sequence', 'kind', 'detail', 'recorded_at'];
const progressPrivileges = (role: string) =>
  columnPrivileges(role, 'knowledge.check_progress', progressColumns);
const reportColumns = [
  'id',
  'start_id',
  'route_id',
  'version_number',
  'content_hash',
  'guide_hash',
  'prompt_version',
  'model',
  'checked_at',
  'items',
  'fetch_log',
  'failure',
  'failed',
  'clean',
];
const reportPrivileges = (role: string) =>
  columnPrivileges(role, 'knowledge.independent_check', reportColumns);

const correctionTables = {
  'knowledge.correction_request': [
    'id',
    'route_id',
    'version_number',
    'country_code',
    'item_kind',
    'item_key',
    'note',
    'author_account_id',
    'created_at',
    'content_erased_at',
  ],
  'knowledge.correction_source': [
    'request_id',
    'position',
    'kind',
    'url',
    'text',
    'upload_id',
    'page_url',
  ],
  'knowledge.correction_event': [
    'id',
    'request_id',
    'kind',
    'corrector_key_id',
    'proposed_version',
    'proposed_route_id',
    'explanation',
    'at',
  ],
  'knowledge.correction_upload': [
    'id',
    'author_account_id',
    'pathname',
    'media_type',
    'size',
    'sha256',
    'created_at',
  ],
  'knowledge.corrector_key': [
    'id',
    'kind',
    'key_sha256',
    'revokes_key_id',
    'actor_account_id',
    'step_up_id',
    'at',
  ],
} as const;
const correctionFunctions = [
  'knowledge.file_correction_request(text, integer, text, text, text, jsonb, text)',
  'knowledge.correction_requests(text, integer, text, uuid)',
  'knowledge.close_correction_request(uuid, text, uuid)',
  'knowledge.own_correction_rows(text)',
  'knowledge.start_correction_upload(text, integer, bytea, text)',
  'knowledge.own_correction_upload(uuid, text)',
  'knowledge.attach_correction_file(uuid, integer, uuid, text)',
  'knowledge.correction_files(text, integer, text, uuid)',
  'knowledge.correction_file(uuid, integer, text, uuid)',
  'knowledge.own_correction_upload_rows(text)',
  'knowledge.attach_correction_file_with_page(uuid, integer, uuid, text, text)',
  'knowledge.correction_file_sources(text, integer, text, uuid)',
  'knowledge.correction_page_copies(text[])',
  'knowledge.live_corrector_key()',
  'knowledge.revoke_corrector_key(uuid, text)',
  'knowledge.corrector_requests(uuid, bytea)',
  'knowledge.corrector_request_list(uuid, bytea)',
  'knowledge.corrector_file(uuid, bytea, uuid, integer)',
  'knowledge.answer_correction_request(uuid, bytea, uuid, text, integer, text)',
  'knowledge.correction_events(text, integer, text, uuid)',
  'knowledge.own_corrector_key_rows(text)',
  'knowledge.file_route_request(text, text, jsonb, text)',
  'knowledge.route_requests(text, uuid)',
  'knowledge.corrector_request_queue(uuid, bytea)',
  'knowledge.answer_route_request(uuid, bytea, uuid, text, integer)',
  'knowledge.own_correction_request_rows(text)',
  'knowledge.newest_route_requests(text, uuid)',
  'knowledge.answer_new_route_request(uuid, bytea, uuid, text, integer)',
  'knowledge.admin_basis_holds(text, uuid)',
  'knowledge.corrector_key_holds(uuid, bytea)',
];

/** Every privilege a role holds on the correction request tables, and the functions it may run. */
async function correctionAccess(role: string) {
  const tables: Record<string, unknown> = {};
  for (const [table, columns] of Object.entries(correctionTables)) {
    const { columns: granted, table: whole } = await columnPrivileges(role, table, columns);
    tables[table] = { columns: granted, table: whole };
  }
  const functions = await withClient(adminTarget(database), async (client) => {
    const runs: string[] = [];
    for (const signature of correctionFunctions) {
      const row = await client.query<{ granted: boolean }>(
        `SELECT pg_catalog.has_function_privilege($1, $2, 'EXECUTE') AS granted`,
        [role, signature],
      );
      if (row.rows[0]?.granted) runs.push(signature.slice(0, signature.indexOf('(')));
    }
    return runs;
  });
  return { tables, functions };
}

/** No privilege on any correction table, and on `owned` columns only `privileges`. */
function correctionMatrix(
  owned: Partial<Record<keyof typeof correctionTables, string[]>>,
  table: Partial<Record<keyof typeof correctionTables, string[]>> = {},
) {
  return Object.fromEntries(
    Object.entries(correctionTables).map(([name, columns]) => [
      name,
      {
        columns: onEvery(columns, owned[name as keyof typeof correctionTables] ?? []),
        table: table[name as keyof typeof correctionTables] ?? [],
      },
    ]),
  );
}

describe('the correction request access matrix (ADR-0029)', () => {
  it('gives app_api no table privilege, only the request and export functions', async () => {
    expect(await correctionAccess('app_api')).toEqual({
      tables: correctionMatrix({}),
      functions: [
        'knowledge.file_correction_request',
        'knowledge.correction_requests',
        'knowledge.close_correction_request',
        'knowledge.own_correction_rows',
        'knowledge.start_correction_upload',
        'knowledge.own_correction_upload',
        'knowledge.attach_correction_file',
        'knowledge.correction_files',
        'knowledge.correction_file',
        'knowledge.own_correction_upload_rows',
        'knowledge.attach_correction_file_with_page',
        'knowledge.correction_file_sources',
        'knowledge.live_corrector_key',
        'knowledge.revoke_corrector_key',
        'knowledge.corrector_requests',
        'knowledge.corrector_request_list',
        'knowledge.corrector_file',
        'knowledge.answer_correction_request',
        'knowledge.correction_events',
        'knowledge.own_corrector_key_rows',
        'knowledge.file_route_request',
        'knowledge.route_requests',
        'knowledge.corrector_request_queue',
        'knowledge.answer_route_request',
        'knowledge.own_correction_request_rows',
        'knowledge.newest_route_requests',
        'knowledge.answer_new_route_request',
      ],
    });
  });

  it('lets app_auth only insert a created corrector key, never its time, and run nothing', async () => {
    const matrix = correctionMatrix({ 'knowledge.corrector_key': ['INSERT'] });
    const keys = matrix['knowledge.corrector_key'] as { columns: Record<string, string[]> };
    expect(await correctionAccess('app_auth')).toEqual({
      tables: {
        ...matrix,
        'knowledge.corrector_key': {
          ...keys,
          columns: { ...keys.columns, revokes_key_id: [], at: [] },
        },
      },
      functions: [],
    });
  });

  it('lets app_jobs read every table, delete requests, sources and uploads, clear a note, and read page copies', async () => {
    const request = correctionTables['knowledge.correction_request'];
    expect(await correctionAccess('app_jobs')).toEqual({
      tables: {
        ...correctionMatrix(
          {
            'knowledge.correction_source': ['SELECT'],
            'knowledge.correction_event': ['SELECT'],
            'knowledge.correction_upload': ['SELECT'],
          },
          {
            'knowledge.correction_request': ['DELETE'],
            'knowledge.correction_source': ['DELETE'],
            'knowledge.correction_upload': ['DELETE'],
          },
        ),
        'knowledge.correction_request': {
          columns: Object.fromEntries(
            request.map((column) => [
              column,
              column === 'note' || column === 'content_erased_at'
                ? ['SELECT', 'UPDATE']
                : ['SELECT'],
            ]),
          ),
          table: ['DELETE'],
        },
      },
      functions: ['knowledge.correction_page_copies'],
    });
  });

  it('lets knowledge_definer read and insert, never change or delete, and run its own functions', async () => {
    const access = await correctionAccess('knowledge_definer');
    expect(access.functions).toEqual(correctionFunctions.map((f) => f.slice(0, f.indexOf('('))));
    expect(access.tables).toEqual(
      correctionMatrix({
        'knowledge.correction_request': ['SELECT', 'INSERT'],
        'knowledge.correction_source': ['SELECT', 'INSERT'],
        'knowledge.correction_event': ['SELECT', 'INSERT'],
        'knowledge.correction_upload': ['SELECT', 'INSERT'],
        'knowledge.corrector_key': ['SELECT', 'INSERT'],
      }),
    );
  });

  it.each([
    ...runtimeRoles.filter((role) => !['app_api', 'app_jobs', 'app_auth'].includes(role)),
    ...retiredRoles,
  ])('gives %s no access', async (role) => {
    expect(await correctionAccess(role)).toEqual({ tables: correctionMatrix({}), functions: [] });
  });
});

const onEvery = (columns: readonly string[], privileges: string[]) =>
  Object.fromEntries(columns.map((column) => [column, privileges]));
const onEveryColumn = (privileges: string[]) => onEvery(auditColumns, privileges);

/** The tables of a schema with whether row-level security is forced, and its foreign keys. */
async function schemaShape(schema: string) {
  return withClient(adminTarget(database), async (client) => {
    const tables = await client.query<{ name: string; forced: boolean }>(
      `SELECT c.relname AS name, c.relrowsecurity AND c.relforcerowsecurity AS forced
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY 1`,
      [schema],
    );
    const foreignKeys = await client.query(
      `SELECT FROM pg_catalog.pg_constraint k
         JOIN pg_catalog.pg_namespace n ON n.oid = k.connamespace
        WHERE n.nspname = $1 AND k.contype = 'f'`,
      [schema],
    );
    return { tables: tables.rows, foreignKeys: foreignKeys.rowCount };
  });
}

describe('the audit schema access matrix (spec 0003, R7)', () => {
  it('has only the event table, with no foreign keys and forced row-level security', async () => {
    expect(await schemaShape('audit')).toEqual({
      tables: [{ name: 'event', forced: true }],
      foreignKeys: 0,
    });
  });

  it('lets app_audit insert every column but the ID and the time, and nothing else', async () => {
    expect(await auditPrivileges('app_audit')).toEqual({
      usage: true,
      create: false,
      columns: {
        ...onEveryColumn(['INSERT']),
        id: [],
        time: [],
      },
      table: [],
    });
  });

  it('lets app_api only read', async () => {
    expect(await auditPrivileges('app_api')).toEqual({
      usage: true,
      create: false,
      columns: onEveryColumn(['SELECT']),
      table: [],
    });
  });

  it.each([
    ...runtimeRoles.filter((role) => !['app_audit', 'app_api'].includes(role)),
    ...retiredRoles,
  ])('gives %s no access to the audit schema', async (role) => {
    expect(await auditPrivileges(role)).toEqual({
      usage: false,
      create: false,
      columns: onEveryColumn([]),
      table: [],
    });
  });
});

describe('the knowledge schema access matrix (spec 0007, R7)', () => {
  it('has only the admin grant, decision, rule summary, check, correction request and corrector key tables, with forced row-level security', async () => {
    expect(await schemaShape('knowledge')).toEqual({
      tables: [
        { name: 'admin_grant', forced: true },
        { name: 'check_progress', forced: true },
        { name: 'check_start', forced: true },
        { name: 'correction_event', forced: true },
        { name: 'correction_request', forced: true },
        { name: 'correction_source', forced: true },
        { name: 'correction_upload', forced: true },
        { name: 'corrector_key', forced: true },
        { name: 'decision', forced: true },
        { name: 'independent_check', forced: true },
        { name: 'rule_summary', forced: true },
      ],
      // A correction request's sources and events, which go with it, a file source's upload, the
      // corrector key an event names and the key a revocation ends (ADR-0029).
      foreignKeys: 5,
    });
  });

  it('lets app_auth insert a session decision, with no step-up field and no time, and nothing else (ADR-0027)', async () => {
    expect(await decisionPrivileges('app_auth')).toEqual({
      usage: true,
      create: false,
      columns: {
        ...onEvery(decisionColumns, ['INSERT']),
        ...onEvery(decisionStepUpColumns, []),
        decided_at: [],
      },
      table: [],
    });
  });

  it('lets app_api only read', async () => {
    expect(await decisionPrivileges('app_api')).toEqual({
      usage: true,
      create: false,
      columns: onEvery(decisionColumns, ['SELECT']),
      table: [],
    });
  });

  it('lets app_auth read the admin grants and insert every column but the time, and nothing else (ADR-0027)', async () => {
    expect(await adminGrantPrivileges('app_auth')).toEqual({
      usage: true,
      create: false,
      columns: { ...onEvery(adminGrantColumns, ['SELECT', 'INSERT']), at: ['SELECT'] },
      table: [],
    });
  });

  it('lets app_api only read the admin grants', async () => {
    expect(await adminGrantPrivileges('app_api')).toEqual({
      usage: true,
      create: false,
      columns: onEvery(adminGrantColumns, ['SELECT']),
      table: [],
    });
  });

  it('lets app_api read and insert rule summaries, never change or delete one (ADR-0025)', async () => {
    expect(await summaryPrivileges('app_api')).toEqual({
      usage: true,
      create: false,
      columns: onEvery(summaryColumns, ['SELECT', 'INSERT']),
      table: [],
    });
  });

  it('gives app_auth no access to rule summaries', async () => {
    expect((await summaryPrivileges('app_auth')).columns).toEqual(onEvery(summaryColumns, []));
    expect((await summaryPrivileges('app_auth')).table).toEqual([]);
  });

  it('lets app_api read check starts and insert their route and number only (ADR-0027)', async () => {
    expect(await startPrivileges('app_api')).toEqual({
      usage: true,
      create: false,
      columns: {
        ...onEvery(startColumns, ['SELECT']),
        route_id: ['SELECT', 'INSERT'],
        version_number: ['SELECT', 'INSERT'],
      },
      table: [],
    });
  });

  it('lets app_jobs insert check reports but their ID and time, and read them (ADR-0027)', async () => {
    expect(await reportPrivileges('app_jobs')).toEqual({
      usage: true,
      create: false,
      columns: {
        ...onEvery(reportColumns, ['SELECT', 'INSERT']),
        id: ['SELECT'],
        checked_at: ['SELECT'],
      },
      table: [],
    });
  });

  it.each(['app_api', 'app_auth'])('lets %s only read check reports (ADR-0027)', async (role) => {
    expect(await reportPrivileges(role)).toEqual({
      usage: true,
      create: false,
      columns: onEvery(reportColumns, ['SELECT']),
      table: [],
    });
  });

  it('lets app_jobs insert check progress but its time, and nothing else (ADR-0027)', async () => {
    expect(await progressPrivileges('app_jobs')).toEqual({
      usage: true,
      create: false,
      columns: { ...onEvery(progressColumns, ['INSERT']), recorded_at: [] },
      table: [],
    });
  });

  it('lets app_api only read check progress (ADR-0027)', async () => {
    expect(await progressPrivileges('app_api')).toEqual({
      usage: true,
      create: false,
      columns: onEvery(progressColumns, ['SELECT']),
      table: [],
    });
  });

  it.each(runtimeRoles.filter((role) => !['app_api', 'app_jobs'].includes(role)))(
    'gives %s no access to check progress',
    async (role) => {
      const privileges = await progressPrivileges(role);
      expect(privileges.columns).toEqual(onEvery(progressColumns, []));
      expect(privileges.table).toEqual([]);
    },
  );

  it.each(runtimeRoles.filter((role) => role !== 'app_api'))(
    'gives %s no access to check starts',
    async (role) => {
      const privileges = await startPrivileges(role);
      expect(privileges.columns).toEqual(onEvery(startColumns, []));
      expect(privileges.table).toEqual([]);
    },
  );

  it('gives app_jobs no access to decisions, admin grants or rule summaries', async () => {
    for (const privileges of [
      await decisionPrivileges('app_jobs'),
      await adminGrantPrivileges('app_jobs'),
      await summaryPrivileges('app_jobs'),
    ]) {
      expect(privileges.columns).toEqual(
        Object.fromEntries(Object.keys(privileges.columns).map((column) => [column, []])),
      );
      expect(privileges.table).toEqual([]);
    }
  });

  it.each([
    ...runtimeRoles.filter((role) => !['app_auth', 'app_api', 'app_jobs'].includes(role)),
    ...retiredRoles,
  ])('gives %s no access to the knowledge schema', async (role) => {
    expect(await decisionPrivileges(role)).toEqual({
      usage: false,
      create: false,
      columns: onEvery(decisionColumns, []),
      table: [],
    });
    expect(await summaryPrivileges(role)).toEqual({
      usage: false,
      create: false,
      columns: onEvery(summaryColumns, []),
      table: [],
    });
    expect(await reportPrivileges(role)).toEqual({
      usage: false,
      create: false,
      columns: onEvery(reportColumns, []),
      table: [],
    });
    expect(await adminGrantPrivileges(role)).toEqual({
      usage: false,
      create: false,
      columns: onEvery(adminGrantColumns, []),
      table: [],
    });
  });
});
