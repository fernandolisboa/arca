import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  type CaseSnapshot,
  type CatalogEntry,
  type Evaluation,
  type VersionContext,
  caseSnapshotSchema,
  computeUnit,
  evaluateVersion,
  fxTableSchema,
  maxKnowledgeJsonDepth,
  parseCalendarDate,
} from '@arca/domain';
import { parseJsonSubset } from '@arca/scripts/json';
import {
  type CasesFile,
  type RuleCase,
  casesFileSchema,
  describeMissingFact,
} from '../../scripts/cases.ts';
import { hashesFileSchema } from '../../scripts/files.ts';
import { loadData, readKnowledgeFile } from '../../scripts/load.ts';
import type { ReproductionLookup } from '../../src/reproduction.ts';

const casesPath = /^routes\/([a-z0-9-]+)\/([1-9][0-9]*)\.cases\.json$/;
const versionPath = /^routes\/([a-z0-9-]+)\/([1-9][0-9]*)\.json$/;
const noRates = fxTableSchema.parse({ rates: [] });

export interface CasesRun {
  readonly cases: number;
  /** Everything that failed, one line each; empty when every case and coverage rule holds. */
  readonly problems: readonly string[];
}

/**
 * Runs every cases file in a data directory through `evaluateVersion` (spec 0002, R8): each version
 * found by its committed hash through the lookup, each case against its expected result, and each
 * version's cases against the coverage rules. Every route version needs a cases file.
 */
export async function runCases(
  dataDir: string,
  familiesDir: string,
  lookup: ReproductionLookup,
): Promise<CasesRun> {
  const raw = await loadData(dataDir);
  const problems: string[] = raw.issues.map((issue) => `${issue.file}: ${issue.message}`);
  const hashes = new Map(
    hashesFileSchema.parse(raw.hashes).files.map((file) => [file.path, file.sha256]),
  );
  const withCases = new Set(raw.cases.map((file) => file.replace(/\.cases\.json$/, '')));
  for (const file of raw.files) {
    if (versionPath.test(file.file) && !withCases.has(file.file.replace(/\.json$/, ''))) {
      problems.push(`${file.file}: A route version has a cases file`);
    }
  }
  let cases = 0;
  for (const file of raw.cases) {
    const [, routeId = '', number = ''] = casesPath.exec(file) ?? [];
    const hash = hashes.get(`routes/${routeId}/${number}`);
    const entry = hash === undefined ? undefined : lookup(routeId, Number(number), hash);
    if (entry === undefined) {
      problems.push(`${file}: The version it covers is in the catalog`);
      continue;
    }
    const parsed = await readCases(join(dataDir, file));
    if (typeof parsed === 'string') {
      problems.push(`${file}: ${parsed}`);
      continue;
    }
    problems.push(...supersedeProblems(parsed.cases).map((problem) => `${file}${problem}`));
    const superseded = new Set(parsed.cases.flatMap((entry) => entry.supersedes ?? []));
    const current = parsed.cases.filter((entry) => !superseded.has(entry.id));
    const runs: Run[] = [];
    for (const ruleCase of current) {
      const where = `${file} ${ruleCase.id}`;
      try {
        const snapshot = await snapshotOf(ruleCase, familiesDir);
        const evaluation = evaluateVersion(
          snapshot,
          entry,
          ruleCase.principal,
          contextOf(ruleCase),
        );
        runs.push({ ruleCase, snapshot, evaluation });
        problems.push(...compare(ruleCase, evaluation).map((problem) => `${where}: ${problem}`));
        cases += 1;
      } catch (error) {
        // One broken case is reported and the rest still run.
        problems.push(`${where}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    problems.push(...coverage(entry, runs).map((gap) => `${file}: ${gap}`));
  }
  return { cases, problems };
}

/** The parsed cases file, or why it could not be read. */
async function readCases(path: string): Promise<CasesFile | string> {
  try {
    const parsed = casesFileSchema.safeParse(
      parseJsonSubset(await readKnowledgeFile(path), maxKnowledgeJsonDepth),
    );
    return parsed.success ? parsed.data : parsed.error.message;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
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

async function snapshotOf(ruleCase: RuleCase, familiesDir: string): Promise<CaseSnapshot> {
  if (ruleCase.snapshot !== undefined) return ruleCase.snapshot;
  const family = ruleCase.family;
  if (family === undefined) throw new Error('The case has no snapshot');
  const bytes = await readKnowledgeFile(
    join(familiesDir, family.id, `${String(family.number)}.json`),
  );
  if (createHash('sha256').update(bytes).digest('hex') !== family.sha256) {
    throw new Error(
      `Family ${family.id} ${String(family.number)} does not hash to the pinned SHA-256`,
    );
  }
  return caseSnapshotSchema.parse(parseJsonSubset(bytes, maxKnowledgeJsonDepth));
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

/**
 * The coverage rules of spec 0002 R8, from the engine's results: every requirement true, false and
 * unknown at least once; every dependent rule including and excluding someone; the statuses each
 * open version must reach, and `unavailable` for a closed one. Each dependent rule is measured on
 * its own, so another rule cannot cover for it: it includes someone, and reaches someone whose
 * condition fails, unless its condition is the literal `true`, which nobody can fail.
 */
function coverage(entry: CatalogEntry, runs: readonly Run[]): string[] {
  const { version } = entry;
  const statuses = new Set(runs.map((run) => run.evaluation.status));
  if (version.status === 'closed') {
    return statuses.has('unavailable') ? [] : ['A closed version has an unavailable case'];
  }
  const gaps: string[] = [];
  const wanted = [
    version.assessments.length > 0 ? 'needs_assessment' : 'eligible',
    'not_eligible',
    'missing_information',
  ] as const;
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
    if (!units.some((unit) => unit.dependents.length > 0)) {
      gaps.push(`Dependent rule ${rule.id} never includes anyone`);
    }
    const unconditional = rule.condition.op === 'bool' && rule.condition.value;
    const excludes = units.some((unit) =>
      unit.excluded.some((person) => person.reason === 'condition_not_met'),
    );
    if (!excludes && !unconditional) gaps.push(`Dependent rule ${rule.id} never excludes anyone`);
  }
  return gaps;
}
