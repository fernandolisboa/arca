/** The only fields a log line may carry (spec 0001, R3); anything else is dropped. */
const allowedFields = [
  'level',
  'requestId',
  'route',
  'method',
  'status',
  'durationMs',
  'errorCode',
] as const;

export type LogField = (typeof allowedFields)[number];
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
    for (const field of allowedFields) {
      const value = entry[field];
      if (field !== 'level' && (typeof value === 'string' || typeof value === 'number'))
        line[field] = value;
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
