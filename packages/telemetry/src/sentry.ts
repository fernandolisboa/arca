import { isRecord, keep, list, object, type Rule, type Scrubbed } from './rules.js';
import {
  boolean,
  contentType,
  errorCode,
  eventId,
  finite,
  functionName,
  httpMethod,
  integer,
  oneOf,
  operation,
  pathLike,
  release,
  spanId,
  traceId,
  uuid,
  version,
} from './shapes.js';
import { sentryEnvironments } from './sentry-project.js';
import { nameReducer, type UrlReducer } from './urls.js';

export interface KnownSentryParts {
  readonly reduce: UrlReducer;
  /** The database tables a span may name, as `schema.table`; any other name is dropped. */
  readonly tables: Iterable<string>;
}

const level = oneOf(['fatal', 'error', 'warning', 'log', 'info', 'debug']);
/** Sentry's span statuses, the only values a trace or span status takes. */
const spanStatus = oneOf([
  'ok',
  'cancelled',
  'unknown_error',
  'invalid_argument',
  'deadline_exceeded',
  'not_found',
  'already_exists',
  'permission_denied',
  'resource_exhausted',
  'failed_precondition',
  'aborted',
  'out_of_range',
  'unimplemented',
  'internal_error',
  'unavailable',
  'data_loss',
  'unauthenticated',
]);
/** Breadcrumbs that only ever carry a method, a URL and a status; every other kind is dropped. */
const breadcrumbCategory = oneOf(['fetch', 'xhr', 'http', 'navigation']);
/** The SDK that sent an event; the tunnel keeps it from an envelope header too. */
const sdkName = oneOf([
  'sentry.javascript.browser',
  'sentry.javascript.react',
  'sentry.javascript.node',
  'sentry.javascript.hono',
]);
export const sdk = object({ name: keep(sdkName), version: keep(version) });
const className = keep((value) => functionName(value) && !String(value).includes('<'));
/** A source file on the server, or a built asset's file name in the browser. */
const codeFile = /\.[cm]?[jt]sx?$/;
/** A Vite build asset, `name-hash.js`, as served from the assets directory. */
const assetName = /^[A-Za-z0-9_]{1,64}-[A-Za-z0-9_-]{8}\.[cm]?js$/;

const stringLiteral = /'(?:[^']|'')*'/g;
const sqlStatement = /^\s*(select|insert|update|delete|with)\b/i;
const sqlTable =
  /\b(?:from|into|update)\s+("?[a-z_][a-z0-9_]{0,62}"?(?:\."?[a-z_][a-z0-9_]{0,62}"?)?)/i;

