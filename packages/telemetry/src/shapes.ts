/** A check a value must pass to be exported; anything that fails is dropped, never repaired. */
export type Shape = (value: unknown) => boolean;

const matching =
  (pattern: RegExp): Shape =>
  (value) =>
    typeof value === 'string' && pattern.test(value);

export const identifier = matching(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
/** A label and the error class it wraps, such as `RecoveryStart:TypeError`. */
export const errorName = matching(/^[A-Za-z_][A-Za-z0-9_]{0,63}(?::[A-Za-z_][A-Za-z0-9_]{0,63})?$/);
export const token = matching(/^[A-Za-z0-9_-]{1,64}$/);
export const traceId = matching(/^[0-9a-f]{32}$/);
export const spanId = matching(/^[0-9a-f]{16}$/);
export const release = matching(/^[A-Za-z0-9._@+-]{1,64}$/);
/** A route pattern, such as `/v1/*` or `/v1/invites/:param`: no spaces, no query. */
export const routePattern = matching(/^\/[A-Za-z0-9_/:*.{}-]{0,199}$/);
/** A file name in a stack frame: a path or URL with no spaces. */
export const pathLike = matching(/^[A-Za-z0-9_./@:~+-]{1,200}$/);
/** A function name in a stack frame, such as `Object.<anonymous>` or `handle`. */
export const functionName = matching(/^[A-Za-z_$<][\w$.<>]{0,99}$/);
/** A Sentry operation or origin, such as `http.server` or `auto.db.otel.postgres`. */
export const operation = matching(/^[a-z][a-z0-9_.]{0,63}$/);
export const httpMethod = matching(/^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/);
export const sdkName = matching(/^[a-z0-9.:/-]{1,64}$/);
export const contentType = matching(
  /^[a-z]+\/[a-z0-9.+-]{1,64}(?:; ?charset=[A-Za-z0-9-]{1,32})?$/,
);

export const finite: Shape = (value) => typeof value === 'number' && Number.isFinite(value);
export const integer: Shape = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const boolean: Shape = (value) => typeof value === 'boolean';

export const oneOf =
  (values: readonly string[]): Shape =>
  (value) =>
    typeof value === 'string' && values.includes(value);
