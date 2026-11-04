import { isRecord, keep, object } from './rules.js';
import { release, sdkName } from './shapes.js';
import type { Scrubbed } from './sentry.js';

export interface EnvelopeScrubbers {
  /** The one DSN the tunnel forwards for (spec 0004, R5). */
  readonly dsn: string;
  readonly event: (value: unknown) => Scrubbed | null;
}

const parse = (line: string | undefined): unknown => {
  if (line === undefined) return undefined;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
};

const header = object({
  event_id: keep((value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)),
  sent_at: keep((value) => typeof value === 'string' && /^[0-9TZ:.+-]{1,40}$/.test(value)),
  sdk: object({ name: keep(sdkName), version: keep(release) }),
});

/**
 * A browser envelope as the tunnel forwards it: only for our DSN, only its event and transaction
 * items, each scrubbed again; anything else in it, attachments and replays included, is dropped.
 * Null when nothing may be forwarded.
 */
export function scrubEnvelope(envelope: string, { dsn, event }: EnvelopeScrubbers): string | null {
  const lines = envelope.split('\n');
  const head = parse(lines[0]);
  if (!isRecord(head) || head['dsn'] !== dsn) return null;
  const kept: string[] = [JSON.stringify({ ...(header(head) as object), dsn })];
  for (let index = 1; index + 1 < lines.length; index += 2) {
    const item = parse(lines[index]);
    if (!isRecord(item)) return null;
    const type = item['type'];
    if (type !== 'event' && type !== 'transaction') continue;
    const scrubbed = event(parse(lines[index + 1]));
    if (scrubbed === null) continue;
    kept.push(JSON.stringify({ type }), JSON.stringify(scrubbed));
  }
  return kept.length > 1 ? kept.join('\n') : null;
}
