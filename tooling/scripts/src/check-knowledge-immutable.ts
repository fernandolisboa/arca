import { GitRepository } from './git-tree.ts';
import {
  checkKnowledgeChange,
  domainSource,
  knowledgeRoots,
  vendoredPolicy,
  vendoredSources,
  type Side,
} from './knowledge-immutable.ts';
import { reportViolations, type Violation } from './report.ts';
import { githubUpstream, verifyEntry } from './vendored.ts';

const watched = [...knowledgeRoots, vendoredPolicy, vendoredSources];

/**
 * Usage: check-knowledge-immutable.ts <repository> [<base> <head>]
 *
 * Compares the knowledge data, the vendored files and vendored.json of `head` with `base` (spec
 * 0002, R6 and R7), reading both commits from git as data. CI passes main's tip as `base`; the
 * ruleset requires branches to be up to date, so `head` contains it and the difference is the pull
 * request's own. Without revisions it compares HEAD with its merge base with origin/main, as
 * `pnpm check:knowledge-immutable` does. New vendored.json entries are then checked against
 * upstream, the only step that reaches the network.
 */
async function main(): Promise<void> {
  const [directory = '.', baseRevision, headRevision] = process.argv.slice(2);
  const repository = new GitRepository(directory);
  const head = await repository.commit(headRevision ?? 'HEAD');
  const base = await repository.commit(
    baseRevision ?? (await repository.mergeBase('origin/main', head)),
  );
  const side = async (commit: string): Promise<Side> => {
    const files = await repository.files(commit, watched);
    return {
      files,
      read: (path) => {
        const file = files.get(path);
        if (file === undefined) throw new Error(`${path} is not in ${commit}`);
        return repository.blob(file.object);
      },
    };
  };
  const { violations, newEntries } = await checkKnowledgeChange({
    base: await side(base),
    head: await side(head),
    domainChanged:
      (await repository.objectAt(base, domainSource)) !==
      (await repository.objectAt(head, domainSource)),
  });
  const upstreamViolations: Violation[] = [];
  for (const entry of newEntries) {
    const where = `${vendoredPolicy} entry ${entry.repository}@${entry.tag}`;
    const problems = await verifyEntry(entry, githubUpstream).catch((error: unknown) => [
      error instanceof Error ? error.message : String(error),
    ]);
    for (const problem of problems) upstreamViolations.push({ where, problem });
  }
  reportViolations([...violations, ...upstreamViolations]);
}

await main();
