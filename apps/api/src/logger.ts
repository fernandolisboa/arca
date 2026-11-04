import { createLogger, type Logger } from '@arca/telemetry';

/** The API's logger: one scrubbed JSON line per entry on standard output (spec 0004, R3). */
export const stdoutLogger = (): Logger =>
  createLogger((line) => {
    process.stdout.write(`${line}\n`);
  });
