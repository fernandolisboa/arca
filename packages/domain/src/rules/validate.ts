import { type Duration, durationParts, durationUnits } from '../calendar/duration.js';
import type { CurrencyCode } from '../money/currency.js';
import {
  type CheckContext,
  type CheckIssue,
  type CheckScope,
  ageNeedsLeapDay,
  checkExpression,
} from './check.js';
import { type Expression, maxNodesPerVersion, nodeCount } from './expression.js';
import { resolveFactReference } from './fact-reference.js';
import { type CountrySet, type RouteVersion, type Source, routeCountry } from './route-version.js';

const requirementScope: CheckScope = { current: true, unit: true, edge: false };
const dependentScope: CheckScope = { current: true, unit: false, edge: true, firstEdge: true };
const lastEdgeScope: CheckScope = { current: true, unit: false, edge: true };
const perDependentScope: CheckScope = { current: true, unit: true, edge: true };

/** The longest path whose condition may read `firstEdge.*`. */
export const maxFirstEdgeSteps = 2;

/** How to tell an official source: the hosts of the pinned official-domain lists, and a parser. */
export interface OfficialHosts {
  readonly hosts: readonly string[];
  /**
   * The lowercase ASCII (punycode) host of an `https` URL with no user information or port, or
   * `undefined` for any other URL. `hostOf` in `@arca/scripts/host` parses URLs; this pure
   * package does not.
   */
  readonly hostOf: (url: string) => string | undefined;
}

/** The codes a route version's pinned files allow (spec 0002, R7). */
export interface PinnedCountries {
  /** The countries file's codes. */
  readonly current: ReadonlySet<string>;
  /** The former-countries file's codes. */
  readonly former: ReadonlySet<string>;
  /** IDs of the pinned country sets with a member outside `current`. */
  readonly setsWithFormer: ReadonlySet<string>;
}

/** A host equal to a listed host or a subdomain of it on a label boundary (spec 0002, R4). */
export function hostMatches(host: string, hosts: readonly string[]): boolean {
  return hosts.some((listed) => host === listed || host.endsWith(`.${listed}`));
}

function officialUrl(url: string, official: OfficialHosts): boolean {
  const host = official.hostOf(url);
  return host !== undefined && hostMatches(host, official.hosts);
}

/** Checks a country set's sources: each official one on a pinned host, and at least one. */
export function checkCountrySet(set: CountrySet, official: OfficialHosts): CheckIssue[] {
  return checkOfficialSources(set.sources, official);
}

/** Checks a file's own sources: each official one on a pinned host, and at least one. */
export function checkOfficialSources(
  sources: readonly Source[],
  official: OfficialHosts,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  sources.forEach((source, index) => {
    if (source.kind === 'official' && !officialUrl(source.url, official)) {
      issues.push({
        path: `/sources/${String(index)}`,
        message: 'An official source is on a pinned official host',
      });
    }
  });
  if (!sources.some((source) => source.kind === 'official' && officialUrl(source.url, official))) {
    issues.push({ path: '/sources', message: 'At least one source is official' });
  }
  return issues;
}

/**
 * Checks what the schema cannot (spec 0002, R4): references between parts of the version, source
 * kinds, the shape of a closed version, and every expression against the fact catalog. Returns
 * the issues; none means valid.
 */
