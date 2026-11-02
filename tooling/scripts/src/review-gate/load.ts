import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AgentDefinitionError,
  modelVariables,
  parseAgentDefinition,
  reviewerWeights,
  withWeights,
  type AgentDefinition,
  type Reviewer,
} from './reviewers.ts';

/** The reviewers as `main` defines them: `.claude/agents/*.md` weighted by docs/REVIEW.md. */
export async function mainReviewers(repo: string): Promise<Reviewer[]> {
  const dir = join(repo, '.claude', 'agents');
  const agents: AgentDefinition[] = [];
  for (const file of (await readdir(dir)).filter((name) => name.endsWith('.md')).sort()) {
    try {
      agents.push(parseAgentDefinition(await readFile(join(dir, file), 'utf8')));
    } catch (error) {
      throw new AgentDefinitionError(`${file} ${(error as Error).message}`);
    }
  }
  return checked(
    withWeights(agents, reviewerWeights(await readFile(join(repo, 'docs', 'REVIEW.md'), 'utf8'))),
  );
}

/** Reviewers from a change's own definitions, weighted by its own docs/REVIEW.md. */
export function changeReviewers(
  agents: readonly AgentDefinition[],
  reviewMarkdown: string,
): Reviewer[] {
  return checked(withWeights(agents, reviewerWeights(reviewMarkdown)));
}

function checked(reviewers: Reviewer[]): Reviewer[] {
  if (reviewers.length === 0) throw new AgentDefinitionError('no reviewers are defined');
  for (const reviewer of reviewers) {
    if (!Object.hasOwn(modelVariables, reviewer.model)) {
      throw new AgentDefinitionError(
        `${reviewer.name} uses model ${reviewer.model}, which is not a known model alias`,
      );
    }
  }
  return reviewers;
}

export interface MatrixEntry {
  readonly reviewer: string;
  readonly model: string;
  readonly modelVariable: string;
  readonly effort: string;
}

/** One matrix entry per reviewer: its model alias and the variable that may pin it; `checked` vouches for the alias. */
export function matrixEntry(reviewer: Reviewer): MatrixEntry {
  return {
    reviewer: reviewer.name,
    model: reviewer.model,
    modelVariable: modelVariables[reviewer.model as keyof typeof modelVariables],
    effort: reviewer.effort ?? '',
  };
}
