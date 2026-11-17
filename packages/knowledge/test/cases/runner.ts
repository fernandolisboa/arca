import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { type CaseSnapshot, caseSnapshotSchema, maxKnowledgeJsonDepth } from '@arca/domain';
import { parseJsonSubset } from '@arca/scripts/json';
import { runVersionCases } from '../../src/case-run.ts';
import { type CasesFile, type RuleCase, casesFileSchema } from '../../src/cases.ts';
import { hashesFileSchema } from '../../scripts/files.ts';
import { loadData, readKnowledgeFile } from '../../scripts/load.ts';
import type { ReproductionLookup } from '../../src/reproduction.ts';

const casesPath = /^routes\/([a-z0-9-]+)\/([1-9][0-9]*)\.cases\.json$/;
const versionPath = /^routes\/([a-z0-9-]+)\/([1-9][0-9]*)\.json$/;

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
    const run = await runVersionCases(entry, parsed, (ruleCase) =>
      snapshotOf(ruleCase, familiesDir),
    );
    problems.push(...run.problems.map((problem) => `${file}${problem}`));
    cases += run.cases;
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
