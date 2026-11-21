/**
 * The criterion suggestion evaluation: every case through the path the route takes, against the
 * Claude adapter. A run passes when every answer parses, gives at least three suggestions, and
 * none repeats a known name, names a trait of a city or a house, names a country or a visa, or
 * carries digits, links or markup. Each answer goes into the report for a person to read.
 */
import { appendFileSync } from 'node:fs';
import type { SuggestedCriteria } from '@arca/api-contract/routes';
import { expect, it } from 'vitest';
import { readAnthropicApiKey } from '../../../src/config.js';
import { claudeSuggester } from '../../../src/case/suggestion/claude-suggester.js';
import { criterionSuggestionModel } from '../../../src/case/suggestion/model.js';
import { criterionSuggestionPromptVersion } from '../../../src/case/suggestion/prompt.js';
import type { CriterionSuggester } from '../../../src/case/suggestion/suggester.js';
import { createCriterionSuggestions } from '../../../src/case/suggestion/suggestions.js';
import { callCounter } from '../call-limit.js';
import { suggestionCases } from './cases.js';
import { suggestionProblems } from './checks.js';

/** Each case and its one retry: what bounds a run's cost. */
const maxCallsPerRun = 2 * suggestionCases.length;

it('suggests new country-level criteria without repeating known ones or following planted text', async () => {
  const apiKey = readAnthropicApiKey();
  if (apiKey === undefined) {
    throw new Error('Set ANTHROPIC_API_KEY to run the criterion suggestion evaluation');
  }
  const counter = callCounter(maxCallsPerRun);
  const claude = claudeSuggester({ apiKey });
  const suggester: CriterionSuggester = {
    suggest(known) {
      counter.take();
      return claude.suggest(known);
    },
  };
  const service = createCriterionSuggestions({
    suggester,
    logger: { info: () => undefined, error: () => undefined },
    now: () => 0,
  });
  const lines = [
    '## Criterion suggestion evaluation',
    '',
    `Model \`${criterionSuggestionModel}\`, prompt \`${criterionSuggestionPromptVersion}\`, ${String(suggestionCases.length)} cases.`,
    '',
  ];
  const problems: string[] = [];
  for (const { id, known } of suggestionCases) {
    const outcome = await service.suggest(known);
    if (!outcome.ok) {
      problems.push(`${id}: ${outcome.reason}`);
      lines.push(`### ${id} (no answer: \`${outcome.reason}\`)`, '');
      continue;
    }
    // The service already drops repeats, so the raw count is checked on what reached the screen.
    const value: SuggestedCriteria = outcome.value;
    const found = suggestionProblems(value, known);
    problems.push(...found.map((problem) => `${id}: ${problem}`));
    const text = value.suggestions
      .map(({ name, weight }) => `- ${name} (${String(weight)})`)
      .join('\n')
      .replace(/`/gu, "'");
    lines.push(
      `### ${id}`,
      '',
      ...(found.length > 0 ? [`Problems: ${found.join('; ')}.`, ''] : []),
    );
    lines.push('```text', text, '```', '');
  }
  lines.splice(4, 0, problems.length === 0 ? '**Passed.**' : `**Failed:** ${problems.join('; ')}.`);
  lines.push(`Model calls: ${String(counter.calls())} of at most ${String(maxCallsPerRun)}.`);
  const text = lines.join('\n');
  console.log(text);
  const summary = process.env['ARCA_EVAL_REPORT'];
  if (summary !== undefined && summary !== '') appendFileSync(summary, `${text}\n`);
  expect(problems).toEqual([]);
});
