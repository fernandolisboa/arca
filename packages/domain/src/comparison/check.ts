import { decimalSchema, scaledDecimal, compareScaled } from '../money/decimal.js';
import type { CheckIssue } from '../rules/check.js';
import { type OfficialHosts, checkOfficialSources } from '../rules/validate.js';
import { type ComparisonVersion, type CountryIndicator, indicatorTokenSchema } from './schema.js';

/**
 * Checks what an indicator's schema cannot (ADR-0026): its sources official on a pinned host,
 * each value of its type, cited by one of its sources, for a pinned country, once per country.
 */
export function checkCountryIndicator(
  indicator: CountryIndicator,
  official: OfficialHosts,
  countries: ReadonlySet<string>,
): CheckIssue[] {
  const issues = checkOfficialSources(indicator.sources, official);
  indicator.sources.forEach((source, index) => {
    if (source.kind !== 'official') {
      issues.push({
        path: `/sources/${String(index)}/kind`,
        message: 'An indicator cites official sources only',
      });
    }
  });
  const sourceIds = new Set(indicator.sources.map((source) => source.id));
  if (sourceIds.size !== indicator.sources.length) {
    issues.push({ path: '/sources', message: 'Source IDs are unique' });
  }
  const seen = new Set<string>();
  indicator.values.forEach(({ country, value, source }, index) => {
    const path = `/values/${String(index)}`;
    const typed =
      indicator.valueType === 'decimal'
        ? decimalSchema.safeParse(value).success
        : indicatorTokenSchema.safeParse(value).success;
    if (!typed) {
      issues.push({ path: `${path}/value`, message: `A value is a ${indicator.valueType}` });
    }
    if (!sourceIds.has(source)) {
      issues.push({ path: `${path}/source`, message: 'A value cites one of the sources' });
    }
    if (!countries.has(country)) {
      issues.push({
        path: `${path}/country`,
        message: 'The country is in the pinned countries file',
      });
    }
    if (seen.has(country)) {
      issues.push({ path: `${path}/country`, message: 'A country has one value' });
    }
    seen.add(country);
  });
  return issues;
}

/**
 * Checks a comparison version against the indicators it pins: unique criterion IDs, each indicator
 * criterion on a pinned decimal indicator with distinct anchors, each category criterion on a
 * pinned token indicator that scores every token it holds, and no pinned indicator left unread.
 */
export function checkComparisonVersion(
  version: ComparisonVersion,
  indicators: ReadonlyMap<string, CountryIndicator>,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const issue = (path: string, message: string): void => {
    issues.push({ path, message });
  };
  const pinnedIds = version.indicators.map((pin) => pin.id);
  if (new Set(pinnedIds).size !== pinnedIds.length) {
    issue('/indicators', 'An indicator is pinned once');
  }
  const criterionIds = version.criteria.map((criterion) => criterion.id);
  if (new Set(criterionIds).size !== criterionIds.length) {
    issue('/criteria', 'Criterion IDs are unique');
  }
  const read = new Set<string>();
  version.criteria.forEach((criterion, index) => {
    const path = `/criteria/${String(index)}`;
    if (criterion.kind === 'personal') return;
    read.add(criterion.indicator);
    const indicator = indicators.get(criterion.indicator);
    if (indicator === undefined) {
      issue(`${path}/indicator`, 'The criterion reads a pinned indicator');
      return;
    }
    if (criterion.kind === 'indicator') {
      if (indicator.valueType !== 'decimal') {
        issue(`${path}/indicator`, 'An indicator criterion reads a decimal indicator');
      }
      if (compareScaled(scaledDecimal(criterion.zeroAt), scaledDecimal(criterion.tenAt)) === 0) {
        issue(`${path}/tenAt`, 'The anchors differ');
      }
      return;
    }
    if (indicator.valueType !== 'token') {
      issue(`${path}/indicator`, 'A category criterion reads a token indicator');
      return;
    }
    const scored = criterion.scores.map((entry) => entry.token);
    if (new Set(scored).size !== scored.length) {
      issue(`${path}/scores`, 'Each token is scored once');
    }
    for (const value of new Set(indicator.values.map((each) => each.value))) {
      if (!scored.includes(value)) issue(`${path}/scores`, `The token ${value} has a score`);
    }
  });
  pinnedIds.forEach((id, index) => {
    if (!read.has(id)) issue(`/indicators/${String(index)}`, 'Every pinned indicator is read');
  });
  return issues;
}
