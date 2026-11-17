import {
  type EditItemRequest,
  type EditItemResponse,
  type ProposedDomainList,
  type ReviewItem,
  type VersionReview,
  editableItemKinds,
} from '@arca/api-contract/routes';
import {
  type DecisionStates,
  type RouteVersion,
  asDataText,
  checkItems,
  identityKey,
  machineReadableUrls,
  officialDomainListSchema,
  officialDomainsKey,
  pageLanguages,
  verifyAnswers,
} from '@arca/domain';
import { type Database, withIdentity } from '@arca/db';
import {
  type Json,
  type RuleRowReading,
  type RuleRows,
  checkProposal,
  approvedOfficialDomainLists,
  pinKey,
  verifiedOfficialDomainLists,
  verifiedRouteVersion,
} from '@arca/knowledge';
import { sql } from 'drizzle-orm';
import type { AuditLog } from '../../audit/log.js';
import type { SourceFetcher } from '../check/fetcher.js';
import type { AdminRole } from '../admins.js';
import { readOfficialPage } from './official-page.js';
import type { UpdateItem, UpdateStore } from './store.js';

export type EditRefusal = 'not_admin' | 'not_found' | 'already_rejected' | 'live' | 'taken';

export interface VersionReviews {
  /** One version's three lists, hand edits marked, and the items an admin may edit. */
  readonly review: (
    accountId: string,
    routeId: string,
    number: number,
  ) => Promise<VersionReview | 'not_admin' | 'not_found'>;
  /** Stores a new proposed version with one item edited by hand, after the checks in code. */
  readonly edit: (
    accountId: string,
    request: EditItemRequest,
  ) => Promise<EditItemResponse | EditRefusal>;
}

export interface VersionReviewDependencies {
  /** The app_api pool. */
  readonly db: () => Database;
  readonly role: AdminRole;
  readonly audit: Pick<AuditLog, 'record'>;
  readonly store: Pick<UpdateStore, 'end'>;
  readonly rows: () => Promise<RuleRows>;
  readonly reading: RuleRowReading;
  readonly states: () => Promise<DecisionStates>;
  readonly fetcher: SourceFetcher;
  /** Today in São Paulo, the date the edited source is verified on. */
  readonly today: () => string;
}

type EditableKind = (typeof editableItemKinds)[number];

const fields = {
  requirement: 'requirements',
  assessment: 'assessments',
  dependent: 'dependents',
  cost: 'costs',
  duration: 'durations',
} as const satisfies Record<EditableKind, keyof RouteVersion>;

/** A version's chain of hand edits is at most this deep before its lists stop being followed. */
const maxEditDepth = 50;

const isEditable = (kind: string): kind is EditableKind =>
  (editableItemKinds as readonly string[]).includes(kind);

const asObject = (value: unknown): Record<string, Json> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : undefined;

/** The item an edit names in a version's raw content, by its kind and ID. */
function namedItem(content: Json, itemKey: string) {
  const [kind, id, ...rest] = itemKey.split(':');
  if (kind === undefined || id === undefined || rest.length > 0 || !isEditable(kind)) {
    return undefined;
  }
  const field = fields[kind];
  const value = asObject(content)?.[field];
  if (!Array.isArray(value)) return undefined;
  const list: readonly Json[] = value;
  const index = list.findIndex((item) => asObject(item)?.['id'] === id);
  return index < 0 ? undefined : { field, list, index, id };
}

/** Each editable item of a version, with its content as stored. */
function editableItems(version: RouteVersion, stored: Json): VersionReview['editable'] {
  return editableItemKinds.flatMap((kind) =>
    version[fields[kind]].map(({ id, title }) => {
      const key = `${kind}:${id}`;
      const found = namedItem(stored, key);
      const item = found === undefined ? null : (found.list[found.index] ?? null);
      return { key, kind, title, content: JSON.stringify(item, null, 2) };
    }),
  );
}

/** The lists with the edited item put first among the confirmed ones, marked as an admin's. */
function withEdit(items: readonly ReviewItem[], edit: EditRow, title: string): ReviewItem[] {
  const edited: ReviewItem = {
    key: edit.itemKey,
    kind: edit.itemKey.split(':')[0] ?? '',
    title,
    list: 'confirmed',
    reason: null,
    quotes: [{ url: edit.url, quote: edit.quote }],
    urls: [edit.url],
    edited: true,
  };
  return [edited, ...items.filter(({ key }) => key !== edit.itemKey)];
}

interface EditRow {
  readonly itemKey: string;
  readonly url: string;
  readonly quote: string;
}

const asReviewItem = (item: UpdateItem): ReviewItem => ({ ...item, edited: false });

