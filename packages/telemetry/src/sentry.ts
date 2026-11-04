import { isRecord, keep, list, object, type Rule } from './rules.js';
import {
  boolean,
  contentType,
  finite,
  functionName,
  httpMethod,
  identifier,
  integer,
  oneOf,
  operation,
  pathLike,
  release,
  sdkName,
  spanId,
  traceId,
} from './shapes.js';
import { nameReducer, type UrlReducer } from './urls.js';

/** The exported shape of a Sentry event, transaction or breadcrumb: plain JSON, nothing more. */
export type Scrubbed = Readonly<Record<string, unknown>>;

const level = oneOf(['fatal', 'error', 'warning', 'log', 'info', 'debug']);
/** Breadcrumbs that only ever carry a method, a URL and a status; every other kind is dropped. */
const breadcrumbCategory = oneOf(['fetch', 'xhr', 'http', 'navigation']);
const className = keep((value) => functionName(value) && !String(value).includes('<'));

const frame = object({
  filename: keep(pathLike),
  function: keep(functionName),
  lineno: keep(integer),
  colno: keep(integer),
  in_app: keep(boolean),
});

/** The exception's class and where it was thrown; its message is always dropped. */
const exception = object({
  type: className,
  mechanism: object({ type: keep(identifier), handled: keep(boolean) }),
  stacktrace: object({ frames: list(frame, 50) }),
});

const sqlStatement = /^\s*(select|insert|update|delete|with)\b/i;
const sqlTable =
  /\b(?:from|into|update)\s+("?[a-z_][a-z0-9_]{0,62}"?(?:\."?[a-z_][a-z0-9_]{0,62}"?)?)/i;

/** A database span keeps its operation and table only, never the statement or its values. */
function databaseName(data: Readonly<Record<string, unknown>>): string | undefined {
  const statement = data['db.statement'] ?? data['db.query.text'];
  if (typeof statement !== 'string') return undefined;
  const verb = sqlStatement.exec(statement)?.[1];
  if (verb === undefined) return undefined;
  const table = sqlTable.exec(statement)?.[1]?.replaceAll('"', '');
  return table === undefined ? verb.toUpperCase() : `${verb.toUpperCase()} ${table}`;
}

export function sentryScrubbers(reduce: UrlReducer) {
  const route: Rule = (value) => reduce(value);
  const name: Rule = (value) => nameReducer(reduce)(value);

  const breadcrumb: Rule = (value) => {
    if (!isRecord(value) || !breadcrumbCategory(value['category'])) return undefined;
    return object({
      type: keep(identifier),
      category: keep(breadcrumbCategory),
      level: keep(level),
      timestamp: keep(finite),
      data: object({
        method: keep(httpMethod),
        url: route,
        status_code: keep(integer),
        from: route,
        to: route,
      }),
    })(value);
  };

  const spanData = object({
    'db.system': keep(identifier),
    'http.request.method': keep(httpMethod),
    'http.response.status_code': keep(integer),
    'http.route': route,
  });

  const span: Rule = (value) => {
    if (!isRecord(value)) return undefined;
    const kept = object({
      span_id: keep(spanId),
      parent_span_id: keep(spanId),
      trace_id: keep(traceId),
      op: keep(operation),
      origin: keep(operation),
      status: keep(identifier),
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
    event_id: keep((value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)),
    type: keep(oneOf(['transaction'])),
    timestamp: keep(finite),
    start_timestamp: keep(finite),
    level: keep(level),
    platform: keep(identifier),
    release: keep(release),
    environment: keep(identifier),
    transaction: name,
    transaction_info: object({ source: keep(identifier) }),
    exception: object({ values: list(exception, 10) }),
    tags: object({ errorCode: keep(identifier) }),
    request: object({
      method: keep(httpMethod),
      url: route,
      headers: object({ 'content-type': keep(contentType) }),
    }),
    contexts: object({
      trace: object({
        trace_id: keep(traceId),
        span_id: keep(spanId),
        parent_span_id: keep(spanId),
        op: keep(operation),
        status: keep(identifier),
      }),
      runtime: object({ name: keep(identifier), version: keep(release) }),
    }),
    breadcrumbs: list(breadcrumb, 50),
    spans: list(span, 1000),
    sdk: object({ name: keep(sdkName), version: keep(release) }),
  });

  return {
    /** Sentry's `beforeSend`; also `beforeSendTransaction`, since spans go through `span`. */
    event: (value: unknown): Scrubbed | null => (event(value) as Scrubbed | undefined) ?? null,
    /** Sentry's `beforeBreadcrumb`; null drops the breadcrumb. */
    breadcrumb: (value: unknown): Scrubbed | null =>
      (breadcrumb(value) as Scrubbed | undefined) ?? null,
  };
}
