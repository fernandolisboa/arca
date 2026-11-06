import { z } from 'zod';
import { type CalendarDate, calendarDateSchema } from '../calendar/calendar-date.js';
import { opaqueIdSchema } from '../case/snapshot.js';
import {
  type CatalogEntry,
  type DecisionState,
  type DecisionStates,
  type VersionIdentity,
  identityKey,
  selectVersion,
  stateOf,
} from './catalog.js';
import type { EvaluationStatus } from './engine.js';
import { slugSchema } from './expression.js';
import { resolveFactReference } from './fact-reference.js';
import type { RouteVersion, Source } from './route-version.js';

const evaluationStatuses = [
  'unavailable',
  'not_eligible',
  'missing_information',
  'needs_assessment',
  'eligible',
] as const satisfies readonly EvaluationStatus[];

const casePeople = z.array(opaqueIdSchema).max(60);

/** A version's table-driven case as the activation screen shows it: no snapshot, only its result. */
export const ruleCaseSummarySchema = z.strictObject({
  id: slugSchema,
  principal: opaqueIdSchema,
  rulesAsOf: calendarDateSchema,
  expected: z.strictObject({
    status: z.enum(evaluationStatuses),
    dependents: casePeople,
    possibleDependents: casePeople,
    missingFacts: z.array(z.string().min(1).max(300)).max(100),
  }),
});
export type RuleCaseSummary = z.infer<typeof ruleCaseSummarySchema>;

/** A fact reference as the screen names it: the catalog key and who it is read on. */
export interface FactName {
  readonly reference: string;
  readonly key: string | null;
  readonly target: string | null;
}

/** An expression with each fact reference resolved, for display only; never evaluated. */
export type ExpressionView = Readonly<Record<string, unknown>>;

export interface SourceView extends Source {
  /** No lower version of the route cites a source on this host. */
  readonly newHost: boolean;
}

/** What changed in one section from the version this one replaces, by item ID. */
export interface SectionChange {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

export const viewSections = [
  'requirements',
  'assessments',
  'dependents',
  'costs',
  'durations',
  'sources',
  'countrySets',
] as const;
export type ViewSection = (typeof viewSections)[number];

/** What rejecting this version does to the route's selection today. */
export interface RejectionEffect {
  /** The route selects this version today, active or still proposed. */
  readonly selected: boolean;
  /** What the route would select instead, or null for none at all. */
  readonly fallback: { readonly number: number; readonly state: DecisionState } | null;
}

/** A route version laid out for the approver (spec 0007, R7), built from its content alone. */
export interface VersionView {
  readonly routeId: string;
  readonly number: number;
  readonly hash: string;
  readonly state: DecisionState;
  readonly title: string;
  readonly country: string;
  readonly tags: readonly string[];
  readonly effectiveFrom: CalendarDate;
  readonly corrects: number | null;
  readonly status: RouteVersion['status'];
  readonly currency: string;
  readonly requirements: readonly {
    readonly id: string;
    readonly title: string;
    readonly expression: ExpressionView;
    readonly facts: readonly FactName[];
    readonly sources: readonly string[];
  }[];
  readonly assessments: readonly {
    readonly id: string;
    readonly title: string;
    readonly evidence: readonly FactName[];
    readonly sources: readonly string[];
  }[];
  readonly dependents: readonly {
    readonly id: string;
    readonly title: string;
    readonly path: readonly string[];
    readonly condition: ExpressionView;
    readonly facts: readonly FactName[];
    readonly at: string | null;
    readonly sources: readonly string[];
  }[];
  readonly costs: readonly {
    readonly id: string;
    readonly title: string;
    readonly kind: string;
    readonly appliesTo: string;
    readonly amount: ExpressionView;
    readonly condition: ExpressionView | null;
    readonly facts: readonly FactName[];
    readonly sources: readonly string[];
  }[];
  readonly durations: RouteVersion['durations'];
  readonly countrySets: readonly {
    readonly id: string;
    readonly number: number;
    readonly title: string;
    readonly members: readonly string[];
  }[];
  readonly sources: readonly SourceView[];
  /** The version it replaces (the one it corrects, else the one before), and what changed. */
  readonly replaces: {
    readonly number: number;
    readonly changes: Readonly<Record<ViewSection, SectionChange>>;
  } | null;
  readonly cases: readonly RuleCaseSummary[];
  readonly rejection: RejectionEffect;
}

export interface VersionViewInput {
  /** Every version of the route the catalog holds, this one included. */
  readonly versions: readonly CatalogEntry[];
  readonly number: number;
  readonly cases: readonly RuleCaseSummary[];
  readonly states: DecisionStates;
  readonly today: CalendarDate;
  /** The host of an `https` URL, lowercased; the domain has no URL parser. */
  readonly hostOf: (url: string) => string | undefined;
}

const isNode = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && 'op' in value;

/** The expression as it is, with every fact node naming its catalog key and target. */
function expressionView(expression: unknown, facts: FactName[]): ExpressionView {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!isNode(value)) return value;
    if (value['op'] === 'fact' && typeof value['key'] === 'string') {
      const name = factName(value['key']);
      facts.push(name);
      return { ...value, ...name };
    }
    return Object.fromEntries(Object.entries(value).map(([field, inner]) => [field, walk(inner)]));
  };
  return walk(expression) as ExpressionView;
}