/**
 * The first official-domain list a version pins that a new-route request proposed, with its state
 * (ADR-0031), or null when every list it pins was imported.
 */
function proposedListOf(
  stored: RuleRows,
  version: RouteVersion,
  reading: RuleRowReading,
  states: DecisionStates,
): ProposedDomainList | null {
  const lists = verifiedOfficialDomainLists(stored, reading);
  for (const pin of version.officialDomains) {
    const list = lists.find(({ id, number }) => id === pin.id && number === pin.number);
    const row = stored.officialDomainLists.find(
      ({ id, number }) => id === pin.id && number === pin.number,
    );
    const content = officialDomainListSchema.safeParse(row?.content);
    if (list?.fromRequest !== true || !content.success) continue;
    const identity = { listId: list.id, number: list.number, hash: list.hash };
    return {
      ...identity,
      state: states.get(officialDomainsKey(identity)) ?? 'proposed',
      issuer: content.data.issuer,
      hosts: content.data.hosts.map(({ host, source }) => ({
        host,
        proof: { url: source.url, title: source.title },
      })),
    };
  }
  return null;
}

/** Until its first list is active, a new country's items rest on hosts nobody approved yet. */
const listPending = (item: ReviewItem): ReviewItem => ({
  ...item,
  list: 'unconfirmed',
  reason: 'list_pending',
});

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * Reviews and hand edits of route versions (ADR-0031), on the app_api pool. A review reads the
 * proposal's lists from the request that ended with it, following hand edits back to it; an edit
 * builds the new version from the stored one, checks it as a proposal is checked, reads the cited
 * page and verifies the quote in code, then stores it through the definer function. No model runs.
 */
