import {
  AuditEvent,
  auditEventDetails,
  type AuditEventCode,
  type AuditEventDetails,
  type AuditEventsQuery,
  type AuditEventsResponse,
} from '@arca/api-contract/routes';
import { withIdentity, type Database } from '@arca/db';
import { event } from '@arca/db/audit-schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

/** An event to record; the database sets its ID and time (spec 0003, R7). */
export interface AuditRecord<Code extends AuditEventCode = AuditEventCode> {
  readonly code: Code;
  readonly subjectAccountId: string;
  /** Null when the system acted, for example an expiry. */
  readonly actorAccountId: string | null;
  readonly requestId?: string;
  readonly details: AuditEventDetails<Code>;
}

export interface AuditLog {
  record<Code extends AuditEventCode>(entry: AuditRecord<Code>): Promise<void>;
}

export class InvalidAuditEventError extends Error {
  override name = 'InvalidAuditEventError';
}

const accountId = z.uuid();
const requestId = z.uuid().optional();

/** Checks an event against the closed list before anything reaches the database. */
export function validateAuditRecord(entry: AuditRecord): AuditRecord {
  const known = Object.hasOwn(auditEventDetails, entry.code);
  const details = known ? auditEventDetails[entry.code].safeParse(entry.details) : undefined;
  const ids = [
    accountId.safeParse(entry.subjectAccountId),
    entry.actorAccountId === null ? { success: true } : accountId.safeParse(entry.actorAccountId),
    requestId.safeParse(entry.requestId),
  ];
  // The message names a known code only: a rejected value may be the personal data it keeps out.
  if (details?.success !== true || ids.some((result) => !result.success)) {
    throw new InvalidAuditEventError(
      known ? `audit event ${entry.code} is not allowed` : 'unknown audit event code',
    );
  }
  return { ...entry, details: details.data };
}

/**
 * The writer, on the app_audit pool. It names only the columns app_audit may insert, so the
 * database fills in the ID and the time.
 */
export function auditLog(db: Database): AuditLog {
  return {
    async record(entry) {
      const valid = validateAuditRecord(entry);
      await db.execute(sql`
        INSERT INTO audit.event (actor_account_id, subject_account_id, code, request_id, details)
        VALUES (${valid.actorAccountId}, ${valid.subjectAccountId}, ${valid.code},
                ${valid.requestId ?? null}, ${JSON.stringify(valid.details)}::jsonb)`);
    },
  };
}

export interface AuditReader {
  /** The account's own events, newest first; row-level security limits the rows it sees. */
  events(accountId: string, query: AuditEventsQuery): Promise<AuditEventsResponse>;
}

const defaultPageSize = 50;

/** The reader, on the app_api pool, under the account's request identity. */
export function auditReader(db: Database): AuditReader {
  return {
    events: (account, { before, limit = defaultPageSize }) =>
      withIdentity(db, { accountId: account }, async (tx) => {
        // Keyset pagination on (time, id). A cursor the account cannot see matches no row, so
        // the subquery is null and the page is empty.
        const after =
          before === undefined
            ? undefined
            : sql`(${event.time}, ${event.id}) < (SELECT c.time, c.id FROM audit.event c WHERE c.id = ${before})`;
        // Row-level security already limits the rows; the filter states it and uses the index.
        const rows = await tx
          .select()
          .from(event)
          .where(and(eq(event.subjectAccountId, account), after))
          .orderBy(desc(event.time), desc(event.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        return {
          events: page.map((row) =>
            AuditEvent.parse({
              id: row.id,
              time: row.time.toISOString(),
              code: row.code,
              actorAccountId: row.actorAccountId,
              details: row.details,
            }),
          ),
          next: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
        };
      }),
  };
}