export function sentryScrubbers({ reduce, tables }: KnownSentryParts) {
  const name = nameReducer(reduce);
  const knownTables = new Set(tables);

  /**
   * In the browser a frame's file name may be the page's own URL, so an http(s) URL is reduced
   * like any other, keeping only a built asset's name; a server path must name a source file.
   * Any other scheme is dropped.
   */
  const fileName: Rule = (value) => {
    if (typeof value !== 'string') return undefined;
    if (/^\/(?!\/)/.test(value)) return pathLike(value) && codeFile.test(value) ? value : undefined;
    if (!/^https?:\/\//i.test(value)) return undefined;
    const route = reduce(value);
    if (route === undefined) return undefined;
    const last = value.split(/[?#]/)[0]?.split('/').at(-1) ?? '';
    return route.endsWith('/assets/:param') && assetName.test(last)
      ? route.replace(/:param$/, last)
      : route;
  };

  /** A database span keeps its operation and a known table only, never the statement. */
  const databaseName = (data: Readonly<Record<string, unknown>>): string | undefined => {
    const statement = data['db.statement'] ?? data['db.query.text'];
    if (typeof statement !== 'string') return undefined;
    const verb = sqlStatement.exec(statement)?.[1]?.toUpperCase();
    if (verb === undefined) return undefined;
    const table = sqlTable
      .exec(statement.replaceAll(stringLiteral, "''"))?.[1]
      ?.replaceAll('"', '');
    return table !== undefined && knownTables.has(table) ? `${verb} ${table}` : verb;
  };

  const frame = object({
    filename: fileName,
    function: keep(functionName),
    lineno: keep(integer),
    colno: keep(integer),
    in_app: keep(boolean),
  });

  /** The exception's class and where it was thrown; its message is always dropped. */
  const exception = object({
    type: className,
    mechanism: object({ type: keep(operation), handled: keep(boolean) }),
    stacktrace: object({ frames: list(frame, 50) }),
  });

  const breadcrumb: Rule = (value) => {
    if (!isRecord(value) || !breadcrumbCategory(value['category'])) return undefined;
    return object({
      type: keep(oneOf(['default', 'http', 'navigation'])),
      category: keep(breadcrumbCategory),
      level: keep(level),
      timestamp: keep(finite),
      data: object({
        method: keep(httpMethod),
        'http.request.method': keep(httpMethod),
        url: reduce,
        status_code: keep(integer),
        from: reduce,
        to: reduce,
      }),
    })(value);
  };

  const spanData = object({
    'db.system': keep(oneOf(['postgresql'])),
    'db.system.name': keep(oneOf(['postgresql'])),
    'http.request.method': keep(httpMethod),
    'http.response.status_code': keep(integer),
    'http.route': reduce,
  });

  const span: Rule = (value) => {
    if (!isRecord(value)) return undefined;
    const kept = object({
      span_id: keep(spanId),
      parent_span_id: keep(spanId),
      trace_id: keep(traceId),
      op: keep(operation),
      origin: keep(operation),
      status: keep(spanStatus),
      start_timestamp: keep(finite),
      timestamp: keep(finite),
      data: spanData,
    })(value) as Record<string, unknown>;
    const data = isRecord(value['data']) ? value['data'] : {};
    const op = value['op'];
    const description =
      typeof op === 'string' && op.startsWith('db')
        ? databaseName(data)
        : name(value['description']);
    if (description !== undefined) kept['description'] = description;
    return kept;
  };

  const event = object({
    event_id: keep(eventId),
    type: keep(oneOf(['transaction'])),
    timestamp: keep(finite),
    start_timestamp: keep(finite),
    level: keep(level),
    platform: keep(oneOf(['javascript', 'node'])),
    release: keep(release),
    environment: keep(oneOf(sentryEnvironments)),
    transaction: name,
    transaction_info: object({
      source: keep(oneOf(['custom', 'url', 'route', 'view', 'component', 'task'])),
    }),
    exception: object({ values: list(exception, 10) }),
    tags: object({ errorCode: keep(errorCode) }),
    request: object({
      method: keep(httpMethod),
      url: reduce,
      headers: object({ 'content-type': keep(contentType) }),
    }),
    contexts: object({
      trace: object({
        trace_id: keep(traceId),
        span_id: keep(spanId),
        parent_span_id: keep(spanId),
        op: keep(operation),
        status: keep(spanStatus),
      }),
      runtime: object({ name: keep(oneOf(['node'])), version: keep(version) }),
    }),
    breadcrumbs: list(breadcrumb, 50),
    spans: list(span, 1000),
    /** Where the SDK matches each frame to its uploaded source map. */
    debug_meta: object({
      images: list(
        object({
          type: keep(oneOf(['sourcemap'])),
          code_file: fileName,
          debug_id: keep(uuid),
        }),
        100,
      ),
    }),
    sdk,
  });

  return {
    /** Sentry's `beforeSend`; also `beforeSendTransaction`, since spans go through `span`. */
    event: (value: unknown): Scrubbed | null => (event(value) as Scrubbed | undefined) ?? null,
    /** Sentry's `beforeBreadcrumb`; null drops the breadcrumb. */
    breadcrumb: (value: unknown): Scrubbed | null =>
      (breadcrumb(value) as Scrubbed | undefined) ?? null,
  };
}