export function createVersionReviews({
  db,
  role,
  audit,
  store,
  rows: rowsOf,
  reading,
  states,
  fetcher,
  today,
}: VersionReviewDependencies): VersionReviews {
  /** What links a stored version to its request or to an admin's edit. */
  const originOf = async (routeId: string, number: number) => {
    const { rows } = await db().execute<{
      request_id: string | null;
      item_key: string | null;
      url: string | null;
      quote: string | null;
    }>(sql`
      SELECT v.request_id, e.item_key, e.url, e.quote
        FROM knowledge.route_version v
        LEFT JOIN knowledge.version_edit e ON e.route_id = v.route_id AND e.number = v.number
       WHERE v.route_id = ${routeId} AND v.number = ${number}`);
    const row = rows[0];
    if (row === undefined) return undefined;
    const edit =
      row.item_key === null || row.url === null || row.quote === null
        ? undefined
        : { itemKey: row.item_key, url: row.url, quote: row.quote };
    return { requestId: row.request_id, edit };
  };

  const listsOf = async (
    stored: RuleRows,
    routeId: string,
    number: number,
    depth: number,
  ): Promise<Pick<VersionReview, 'origin' | 'items'> | undefined> => {
    const verified = verifiedRouteVersion(stored, routeId, number, reading);
    const origin = verified === undefined ? undefined : await originOf(routeId, number);
    if (verified === undefined || origin === undefined) return undefined;
    if (origin.requestId !== null) {
      const end = await store.end(origin.requestId);
      const items = end?.failure === null ? end.proposal.items.map(asReviewItem) : [];
      return { origin: 'request', items };
    }
    if (origin.edit !== undefined) {
      const { corrects } = verified.version;
      const earlier =
        corrects === undefined || depth >= maxEditDepth
          ? undefined
          : await listsOf(stored, routeId, corrects, depth + 1);
      const title = editableItems(verified.version, verified.row.content).find(
        ({ key }) => key === origin.edit?.itemKey,
      )?.title;
      return {
        origin: 'edit',
        items: withEdit(earlier?.items ?? [], origin.edit, title ?? origin.edit.itemKey),
      };
    }
    return { origin: 'none', items: [] };
  };

  const refused = (problems: readonly string[]): EditItemResponse => ({
    outcome: 'refused',
    problems: problems.slice(0, 50).map((line) => line.slice(0, 500)),
  });

  return {
    review: async (accountId, routeId, number) => {
      if (!(await role.isAdmin(accountId))) return 'not_admin';
      const stored = await rowsOf();
      const verified = verifiedRouteVersion(stored, routeId, number, reading);
      const lists = await listsOf(stored, routeId, number, 0);
      if (verified === undefined || lists === undefined) return 'not_found';
      const current = await states();
      const domainList = proposedListOf(stored, verified.version, reading, current);
      // Masked unless every list the version pins is approved, so an unread list fails closed.
      const approved = new Set(approvedOfficialDomainLists(stored, reading, current).map(pinKey));
      const pending = verified.version.officialDomains.some((pin) => !approved.has(pinKey(pin)));
      return {
        ...lists,
        items: pending ? lists.items.map(listPending) : lists.items,
        editable: editableItems(verified.version, verified.row.content),
        domainList,
      };
    },

    edit: async (accountId, request) => {
      if (!(await role.isAdmin(accountId))) return 'not_admin';
      const { routeId, number, itemKey, source, quote } = request;
      const stored = await rowsOf();
      const verified = verifiedRouteVersion(stored, routeId, number, reading);
      const named = verified === undefined ? undefined : namedItem(verified.row.content, itemKey);
      if (verified === undefined || named === undefined) return 'not_found';
      const identity = { routeId, number, hash: verified.row.contentHash };
      if ((await states()).get(identityKey(identity)) === 'rejected') return 'already_rejected';

      const item = asObject(parseJson(request.content));
      if (item?.['id'] !== named.id) return refused([`/${named.field}: The item keeps its ID`]);
      const { version } = verified;
      const cited = version.sources.find(
        ({ url, kind }) => url === source.url && kind === 'official',
      );
      const ids = new Set(version.sources.map(({ id }) => id));
      let sourceId = cited?.id ?? 'edited-source';
      for (let next = 2; cited === undefined && ids.has(sourceId); next += 1) {
        sourceId = `edited-source-${String(next)}`;
      }
      const cites = item['sources'];
      const sources: readonly Json[] = Array.isArray(cites) ? cites : [];
      const edited = {
        ...item,
        sources: sources.includes(sourceId) ? sources : [...sources, sourceId],
      };
      const newest = Math.max(
        ...stored.routeVersions.filter((row) => row.routeId === routeId).map((row) => row.number),
      );
      const raw = asObject(verified.row.content) ?? {};
      const content: Json = {
        ...raw,
        number: newest + 1,
        corrects: number,
        [named.field]: named.list.map((each, index) => (index === named.index ? edited : each)),
        sources:
          cited === undefined
            ? [
                ...version.sources,
                {
                  id: sourceId,
                  url: source.url,
                  title: source.title,
                  kind: 'official',
                  verifiedAt: today(),
                },
              ]
            : version.sources.map((each) =>
                each.id === cited.id ? { ...each, verifiedAt: today() } : each,
              ),
      } as unknown as Json;

      const checked = await checkProposal(
        stored,
        { kind: 'update', base: version },
        content,
        verified.row.cases,
        reading,
      );
      if (!checked.ok) return refused(checked.problems);
      const checkItem = checkItems(checked.entry).find(({ key }) => key === itemKey);
      if (!checkItem?.urls.includes(source.url)) {
        return refused([`${itemKey}: The item cites ${source.url} as an official source`]);
      }
      const { outcome, page } = await readOfficialPage(
        fetcher,
        source.url,
        machineReadableUrls(checked.entry).get(source.url),
        checked.officialHosts(checkItem.officialDomains) ?? [],
      );
      if (page === undefined) {
        return refused([
          `${source.url}: The page could not be read (${outcome.ok ? 'read' : outcome.failure})`,
        ]);
      }
      const [result] = verifyAnswers(
        [checkItem],
        [
          {
            key: itemKey,
            status: 'matches',
            quotes: [{ url: source.url, quote: asDataText(quote) }],
          },
        ],
        new Map([[source.url, page]]),
        pageLanguages(checked.entry.version.country),
      );
      if (result?.status !== 'matches') {
        return refused([
          `${itemKey}: The quote is on the page and states the item's values (${result?.reason ?? 'unchecked'})`,
        ]);
      }

      const corrected = checked.entry.version.number;
      const outcomeOf = await withIdentity(db(), { accountId }, async (tx) => {
        const held = await role.held(tx, accountId);
        if (held === undefined) return 'not_admin' as const;
        const { basis, grantId } = held.basis;
        const { rows: answer } = await tx.execute<{ outcome: string }>(sql`
          SELECT knowledge.edit_route_version(${routeId}, ${corrected}, ${number},
            ${JSON.stringify(content)}::jsonb, ${checked.hash},
            ${verified.row.cases === null ? null : JSON.stringify(verified.row.cases)}::jsonb, ${itemKey}, ${source.url}, ${quote},
            ${basis}, ${grantId}::uuid) AS outcome`);
        const stored = answer[0]?.outcome;
        if (stored === 'live' || stored === 'taken') return stored;
        await audit.record({
          code: 'version_edited',
          subjectAccountId: accountId,
          actorAccountId: accountId,
          details: { routeId, number: corrected, corrects: number },
        });
        return 'stored' as const;
      });
      return outcomeOf === 'stored' ? { outcome: 'stored', number: corrected } : outcomeOf;
    },
  };
}
