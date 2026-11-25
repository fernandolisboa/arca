import {
  type CaseSnapshot,
  type CatalogEntry,
  type Evaluation,
  type EvaluationStatus,
  type VersionContext,
  computeUnit,
  evaluateVersion,
  fxTableSchema,
  parseCalendarDate,
} from '@arca/domain';
import { type CasesFile, type RuleCase, describeMissingFact } from './cases.js';

const noRates = fxTableSchema.parse({ rates: [] });

/**
 * Runs one version's cases (spec 0002, R8): each current case through \`evaluateVersion\` against
 * its expected result, and the cases together against the coverage rules. Each problem is one
 * line, starting with \`: \` for the file or \` <id>: \` for a case; none means every case holds.
 * \`snapshotOf\` gives a case's snapshot, or throws when it has none it can read.
 */
export async function runVersionCases(
  entry: CatalogEntry,
  file: CasesFile,
  snapshotOf: (ruleCase: RuleCase) => CaseSnapshot | Promise<CaseSnapshot>,
): Promise<{ readonly cases: number; readonly problems: readonly string[] }> {
  const problems = [...supersedeProblems(file.cases)];
  const superseded = new Set(file.cases.flatMap((ruleCase) => ruleCase.supersedes ?? []));
  const runs: Run[] = [];
  for (const ruleCase of file.cases.filter(({ id }) => !superseded.has(id))) {
    try {
      const snapshot = await snapshotOf(ruleCase);
      const evaluation = evaluateVersion(snapshot, entry, ruleCase.principal, contextOf(ruleCase));
      runs.push({ ruleCase, snapshot, evaluation });
      problems.push(
        ...compare(ruleCase, evaluation).map((problem) => ` ${ruleCase.id}: ${problem}`),
      );
    } catch (error) {
      // One broken case is reported and the rest still run.
      problems.push(` ${ruleCase.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  problems.push(...coverage(entry, runs).map((gap) => `: ${gap}`));
  return { cases: runs.length, problems };
}

/**
 * Each problem starts with `: ` for the file or ` <id>: ` for a case. IDs are unique, a case is
 * superseded at most once, and every chain of supersedes ends at a case in the file, without a
 * cycle, which would otherwise drop every case in it unreported.
 */
function supersedeProblems(cases: readonly RuleCase[]): string[] {
  const problems: string[] = [];
  const ids = cases.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) problems.push(': Case IDs are unique');
  const targets = cases.flatMap((entry) => entry.supersedes ?? []);
  if (new Set(targets).size !== targets.length) {
    problems.push(': A case is superseded at most once');
  }
  const next = new Map(cases.map((entry) => [entry.id, entry.supersedes]));
  for (const entry of cases) {
    if (entry.supersedes === undefined) continue;
    if (!next.has(entry.supersedes)) {
      problems.push(` ${entry.id}: The case it supersedes is in the file`);
      continue;
    }
    const seen = new Set([entry.id]);
    for (let id = next.get(entry.id); id !== undefined; id = next.get(id)) {
      if (seen.has(id)) {
        problems.push(` ${entry.id}: Its chain of supersedes forms a cycle`);
        break;
      }
      seen.add(id);
    }
  }
  return problems;
}

function contextOf(ruleCase: RuleCase): VersionContext {
  const rulesAsOf = parseCalendarDate(ruleCase.rulesAsOf);
  return {
    rulesAsOf,
    ...(ruleCase.factsAsOf === undefined
      ? {}
      : { factsAsOf: parseCalendarDate(ruleCase.factsAsOf) }),
    referenceDates: new Map(
      Object.entries(ruleCase.referenceDates ?? {}).map(([name, date]) => [
        name,
        parseCalendarDate(date),
      ]),
    ),
    today: rulesAsOf,
    fx: ruleCase.fx ?? noRates,
    engineCommit: 'cases',
  };
}

function compare(ruleCase: RuleCase, evaluation: Evaluation): string[] {
  const { expected } = ruleCase;
  const actual = {
    status: evaluation.status,
    dependents: evaluation.unit.dependents.map((member) => member.personId).sort(),
    possibleDependents: evaluation.unit.possibleDependents.map((member) => member.personId).sort(),
    missingFacts: evaluation.missingFacts.map(describeMissingFact).sort(),
  };
  const wanted = {
    status: expected.status,
    dependents: [...expected.dependents].sort(),
    possibleDependents: [...expected.possibleDependents].sort(),
    missingFacts: [...expected.missingFacts].sort(),
  };
  return (Object.keys(wanted) as (keyof typeof wanted)[]).flatMap((key) =>
    JSON.stringify(actual[key]) === JSON.stringify(wanted[key])
      ? []
      : [`${key} is ${JSON.stringify(actual[key])}, expected ${JSON.stringify(wanted[key])}`],
  );
}

interface Run {
  readonly ruleCase: RuleCase;
  readonly snapshot: CaseSnapshot;
  readonly evaluation: Evaluation;
}

type Condition = CatalogEntry['version']['dependents'][number]['condition'];

/**
 * Whether a condition can never be false: the literal `true`, an `unmodeled` branch, which is
 * always unknown, or a combination of them, such as a sufficient rule `any` an unmodeled
 * alternative. Nobody can fail such a rule, so no case can show it excluding anyone.
 */
function cannotFail(condition: Condition): boolean {
  switch (condition.op) {
    case 'bool':
      return condition.value;
    case 'unmodeled':
      return true;
    case 'any':
      return condition.operands.some(cannotFail);
    case 'all':
      return condition.operands.every(cannotFail);
    case 'not':
      return condition.operand.op === 'bool'
        ? !condition.operand.value
        : cannotHold(condition.operand);
    default:
      return false;
  }
}

/**
 * Whether a condition can never be true yet can be unknown: an `unmodeled` branch, which is
 * always unknown, or a combination of them, such as a necessary rule `all` an unmodeled check the
 * case cannot record (a union's registration). Nobody can be included by such a rule, so a case
 * shows it making someone possible instead.
 */
function cannotHold(condition: Condition): boolean {
  switch (condition.op) {
    case 'unmodeled':
      return true;
    case 'any':
      return condition.operands.every(cannotHold);
    case 'all':
      return condition.operands.some(cannotHold);
    case 'not':
      return condition.operand.op !== 'bool' && cannotFail(condition.operand);
    default:
      return false;
  }
}

/**
 * The coverage rules of spec 0002 R8, from the engine's results: every requirement true, false and
 * unknown at least once; every dependent rule including and excluding someone; the statuses each
 * open version can reach (only `needs_assessment` for one that rests wholly on assessments, so a
 * version with neither requirements nor assessments still fails), and
 * `unavailable` for a closed one. Each dependent rule is measured on
 * its own, so another rule cannot cover for it: it includes someone, or makes someone possible when
 * its condition cannot be true (see `cannotHold`), and reaches someone whose condition fails,
 * unless its condition cannot be false (see `cannotFail`).
 */
function coverage(entry: CatalogEntry, runs: readonly Run[]): string[] {
  const { version } = entry;
  const statuses = new Set(runs.map((run) => run.evaluation.status));
  if (version.status === 'closed') {
    return statuses.has('unavailable') ? [] : ['A closed version has an unavailable case'];
  }
  const gaps: string[] = [];
  const restsOnAssessments = version.requirements.length === 0 && version.assessments.length > 0;
  const wanted: readonly EvaluationStatus[] = restsOnAssessments
    ? ['needs_assessment']
    : [
        version.assessments.length > 0 ? 'needs_assessment' : 'eligible',
        'not_eligible',
        'missing_information',
      ];
  for (const status of wanted) {
    if (!statuses.has(status)) gaps.push(`No case is ${status}`);
  }
  for (const requirement of version.requirements) {
    const seen = new Set(
      runs.flatMap((run) =>
        run.evaluation.requirements
          .filter((outcome) => outcome.id === requirement.id)
          .map((outcome) => String(outcome.result)),
      ),
    );
    for (const truth of ['true', 'false', 'unknown']) {
      if (!seen.has(truth)) gaps.push(`Requirement ${requirement.id} is never ${truth}`);
    }
  }
  for (const rule of version.dependents) {
    const alone: CatalogEntry = { ...entry, version: { ...version, dependents: [rule] } };
    const units = runs.map((run) =>
      computeUnit(run.snapshot, alone, run.ruleCase.principal, contextOf(run.ruleCase)),
    );
    if (cannotHold(rule.condition)) {
      if (!units.some((unit) => unit.possibleDependents.length > 0)) {
        gaps.push(`Dependent rule ${rule.id} never makes anyone possible`);
      }
    } else if (!units.some((unit) => unit.dependents.length > 0)) {
      gaps.push(`Dependent rule ${rule.id} never includes anyone`);
    }
    const excludes = units.some((unit) =>
      unit.excluded.some((person) => person.reason === 'condition_not_met'),
    );
    if (!excludes && !cannotFail(rule.condition)) {
      gaps.push(`Dependent rule ${rule.id} never excludes anyone`);
    }
  }
  return gaps;
}