function factName(reference: string): FactName {
  const resolved = resolveFactReference(reference);
  return { reference, key: resolved?.key ?? null, target: resolved?.target ?? null };
}

const unique = (facts: readonly FactName[]) => [
  ...new Map(facts.map((fact) => [fact.reference, fact])).values(),
];

function withFacts<T>(
  build: (facts: FactName[]) => T,
): T & { readonly facts: readonly FactName[] } {
  const facts: FactName[] = [];
  const built = build(facts);
  return { ...built, facts: unique(facts) };
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, inner: unknown) =>
    typeof inner === 'object' && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([left], [right]) => (left < right ? -1 : 1)))
      : inner,
  );

function sectionChange(
  before: readonly { readonly id: string }[],
  after: readonly { readonly id: string }[],
): SectionChange {
  const old = new Map(before.map((item) => [item.id, canonical(item)]));
  const now = new Map(after.map((item) => [item.id, canonical(item)]));
  return {
    added: [...now.keys()].filter((id) => !old.has(id)),
    removed: [...old.keys()].filter((id) => !now.has(id)),
    changed: [...now].filter(([id, item]) => old.has(id) && old.get(id) !== item).map(([id]) => id),
  };
}

function sections(entry: CatalogEntry): Readonly<Record<ViewSection, readonly { id: string }[]>> {
  const { version } = entry;
  return {
    requirements: version.requirements,
    assessments: version.assessments,
    dependents: version.dependents,
    costs: version.costs,
    durations: version.durations,
    sources: version.sources,
    countrySets: entry.countrySets.map((set) => ({
      ...set,
      id: `${set.id}/${String(set.number)}`,
    })),
  };
}

function changes(before: CatalogEntry, after: CatalogEntry): Record<ViewSection, SectionChange> {
  const old = sections(before);
  const now = sections(after);
  return Object.fromEntries(
    viewSections.map((section) => [section, sectionChange(old[section], now[section])]),
  ) as Record<ViewSection, SectionChange>;
}

/** What the route selects today, and instead once this version is rejected. */
export function rejectionEffect(
  identities: readonly VersionIdentity[],
  identity: VersionIdentity,
  today: CalendarDate,
  states: DecisionStates,
): RejectionEffect {
  const now = selectVersion(identities, today, states);
  const rejected = new Map(states).set(identityKey(identity), 'rejected');
  const after = selectVersion(identities, today, rejected);
  return {
    selected: now !== undefined && identityKey(now.identity) === identityKey(identity),
    fallback: after === undefined ? null : { number: after.identity.number, state: after.state },
  };
}

/**
 * The approver's view of one version (spec 0007, R7): its rules as data, the facts they read, its
 * pinned country sets, its sources with hosts new to the route flagged, what changed from the
 * version it replaces, its cases and what a rejection would do. No model is involved.
 */
export function versionView({
  versions,
  number,
  cases,
  states,
  today,
  hostOf,
}: VersionViewInput): VersionView | undefined {
  const entry = versions.find((candidate) => candidate.identity.number === number);
  if (entry === undefined) return undefined;
  const { version, identity } = entry;
  const replacedNumber = version.corrects ?? number - 1;
  const replaced = versions.find((candidate) => candidate.identity.number === replacedNumber);
  const earlierHosts = new Set(
    versions
      .filter((candidate) => candidate.identity.number < number)
      .flatMap((candidate) => candidate.version.sources.map((source) => hostOf(source.url))),
  );
  return {
    routeId: identity.routeId,
    number,
    hash: identity.hash,
    state: stateOf(identity, states),
    title: version.title,
    country: version.country,
    tags: version.tags,
    effectiveFrom: version.effectiveFrom,
    corrects: version.corrects ?? null,
    status: version.status,
    currency: version.currency,
    requirements: version.requirements.map(({ id, title, expression, sources }) =>
      withFacts((facts) => ({ id, title, expression: expressionView(expression, facts), sources })),
    ),
    assessments: version.assessments.map(({ id, title, evidence, sources }) => ({
      id,
      title,
      evidence: evidence.map(factName),
      sources,
    })),
    dependents: version.dependents.map(({ id, title, path, condition, at, sources }) =>
      withFacts((facts) => ({
        id,
        title,
        path,
        condition: expressionView(condition, facts),
        at: at ?? null,
        sources,
      })),
    ),
    costs: version.costs.map(({ id, title, kind, appliesTo, amount, condition, sources }) =>
      withFacts((facts) => ({
        id,
        title,
        kind,
        appliesTo,
        amount: expressionView(amount, facts),
        condition: condition === undefined ? null : expressionView(condition, facts),
        sources,
      })),
    ),
    durations: version.durations,
    countrySets: entry.countrySets.map(({ id, number: setNumber, title, members }) => ({
      id,
      number: setNumber,
      title,
      members,
    })),
    sources: version.sources.map((source) => ({
      ...source,
      newHost: !earlierHosts.has(hostOf(source.url)),
    })),
    replaces:
      replaced === undefined || replacedNumber < 1
        ? null
        : { number: replacedNumber, changes: changes(replaced, entry) },
    cases,
    rejection: rejectionEffect(
      versions.map((candidate) => candidate.identity),
      identity,
      today,
      states,
    ),
  };
}
