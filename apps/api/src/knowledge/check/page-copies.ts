import { createHash } from 'node:crypto';
import type { Database } from '@arca/db';
import { sql } from 'drizzle-orm';
import type { ObjectStorage } from '../../vault/object-storage.js';
import { answerFormat } from './answer-text.js';
import { answerWithinLimits, fetchLimits } from './fetcher.js';

/** A copy's text within the per-page cap, and whether the cap cut it. */
export interface CopyText {
  readonly text: string;
  readonly cut: boolean;
}

/**
 * Copies of official pages that an owner-list admin attached to correction requests (ADR-0029,
 * page copies): the independent check reads one only when it cannot read the page itself.
 */
export interface PageCopies {
  /** The text of the newest stored copy of the page, or undefined when there is none to read. */
  readonly read: (url: string) => Promise<CopyText | undefined>;
}

/** Where no copy is ever read: the catalog check, and tests that do not need one. */
export const noPageCopies: PageCopies = { read: () => Promise.resolve(undefined) };

export interface PageCopySettings {
  /** The app_jobs pool, which may execute `knowledge.correction_page_copies`. */
  readonly db: () => Database;
  readonly storage: Pick<ObjectStorage, 'read'>;
}

interface StoredCopy extends Record<string, unknown> {
  pathname: string;
  media_type: string;
  size: number;
  sha256: Buffer;
}

/**
 * Reads a copy only when the store holds the bytes its upload recorded, by size and SHA-256, and
 * by the type filing checked; a copy with no text, or one that differs, is not read.
 */
export function storedPageCopies({ db, storage }: PageCopySettings): PageCopies {
  return {
    async read(url) {
      const { rows } = await db().execute<StoredCopy>(sql`
        SELECT pathname, media_type, size, sha256
          FROM knowledge.correction_page_copies(ARRAY[${url}]::text[])`);
      const copy = rows[0];
      const format = copy === undefined ? undefined : answerFormat(copy.media_type);
      if (copy === undefined || format === undefined) return undefined;
      const bytes = await storage.read(copy.pathname, copy.size);
      if (
        bytes === undefined ||
        !createHash('sha256').update(bytes).digest().equals(Buffer.from(copy.sha256))
      ) {
        return undefined;
      }
      // Saved pages are read as UTF-8, which official sites serve today; other bytes become U+FFFD.
      const read = await answerWithinLimits(
        format,
        { bytes, text: () => new TextDecoder('utf-8', { fatal: false }).decode(bytes) },
        AbortSignal.timeout(fetchLimits.timeoutMs),
      );
      return read.ok ? { text: read.text, cut: read.cut } : undefined;
    },
  };
}
