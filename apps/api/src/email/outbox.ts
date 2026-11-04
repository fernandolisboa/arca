import type { Database } from '@arca/db';
import { outbox } from '@arca/db/notice-schema';
import { desc, gt, lte, sql } from 'drizzle-orm';
import type { DeploymentEnvironment } from '../config.js';
import type { EmailMessage, EmailSender } from './email.js';

export class OutboxInProductionError extends Error {
  override name = 'OutboxInProductionError';
}

function refuseProduction(environment: DeploymentEnvironment): void {
  if (environment === 'production') {
    throw new OutboxInProductionError('production sends real email, never to the outbox');
  }
}

/**
 * Outside production, messages land in `auth.outbox` instead of an inbox (spec 0003, R8). Each
 * write first deletes the rows past their 7 days.
 */
export function outboxSender(db: Database, environment: DeploymentEnvironment): EmailSender {
  refuseProduction(environment);
  return {
    send: ({ to, subject, text }) =>
      db.transaction(async (tx) => {
        await tx.delete(outbox).where(lte(outbox.expiresAt, sql`now()`));
        await tx.insert(outbox).values({ recipient: to, subject, body: text });
      }),
  };
}

export interface OutboxEntry extends EmailMessage {
  readonly sentAt: string;
}

const shown = 100;

/** The unexpired messages, newest first, for `/internal/outbox` on previews. */
export async function readOutbox(
  db: Database,
  environment: DeploymentEnvironment,
): Promise<OutboxEntry[]> {
  refuseProduction(environment);
  const rows = await db
    .select()
    .from(outbox)
    .where(gt(outbox.expiresAt, sql`now()`))
    .orderBy(desc(outbox.createdAt))
    .limit(shown);
  return rows.map((row) => ({
    to: row.recipient,
    subject: row.subject,
    text: row.body,
    sentAt: row.createdAt.toISOString(),
  }));
}