export function checkRouteVersion(
  version: RouteVersion,
  official: OfficialHosts,
  countries: PinnedCountries,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const issue = (path: string, message: string): void => {
    issues.push({ path, message });
  };
  const sources = new Map(version.sources.map((source) => [source.id, source]));
  const isOfficial = (source: Source | undefined): boolean =>
    source?.kind === 'official' && officialUrl(source.url, official);

  if (routeCountry(version.routeId) !== version.country) {
    issue('/routeId', 'A route ID starts with its country code in lowercase');
  }
  for (const [kind, ids] of [
    ['sources', version.sources.map((source) => source.id)],
    ['requirements', version.requirements.map((entry) => entry.id)],
    ['assessments', version.assessments.map((entry) => entry.id)],
    ['dependents', version.dependents.map((entry) => entry.id)],
    ['costs', version.costs.map((entry) => entry.id)],
    ['durations', version.durations.map((entry) => entry.id)],
    ['countrySets', version.countrySets.map((pin) => pin.id)],
  ] as const) {
    if (new Set(ids).size !== ids.length) issue(`/${kind}`, 'IDs are unique');
  }
  version.sources.forEach((source, index) => {
    if (source.kind === 'official' && !officialUrl(source.url, official)) {
      issue(`/sources/${String(index)}`, 'An official source is on a pinned official host');
    }
  });
  const cites = (path: string, ids: readonly string[]): void => {
    if (ids.some((id) => !sources.has(id))) issue(path, 'Every cited source is in sources');
    if (!ids.some((id) => isOfficial(sources.get(id)))) {
      issue(path, 'At least one cited source is official');
    }
  };

  if (version.status === 'closed') {
    if (
      version.requirements.length +
        version.assessments.length +
        version.dependents.length +
        version.costs.length >
      0
    ) {
      issue('', 'A closed version has no requirements, assessments, dependents or costs');
    }
    if (version.closureSources === undefined)
      issue('/closureSources', 'A closure cites its sources');
    else cites('/closureSources', version.closureSources);
  } else if (version.closureSources !== undefined) {
    issue('/closureSources', 'Only a closed version has closure sources');
  }
  if (version.leapDayBirthday !== undefined) {
    if (version.leapDayBirthdaySources === undefined) {
      issue('/leapDayBirthdaySources', 'The leap-day convention cites its sources');
    } else {
      cites('/leapDayBirthdaySources', version.leapDayBirthdaySources);
    }
  }

  const context: CheckContext = {
    currency: version.currency,
    countrySets: new Set(version.countrySets.map((pin) => pin.id)),
    leapDayBirthday: version.leapDayBirthday !== undefined,
    referenceDates: new Set(version.referenceDates ?? []),
    countries: countries.current,
    formerCountries: countries.former,
    formerCountrySets: countries.setsWithFormer,
  };
  const expressions: Expression[] = [];
  const expect = (
    expression: Expression,
    scope: CheckScope,
    path: string,
    wanted: { kind: 'boolean' } | { kind: 'number'; currency: CurrencyCode },
  ): void => {
    expressions.push(expression);
    const type = checkExpression(expression, scope, context, issues, path);
    if (type === undefined) return;
    const matches =
      type.kind === wanted.kind &&
      (wanted.kind === 'boolean' || (type.kind === 'number' && type.currency === wanted.currency));
    if (!matches) {
      issue(
        path,
        wanted.kind === 'boolean'
          ? 'A condition is needed'
          : 'An amount in the version currency is needed',
      );
    }
  };
  const condition = { kind: 'boolean' } as const;

  version.requirements.forEach((requirement, index) => {
    const path = `/requirements/${String(index)}`;
    cites(`${path}/sources`, requirement.sources);
    expect(requirement.expression, requirementScope, `${path}/expression`, condition);
  });
  version.assessments.forEach((assessment, index) => {
    const path = `/assessments/${String(index)}`;
    cites(`${path}/sources`, assessment.sources);
    assessment.evidence.forEach((reference, position) => {
      const resolved = resolveFactReference(reference);
      const at = `${path}/evidence/${String(position)}`;
      if (resolved?.target !== 'principal' && resolved?.target !== 'unit') {
        issue(at, 'Evidence is a principal or unit fact');
      } else if (resolved.definition.readsAge === true && !context.leapDayBirthday) {
        issue(at, ageNeedsLeapDay);
      }
    });
  });
  version.dependents.forEach((rule, index) => {
    const path = `/dependents/${String(index)}`;
    if (rule.at !== undefined && !context.referenceDates.has(rule.at)) {
      issue(`${path}/at`, `Reference date ${rule.at} is not declared by the version`);
    }
    cites(`${path}/sources`, rule.sources);
    // Keeping first edges multiplies a path's arrivals, so only short paths may read them.
    const scope = rule.path.length <= maxFirstEdgeSteps ? dependentScope : lastEdgeScope;
    expect(rule.condition, scope, `${path}/condition`, condition);
  });
  version.costs.forEach((cost, index) => {
    const path = `/costs/${String(index)}`;
    const scope = cost.appliesTo === 'each_dependent' ? perDependentScope : requirementScope;
    cites(`${path}/sources`, cost.sources);
    expect(cost.amount, scope, `${path}/amount`, { kind: 'number', currency: version.currency });
    if (cost.condition !== undefined) expect(cost.condition, scope, `${path}/condition`, condition);
  });
  version.durations.forEach((stage, index) => {
    const path = `/durations/${String(index)}`;
    cites(`${path}/sources`, stage.sources);
    if (!orderedRange(stage.min, stage.max)) {
      issue(path, 'A duration range uses one unit and its minimum is not above its maximum');
    }
  });

  const nodes = expressions.reduce((total, expression) => total + nodeCount(expression), 0);
  if (nodes > maxNodesPerVersion) {
    issue('', `A version has at most ${String(maxNodesPerVersion)} expression nodes`);
  }
  return issues;
}

function orderedRange(min: Duration, max: Duration): boolean {
  const units = new Set([...durationUnits(min), ...durationUnits(max)]);
  if (units.size !== 1) return false;
  const [unit] = units;
  if (unit === undefined) return false;
  return durationParts(min)[unit] <= durationParts(max)[unit];
}
