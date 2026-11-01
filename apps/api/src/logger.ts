const identifier = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value);
const text = (value: unknown) => typeof value === 'string' && value.length <= 256;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/**
 * The only fields a log line may carry, each with the values it accepts (spec 0001, R3).
 * Anything else is dropped, so a careless caller cannot put personal data in a log line.
 */
const allowedFields = {
  requestId: text,
  method: identifier,
  /** The matched route pattern, never the request path. */
  route: text,
  status: number,
  durationMs: number,
  errorCode: identifier,
  errorName: identifier,
} as const;

export type LogField = keyof typeof allowedFields;
export type LogEntry = Partial<Record<LogField, string | number>>;

export interface Logger {
  info(entry: LogEntry): void;
  error(entry: LogEntry): void;
}

export function createLogger(
  write: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
): Logger {
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
