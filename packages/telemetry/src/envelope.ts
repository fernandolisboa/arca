import { isRecord, keep, object, type Scrubbed } from './rules.js';
import { sdk } from './sentry.js';
import { eventId } from './shapes.js';

export interface TunnelPolicy {
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
  event_id: keep(eventId),
  sent_at: keep((value) => typeof value === 'string' && /^[0-9TZ:.+-]{1,40}$/.test(value)),
  sdk,
});

/**
 * A browser envelope as the tunnel forwards it: only for our DSN, only its error events, each
 * scrubbed again (the browser sends errors only, spec 0004 R5); anything else in it, transactions,
 * attachments and replays included, is dropped. Null when nothing may be forwarded.
 */
export function scrubEnvelope(envelope: string, { dsn, event }: TunnelPolicy): string | null {
  const lines = envelope.split('\n');
  const head = parse(lines[0]);
  if (!isRecord(head) || head['dsn'] !== dsn) return null;
  const kept: string[] = [JSON.stringify({ ...(header(head) as object), dsn })];
  for (let index = 1; index + 1 < lines.length; index += 2) {
    const item = parse(lines[index]);
    if (!isRecord(item)) return null;
    // An item framed by length may hold newlines, so the lines after it no longer align.
    if (item['type'] !== 'event' && item['length'] !== undefined) break;
    if (item['type'] !== 'event') continue;
    const scrubbed = event(parse(lines[index + 1]));
    if (scrubbed === null || 'type' in scrubbed) continue;
    kept.push(JSON.stringify({ type: 'event' }), JSON.stringify(scrubbed));
  }
  return kept.length > 1 ? kept.join('\n') : null;
}
