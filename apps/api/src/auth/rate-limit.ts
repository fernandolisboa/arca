import { createHmac } from 'node:crypto';
import type { Database } from '@arca/db';
import { rateLimit } from '@arca/db/rate-limit-schema';
import { lte, sql } from 'drizzle-orm';

/** A limit: at most `limit` hits per window of `windowSeconds` for each subject. */
export interface RateLimitRule {
  /** Part of the stored key, so the rules never share a counter. */
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export type RateLimitOutcome =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface RateLimiter {
  /** Counts one hit for the subject (an IP address, an email address, an account ID). */
  hit(rule: RateLimitRule, subject: string): Promise<RateLimitOutcome>;
  /** Deletes the windows that have ended, so the table holds only live counters. */
  sweep(): Promise<number>;
}

const namePattern = /^[a-z_]{1,48}$/;

/**
 * Fixed-window counters in `auth.rate_limit` (spec 0003, R10), on the app_auth pool. The stored
 * key is the rule's name and an HMAC of the subject, never the subject itself.
 */
export function rateLimiter({ db, key }: { db: Database; key: string }): RateLimiter {
  return {
    async hit(rule, subject) {
      if (!namePattern.test(rule.name) || rule.limit < 1 || rule.windowSeconds < 1) {
        throw new RangeError('invalid rate limit rule');
      }
      const digest = createHmac('sha256', key)
        .update(`${rule.name}\u0000${subject}`)
        .digest('base64url');
      const window = sql`make_interval(secs => ${rule.windowSeconds})`;
      // One statement, so concurrent hits on the same key never lose a count.
      const result = await db.execute<{ count: number; retry_after: number }>(sql`
        INSERT INTO auth.rate_limit AS existing (key, count, expires_at)
        VALUES (${`${rule.name}:${digest}`}, 1, now() + ${window})
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN existing.expires_at <= now() THEN 1 ELSE existing.count + 1 END,
          expires_at = CASE WHEN existing.expires_at <= now() THEN now() + ${window}
                            ELSE existing.expires_at END
        RETURNING count, ceil(extract(epoch FROM expires_at - now()))::integer AS retry_after`);
      const [row] = result.rows;
      if (row === undefined) throw new Error('the rate limit upsert returned no row');
      return row.count <= rule.limit
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: Math.max(1, row.retry_after) };
    },
    async sweep() {
      const deleted = await db
        .delete(rateLimit)
        .where(lte(rateLimit.expiresAt, sql`now()`))
        .returning({ key: rateLimit.key });
      return deleted.length;
    },
  };
}
