import {
  errorCode,
  errorName,
  finite,
  httpMethod,
  integer,
  modelOrPromptId,
  routePattern,
  traceId,
  uuid,
  type Shape,
} from './shapes.js';

/**
 * The only fields a log line may carry, each with the values it accepts (spec 0001, R3; spec
 * 0004, R3). Anything else is dropped, so a careless caller cannot put personal data in a log line.
 */
const allowedFields = {
  requestId: uuid,
  traceId,
  method: httpMethod,
  /** The matched route pattern, never the request path. */
  route: routePattern,
  status: finite,
  durationMs: finite,
  errorCode,
  errorName,
  /** A model call's metadata (spec 0008, R3): never its prompt, input or reply. */
  model: modelOrPromptId,
  promptVersion: modelOrPromptId,
  inputTokens: integer,
  outputTokens: integer,
} as const satisfies Readonly<Record<string, Shape>>;

export type LogField = keyof typeof allowedFields;
export type LogEntry = Partial<Record<LogField, string | number>>;

export interface Logger {
  info(entry: LogEntry): void;
  error(entry: LogEntry): void;
}

/** Writes one JSON line per entry through `write`, with only the allow-listed fields. */
export function createLogger(write: (line: string) => void): Logger {
  const log = (level: 'info' | 'error', entry: Readonly<Record<string, unknown>>) => {
    const line: Record<string, unknown> = { level };
    for (const [field, accepts] of Object.entries(allowedFields)) {
      const value = entry[field];
      if (accepts(value)) line[field] = value;
    }
    write(JSON.stringify(line));
  };
  return {
    info: (entry) => {
      log('info', entry);
    },
    error: (entry) => {
      log('error', entry);
    },
  };
}
