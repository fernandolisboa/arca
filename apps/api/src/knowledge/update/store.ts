import {
  type ModelUsage,
  type UpdateFailure,
  type UpdateStage,
  type ValidatorVerdict,
  proposalLists,
  updateFailures,
  validatorVerdicts,
} from '@arca/domain';
import type { Database } from '@arca/db';
import { ruleVerdict, updateEnd, updateRequest, updateStage } from '@arca/db/knowledge-schema';
import { asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { researchReplySchema } from './ports.js';

/** One item of a validation, as the admin's lists show it (ADR-0031). */
export const updateItemSchema = z.strictObject({
  key: z.string().max(120),
  kind: z.string().max(40),
  title: z.string().max(200),
  list: z.enum(proposalLists),
  reason: z.string().max(40).nullable(),
  /** The quotes code verified, each with its page; empty when none was. */
  quotes: z
    .array(z.strictObject({ url: z.string().max(2000), quote: z.string().max(2000) }))
    .max(5),
  /** The official pages the item cites. */
  urls: z.array(z.string().max(2000)).max(20),
});
export type UpdateItem = z.infer<typeof updateItemSchema>;

/** A new country's first official-domain list, as code checked it with its proposal (ADR-0031). */
export const proposedListSchema = z.strictObject({ content: z.json(), contentHash: z.string() });
export type ProposedList = z.infer<typeof proposedListSchema>;

/** What a validation found: the checked proposal, or why it is none, and each item's list. */
export const validationOutputSchema = z.strictObject({
  problems: z.array(z.string().max(2000)).max(50),
  proposal: z
    .strictObject({
      content: z.json(),
      contentHash: z.string(),
      cases: z.json(),
      domainList: proposedListSchema.optional(),
    })
    .nullable(),
  items: z.array(updateItemSchema).max(400),
  pages: z
    .array(
      z.strictObject({
        url: z.string().max(2000),
        outcome: z.string().max(40),
        sha256: z.string().nullable(),
      }),
    )
    .max(200),
});
export type ValidationOutput = z.infer<typeof validationOutputSchema>;

/** What a research or correction stage stored: the model's proposal, parsed but unchecked. */
export const researchOutputSchema = z.strictObject({ proposal: researchReplySchema });
export type ResearchOutput = z.infer<typeof researchOutputSchema>;

/** A proposal as an update request ends with it: the checked version and the three lists. */
export const endedProposalSchema = z.strictObject({
  content: z.json(),
  contentHash: z.string(),
  cases: z.json(),
  items: z.array(updateItemSchema).max(400),
  /** A new country's first official-domain list, stored with the version and decided apart. */
  domainList: proposedListSchema.optional(),
});
export type EndedProposal = z.infer<typeof endedProposalSchema>;

/** What a request asks for: a stored route researched again, or a new route of a country. */
export type RequestSubject =
  | { readonly kind: 'update'; readonly routeId: string; readonly baseNumber: number }
  | {
      readonly kind: 'new_route';
      readonly country: string;
      readonly visa: string;
      readonly links: readonly string[];
      /** The country's approved lists, `<id>/<number>`; empty for a country with none. */
      readonly listPins: readonly string[];
    };

export type StoredRequest = RequestSubject & {
  readonly id: string;
  /** Milliseconds since the epoch, on the database's clock. */
  readonly requestedAt: number;
};

/** A stored update of a route. */
export type StoredUpdate = Extract<StoredRequest, { readonly kind: 'update' }>;

/** A stored new-route request. */
export type StoredNewRoute = Extract<StoredRequest, { readonly kind: 'new_route' }>;

export interface StoredStage {
  readonly stage: UpdateStage;
  readonly failure: UpdateFailure | null;
  readonly needsCorrection: boolean;
  readonly proposalValid: boolean;
  readonly output: unknown;
  readonly usage: ModelUsage | null;
  readonly webSearches: number;
  readonly at: number;
}

export interface NewStage {
  readonly stage: UpdateStage;
  readonly failure: UpdateFailure | null;
  readonly needsCorrection: boolean | null;
  readonly proposalValid: boolean | null;
  readonly output: ResearchOutput | ValidationOutput | null;
  readonly usage: ModelUsage | null;
  readonly webSearches: number | null;
}

export type StoredEnd =
  | { readonly failure: UpdateFailure; readonly at: number }
  | { readonly failure: null; readonly proposal: EndedProposal; readonly at: number };

/** The update request tables (ADR-0031), as the pipeline's step and the API read them. */
export interface UpdateStore {
  readonly request: (id: string) => Promise<StoredRequest | undefined>;
  /** A route's newest request, if it has one. */
  readonly newest: (routeId: string) => Promise<StoredUpdate | undefined>;
  /** The newest new-route requests, newest first. */
  readonly newRoutes: (limit: number) => Promise<readonly StoredNewRoute[]>;
  readonly stages: (requestId: string) => Promise<readonly StoredStage[]>;
  readonly end: (requestId: string) => Promise<StoredEnd | undefined>;
  readonly addStage: (requestId: string, position: number, stage: NewStage) => Promise<void>;
  readonly finish: (
    requestId: string,
    end: { readonly failure: UpdateFailure } | { readonly proposal: EndedProposal },
  ) => Promise<void>;
  /** The stored validator answers among these cache keys. */
  readonly verdicts: (keys: readonly string[]) => Promise<ReadonlyMap<string, ValidatorVerdict>>;
  readonly remember: (
    verdicts: readonly { readonly key: string; readonly verdict: ValidatorVerdict }[],
  ) => Promise<void>;
}

const failureOf = (value: string | null): UpdateFailure | null =>
  value === null
    ? null
    : (((updateFailures as readonly string[]).includes(value)
        ? value
        : 'out_of_order') as UpdateFailure);

const ms = (at: Date) => at.getTime();

/**
 * The update request tables on a pool: app_jobs for the pipeline's step, which writes stages,
 * ends and verdicts; app_api for the screen, which only reads. Inserts name their columns, so a
 * role granted those columns alone can write them.
 */
export function postgresUpdateStore(db: () => Database): UpdateStore {
  const requestColumns = {
    id: updateRequest.id,
    routeId: updateRequest.routeId,
    baseNumber: updateRequest.baseNumber,
    country: updateRequest.country,
    visa: updateRequest.visa,
    links: updateRequest.links,
    listPins: updateRequest.listPins,
    requestedAt: updateRequest.requestedAt,
  };
  /** A row as its subject; the table's shape check makes every row one or the other. */
  const asRequest = (row: {
    id: string;
    routeId: string | null;
    baseNumber: number | null;
    country: string | null;
    visa: string | null;
    links: string[] | null;
    listPins: string[] | null;
    requestedAt: Date;
  }): StoredRequest => {
    const common = { id: row.id, requestedAt: ms(row.requestedAt) };
    return row.routeId !== null && row.baseNumber !== null
      ? { ...common, kind: 'update', routeId: row.routeId, baseNumber: row.baseNumber }
      : {
          ...common,
          kind: 'new_route',
          country: row.country ?? '',
          visa: row.visa ?? '',
          links: row.links ?? [],
          listPins: row.listPins ?? [],
        };
  };
  return {
    request: async (id) => {
      const [row] = await db()
        .select(requestColumns)
        .from(updateRequest)
        .where(eq(updateRequest.id, id));
      return row === undefined ? undefined : asRequest(row);
    },
    newest: async (routeId) => {
      const [row] = await db()
        .select(requestColumns)
        .from(updateRequest)
        .where(eq(updateRequest.routeId, routeId))
        .orderBy(desc(updateRequest.requestedAt))
        .limit(1);
      const request = row === undefined ? undefined : asRequest(row);
      return request?.kind === 'update' ? request : undefined;
    },
    newRoutes: async (limit) => {
      const rows = await db()
        .select(requestColumns)
        .from(updateRequest)
        .where(isNull(updateRequest.routeId))
        .orderBy(desc(updateRequest.requestedAt))
        .limit(limit);
      return rows
        .map(asRequest)
        .flatMap((request) => (request.kind === 'new_route' ? [request] : []));
    },
    stages: async (requestId) => {
      const rows = await db()
        .select()
        .from(updateStage)
        .where(eq(updateStage.requestId, requestId))
        .orderBy(asc(updateStage.position));
      return rows.map((row) => ({
        stage: row.stage,
        failure: failureOf(row.failure),
        needsCorrection: row.needsCorrection ?? false,
        proposalValid: row.proposalValid ?? false,
        output: row.output,
        usage:
          row.model === null
            ? null
            : {
                model: row.model,
                inputTokens: row.inputTokens,
                outputTokens: row.outputTokens,
                cacheReadTokens: row.cacheReadTokens,
                cacheWriteTokens: row.cacheWriteTokens,
              },
        webSearches: row.webSearches ?? 0,
        at: ms(row.at),
      }));
    },
    end: async (requestId) => {
      const [row] = await db().select().from(updateEnd).where(eq(updateEnd.requestId, requestId));
      if (row === undefined) return undefined;
      const failure = failureOf(row.failure);
      if (failure !== null) return { failure, at: ms(row.at) };
      const proposal = endedProposalSchema.safeParse(row.proposal);
      return proposal.success
        ? { failure: null, proposal: proposal.data, at: ms(row.at) }
        : { failure: 'out_of_order', at: ms(row.at) };
    },
    addStage: async (requestId, position, stage) => {
      const usage = stage.usage;
      await db().execute(sql`
        INSERT INTO knowledge.update_stage (request_id, position, stage, failure, needs_correction,
          proposal_valid, output, model, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, web_searches)
        VALUES (${requestId}, ${position}, ${stage.stage}, ${stage.failure},
          ${stage.needsCorrection}, ${stage.proposalValid},
          ${stage.output === null ? null : JSON.stringify(stage.output)}::jsonb,
          ${usage?.model ?? null}, ${usage?.inputTokens ?? null}, ${usage?.outputTokens ?? null},
          ${usage?.cacheReadTokens ?? null}, ${usage?.cacheWriteTokens ?? null},
          ${stage.webSearches})`);
    },
    finish: async (requestId, end) => {
      if ('failure' in end) {
        await db().execute(sql`
          INSERT INTO knowledge.update_end (request_id, failure) VALUES (${requestId}, ${end.failure})`);
        return;
      }
      const { content, contentHash, cases, domainList } = end.proposal;
      // The end and the version it proposes in one transaction: the version's insert policy reads
      // the end, and a version with no end is never stored (ADR-0031). A new country's first list
      // goes in with them, under the hash the end names.
      const stored = db().transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO knowledge.update_end (request_id, content_hash, proposal, list_hash)
          VALUES (${requestId}, ${contentHash}, ${JSON.stringify(end.proposal)}::jsonb,
                  ${domainList?.contentHash ?? null})`);
        if (domainList !== undefined) {
          await tx.execute(sql`
            INSERT INTO knowledge.official_domain_list (list_id, number, content, content_hash,
                                                        request_id)
            SELECT ${JSON.stringify(domainList.content)}::jsonb ->> 'id',
                   (${JSON.stringify(domainList.content)}::jsonb ->> 'number')::integer,
                   ${JSON.stringify(domainList.content)}::jsonb, ${domainList.contentHash},
                   ${requestId}`);
        }
        await tx.execute(sql`
          INSERT INTO knowledge.route_version (route_id, number, content, content_hash, cases,
                                               request_id)
          SELECT ${JSON.stringify(content)}::jsonb ->> 'routeId',
                 (${JSON.stringify(content)}::jsonb ->> 'number')::integer,
                 ${JSON.stringify(content)}::jsonb, ${contentHash}, ${JSON.stringify(cases)}::jsonb,
                 asked.id
            FROM knowledge.update_request asked WHERE asked.id = ${requestId}`);
      });
      // A request that ran past its live hour may find its number taken by an edit or a later
      // request; it then ends out of order instead of never ending.
      await stored.catch(async (error: unknown) => {
        if ((error as { cause?: { code?: unknown } }).cause?.code !== '23505') throw error;
        await db().execute(sql`
          INSERT INTO knowledge.update_end (request_id, failure)
          VALUES (${requestId}, 'out_of_order')`);
      });
    },
    verdicts: async (keys) => {
      if (keys.length === 0) return new Map();
      const rows = await db()
        .select({ key: ruleVerdict.cacheKey, verdict: ruleVerdict.verdict })
        .from(ruleVerdict)
        .where(inArray(ruleVerdict.cacheKey, [...keys]));
      return new Map(
        rows.flatMap(({ key, verdict }) =>
          (validatorVerdicts as readonly string[]).includes(verdict)
            ? [[key, verdict] as const]
            : [],
        ),
      );
    },
    remember: async (verdicts) => {
      if (verdicts.length === 0) return;
      const rows = sql.join(
        verdicts.map(({ key, verdict }) => sql`(${key}, ${verdict})`),
        sql`, `,
      );
      await db().execute(sql`
        INSERT INTO knowledge.rule_verdict (cache_key, verdict) VALUES ${rows}
        ON CONFLICT (cache_key) DO NOTHING`);
    },
  };
}
