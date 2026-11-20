import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ReadPage, checkItems, machineReadableUrls } from '@arca/domain';
import {
  type ReviewDirs,
  evidenceProblems,
  readEvidence,
  reviewedVersions,
  sessionReviews,
} from '@arca/knowledge/session-review';
import { hostOf } from '@arca/scripts/host';
import { describe, expect, it } from 'vitest';
import { answerFormat } from '../src/knowledge/pages/answer-text.js';
import {
  type SourceFetcher,
  answerWithinLimits,
  fetchLimits,
  httpsSourceFetcher,
} from '../src/knowledge/pages/fetcher.js';
import { hostsByUrl, readOfficialPage } from '../src/knowledge/update/official-page.js';

const knowledgeDir = fileURLToPath(new URL('../../../packages/knowledge', import.meta.url));
const dirs: ReviewDirs = {
  dataDir: join(knowledgeDir, 'data'),
  familiesDir: join(knowledgeDir, '..', '..', 'eval', 'families'),
  reviewsDir: join(knowledgeDir, 'reviews'),
};

/** The reviews to read, by ID: the `review-quotes` job names those a pull request changes. */
const wanted = new Set((process.env['ARCA_REVIEW_QUOTES'] ?? '').split(',').filter(Boolean));

/**
 * A session's sandbox reaches the network only through its proxy, which the guarded fetcher
 * never uses, so there the page comes through `fetch` and is read as the app reads an answer.
 * The job in CI, the one that counts, uses the guarded fetcher itself.
 */
const throughProxy: SourceFetcher = {
  async fetch(url, hosts) {
    const chain = [url];
    const host = hostOf(url);
    const allowed = hosts.some((name) => host === name || host?.endsWith(`.${name}`) === true);
    if (!allowed) return { ok: false, failure: 'refused_url', status: null, chain };
    const signal = AbortSignal.timeout(fetchLimits.timeoutMs);
    const answer = await fetch(url, { redirect: 'error', signal });
    if (!answer.ok) return { ok: false, failure: 'http_status', status: answer.status, chain };
    const type = (answer.headers.get('content-type') ?? '').split(';')[0] ?? '';
    const format = answerFormat(type.trim().toLowerCase());
    if (format === undefined)
      return { ok: false, failure: 'no_text', status: answer.status, chain };
    const bytes = new Uint8Array(await answer.arrayBuffer());
    const read = await answerWithinLimits(
      format,
      { bytes, text: () => new TextDecoder().decode(bytes) },
      signal,
    );
    return read.ok
      ? { ok: true, status: answer.status, text: read.text, cut: read.cut, chain }
      : { ok: false, failure: read.failure, status: answer.status, chain };
  },
};
const fetcher = process.env['HTTPS_PROXY'] === undefined ? httpsSourceFetcher() : throughProxy;

// Reads official pages, so it runs only when asked: ARCA_REVIEW_QUOTES=<review>[,<review>].
describe.skipIf(wanted.size === 0)('the evidence of a session review (ADR-0032)', () => {
  it.each(sessionReviews.filter(({ id }) => wanted.has(id)))(
    "$id: every item matches on the official pages it cites, by the app's quote check",
    async (review) => {
      for (const version of await reviewedVersions(dirs, review)) {
        const addresses = machineReadableUrls(version.entry);
        const pages = new Map<string, ReadPage>();
        const unread: string[] = [];
        for (const [url, hosts] of hostsByUrl(checkItems(version.entry), version.officialHosts)) {
          const { outcome, page } = await readOfficialPage(fetcher, url, addresses.get(url), hosts);
          if (page === undefined)
            unread.push(`${url}: ${outcome.ok ? 'no page' : outcome.failure}`);
          else pages.set(url, page);
        }
        expect(unread).toEqual([]);
        const evidence = await readEvidence(
          dirs.reviewsDir,
          review,
          version.routeId,
          version.number,
        );
        expect(evidenceProblems(version.entry, evidence, pages)).toEqual([]);
      }
    },
    600_000,
  );
});
