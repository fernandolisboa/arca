import { parse } from 'yaml';
import { isRecord } from '../report.ts';

/** Frontmatter keys an agent definition may carry; any other key (hooks, mcpServers…) fails. */
const allowedKeys = new Set(['name', 'description', 'tools', 'model', 'effort', 'color']);
/** The only tools a reviewer gets in CI, whatever its definition lists. */
export const reviewTools = ['Read', 'Grep', 'Glob'] as const;
const efforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const slug = /^[a-z][a-z0-9-]{0,63}$/;

/** Model aliases the agents use, and the optional repository variable that pins each to a model ID. */
export const modelVariables = {
  fable: 'REVIEW_MODEL_FABLE',
  opus: 'REVIEW_MODEL_OPUS',
  haiku: 'REVIEW_MODEL_HAIKU',
} as const;
export type ModelAlias = keyof typeof modelVariables;

/**
 * The alias a reviewer runs on in the gate when its own model never answers, such as when the
 * subscription's limit for that model is reached (ADR-0013). The canary never falls back.
 */
export const fallbackModels: Readonly<Record<ModelAlias, ModelAlias>> = {
  fable: 'opus',
  opus: 'fable',
  haiku: 'opus',
};

export interface AgentDefinition {
  readonly name: string;
  /** A model alias such as `fable`; the workflow passes it as is unless a variable pins it. */
  readonly model: string;
  readonly effort: string | undefined;
  readonly tools: readonly string[];
  /** The instructions, used as the reviewer's prompt; never loaded as an agent file. */
  readonly body: string;
}

export class AgentDefinitionError extends Error {}

/**
 * Parses `.claude/agents/<name>.md`. Throws on anything outside the allow-list, before any model
 * sees the definition (spec 0001, R10).
 */
export function parseAgentDefinition(source: string): AgentDefinition {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  if (match === null) throw new AgentDefinitionError('has no frontmatter block');
  const [, frontmatter = '', rest = ''] = match;
  const data = parse(frontmatter, { uniqueKeys: true }) as unknown;
  if (!isRecord(data)) throw new AgentDefinitionError('has frontmatter that is not a mapping');

  for (const key of Object.keys(data)) {
    if (!allowedKeys.has(key)) throw new AgentDefinitionError(`has frontmatter key "${key}"`);
  }
  const name = requireSlug(data, 'name');
  const model = requireSlug(data, 'model');
  const effort = data['effort'];
  if (effort !== undefined && !(typeof effort === 'string' && efforts.has(effort))) {
    throw new AgentDefinitionError('has an effort that is not low, medium, high, xhigh or max');
  }
  const tools = data['tools'];
  if (typeof tools !== 'string') throw new AgentDefinitionError('has no tools list');
  const listed = tools.split(',').map((tool) => tool.trim());
  const body = rest.trim();
  if (body === '') throw new AgentDefinitionError('has an empty body');

  return {
    name,
    model,
    effort,
    tools: reviewTools.filter((tool) => listed.includes(tool)),
    body,
  };
}

function requireSlug(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || !slug.test(value)) {
    throw new AgentDefinitionError(`has a missing or malformed ${key}`);
  }
  return value;
}

export interface ReviewerWeight {
  readonly mustPass: boolean;
  /** A specialist covers only the area its row names; a core reviewer runs on every change. */
  readonly areaScoped: boolean;
}

export interface Reviewer extends AgentDefinition, ReviewerWeight {}

/** The "Runs on" cell of a core reviewer in the docs/REVIEW.md table. */
const everyChange = 'Every change';

/**
 * Reads each reviewer's weight and scope from the table in docs/REVIEW.md. Every agent must have a
 * row, so a new reviewer cannot run without its weight and scope being decided.
 */
export function reviewerWeights(reviewMarkdown: string): Map<string, ReviewerWeight> {
  const weights = new Map<string, ReviewerWeight>();
  const row =
    /^\|\s*\[([a-z][a-z0-9-]*)\]\([^)]*\)\s*\|([^|]*[^|\s][^|]*)\|\s*(Must pass|Should pass)\s*\|/gm;
  for (const [, name = '', runsOn = '', weight] of reviewMarkdown.matchAll(row)) {
    const cell = runsOn.trim();
    // A misspelled core cell would otherwise make a core reviewer a specialist, free to skip.
    if (cell !== everyChange && /every\s*change/i.test(cell)) {
      throw new AgentDefinitionError(
        `${name}'s "Runs on" cell must be exactly "${everyChange}" or name an area`,
      );
    }
    weights.set(name, {
      mustPass: weight === 'Must pass',
      areaScoped: cell !== everyChange,
    });
  }
  return weights;
}

export function withWeights(
  agents: readonly AgentDefinition[],
  weights: ReadonlyMap<string, ReviewerWeight>,
): Reviewer[] {
  return agents.map((agent) => {
    const weight = weights.get(agent.name);
    if (weight === undefined) {
      throw new AgentDefinitionError(`${agent.name} has no row in the docs/REVIEW.md table`);
    }
    return { ...agent, ...weight };
  });
}
